import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import type { PersonProfileView } from '../contracts/views.js';

import { currentTenant, notFound, originOfCurrentRequest } from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import {
  addressView,
  capabilityView,
  contactView,
  emergencyContactView,
  historyView,
  identifierView,
  nameView,
  nationalityView,
  noteView,
  personView,
  preferenceView,
  tagView,
} from './people-views.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * Everything about one person the caller is entitled to see, assembled per permission.
 *
 * The shape of this handler is the module's privacy model made executable. It does not read the
 * whole person and filter afterwards: it **asks what the caller holds and reads only those
 * sections**. A section the caller may not read is absent from the response and named in
 * `withheld`, so a screen can say "identifiers are hidden" rather than render an empty list that
 * asserts this person holds no documents.
 *
 * Reading an identifier's *value* is finer-grained still, and it is the one read in this product
 * that is **recorded**. Seeing that somebody holds a residency permit is an ordinary
 * administrative fact; being shown the number on it is an event an investigation would want to
 * reconstruct, and a system that cannot say who read one cannot answer that.
 */

export interface ReadPersonProfile extends Query {
  readonly queryName: 'people.read-profile';
  readonly personId: string;
  readonly asOf?: Date;
}

export const readPersonProfileHandler = (
  dependencies: PeopleDependencies,
): QueryHandler<ReadPersonProfile, PersonProfileView> => ({
  queryName: 'people.read-profile',
  permission: PeoplePermissions.personRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const person = await dependencies.stores.people.byId(transaction, query.personId);

      if (person === undefined) return notFound('person');

      const asOf = query.asOf ?? dependencies.clock.now();
      const held = await heldPermissions(dependencies);
      const names = await dependencies.stores.names.forPerson(transaction, query.personId);
      const sections = await sectionsFor(transaction, dependencies, query.personId, held);

      return success({
        person: personView(person, names, asOf, {
          sensitive: held.has(PeoplePermissions.sensitiveRead),
          identifierValues: held.has(PeoplePermissions.identifierReadValue),
        }),
        names: names.map(nameView),
        ...sections.included,
        withheld: sections.withheld,
      });
    }),
});

/** The permissions this read consults, asked once rather than per section. */
const heldPermissions = async (dependencies: PeopleDependencies): Promise<ReadonlySet<string>> => {
  const consulted = [
    PeoplePermissions.sensitiveRead,
    PeoplePermissions.identifierRead,
    PeoplePermissions.identifierReadValue,
    PeoplePermissions.nationalityRead,
    PeoplePermissions.contactRead,
    PeoplePermissions.addressRead,
    PeoplePermissions.emergencyContactRead,
    PeoplePermissions.preferenceRead,
    PeoplePermissions.capabilityRead,
    PeoplePermissions.historyRead,
    PeoplePermissions.tagRead,
    PeoplePermissions.noteRead,
  ];
  const answers = await Promise.all(
    consulted.map(async (permission) => ({
      permission,
      granted: await dependencies.permissions.holds(permission),
    })),
  );

  return new Set(answers.filter((answer) => answer.granted).map((answer) => answer.permission));
};

interface Sections {
  /**
   * The sections this caller may read.
   *
   * A loose record rather than `Partial<PersonProfileView>`, because the whole point is that a key
   * is *absent* when the caller may not read it — and a partial type invites a consumer to spread
   * it and get `notes: undefined`, which serializes to a key with a null and asserts something
   * false.
   */
  readonly included: Record<string, unknown>;
  readonly withheld: readonly string[];
}

/**
 * Reads each section the caller may see.
 *
 * Split from the handler so that neither exceeds the function budget, and so the list of sections
 * reads as a list — which is what somebody checking that a permission guards the right table is
 * looking for.
 */
const sectionsFor = async (
  transaction: Transaction,
  dependencies: PeopleDependencies,
  personId: string,
  held: ReadonlySet<string>,
): Promise<Sections> => {
  const withheld: string[] = [];
  const included: Record<string, unknown> = {};
  const stores = dependencies.stores;

  const may = (permission: string, section: string): boolean => {
    if (held.has(permission)) return true;
    withheld.push(section);
    return false;
  };

  if (may(PeoplePermissions.identifierRead, 'identifiers')) {
    const rows = await stores.identifiers.forPerson(transaction, personId);
    const showValues = held.has(PeoplePermissions.identifierReadValue);

    if (showValues)
      recordDisclosures(
        dependencies,
        personId,
        rows.map((r) => r.identifierType),
      );
    included['identifiers'] = rows.map((row) => identifierView(row, showValues));
  }
  if (may(PeoplePermissions.nationalityRead, 'nationalities')) {
    included['nationalities'] = (await stores.nationalities.forPerson(transaction, personId)).map(
      nationalityView,
    );
  }
  if (may(PeoplePermissions.contactRead, 'contacts')) {
    included['contacts'] = (await stores.contacts.forPerson(transaction, personId)).map(
      contactView,
    );
  }
  if (may(PeoplePermissions.addressRead, 'addresses')) {
    included['addresses'] = (await stores.addresses.forPerson(transaction, personId)).map(
      addressView,
    );
  }
  if (may(PeoplePermissions.emergencyContactRead, 'emergencyContacts')) {
    included['emergencyContacts'] = (
      await stores.emergencyContacts.forPerson(transaction, personId)
    ).map(emergencyContactView);
  }
  await remainingSections(transaction, dependencies, personId, { may, included });
  return { included, withheld };
};

interface SectionAccumulator {
  readonly may: (permission: string, section: string) => boolean;
  readonly included: Record<string, unknown>;
}

/** The rest, split out purely so neither half exceeds the function budget. */
const remainingSections = async (
  transaction: Transaction,
  dependencies: PeopleDependencies,
  personId: string,
  accumulator: SectionAccumulator,
): Promise<void> => {
  const { may, included } = accumulator;
  const stores = dependencies.stores;

  if (may(PeoplePermissions.preferenceRead, 'preferences')) {
    included['preferences'] = (await stores.preferences.forPerson(transaction, personId)).map(
      preferenceView,
    );
  }
  if (may(PeoplePermissions.capabilityRead, 'capabilities')) {
    included['capabilities'] = (await stores.capabilities.forPerson(transaction, personId)).map(
      capabilityView,
    );
  }
  if (may(PeoplePermissions.historyRead, 'history')) {
    included['history'] = (await stores.history.forPerson(transaction, personId)).map(historyView);
  }
  if (may(PeoplePermissions.tagRead, 'tags')) {
    included['tags'] = (await stores.tags.forPerson(transaction, personId)).map(tagView);
  }
  if (may(PeoplePermissions.noteRead, 'notes')) {
    included['notes'] = (await stores.notes.forPerson(transaction, personId)).map(noteView);
  }
};

/**
 * Records that somebody was shown government identifier values.
 *
 * The kind and the person, never the value — a disclosure log holding the numbers would be a
 * second copy of the thing it exists to protect. Recorded per kind rather than per row, because
 * "this actor read this person's passport" is the fact, and reading two passports of one kind in
 * one request is one disclosure.
 */
const recordDisclosures = (
  dependencies: PeopleDependencies,
  personId: string,
  identifierTypes: readonly string[],
): void => {
  const origin = originOfCurrentRequest();
  const at = dependencies.clock.now();

  for (const identifierType of [...new Set(identifierTypes)]) {
    dependencies.disclosure.recordDisclosure({
      tenantId: currentTenant(),
      actor: origin.actor,
      personId,
      identifierType,
      at,
    });
  }
};
