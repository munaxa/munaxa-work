import { success, type Command, type CommandHandler } from '@work/kernel';

import { PersonName } from '../domain/person-name.js';
import type { Metadata } from '../domain/people-aggregate.js';

import { closeSuperseded, insertChild, placementOf } from './child-writes.js';
import { currentTenant, originOfCurrentRequest, refusedBy } from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { loadPerson, loadWritablePerson, personFrom } from './person-guard.js';
import type { PeopleDependencies } from './people-dependencies.js';
import type { PersonAffected } from './person.use-case.js';

/**
 * The rest of the Person aggregate's commands: the name timeline, the metadata, the photograph
 * and the merge.
 *
 * Split from `person.use-case.ts` because that file is the create path and its duplicate check,
 * and a file holding both would be past the budget a use-case file is held to. The split is by
 * concern rather than by line count: everything here changes a person who already exists.
 */

export interface RecordPersonNameCommand extends Command {
  readonly commandName: 'people.record-person-name';
  readonly personId: string;
  readonly legalName: Readonly<Record<string, string>>;
  readonly preferredName?: Readonly<Record<string, string>>;
  /** When the new name took effect. A marriage certificate has a date, and it is rarely today. */
  readonly effectiveFrom: Date;
}

/**
 * A legal name change: a marriage, a naturalisation, a court correction.
 *
 * This closes the period the previous name had and opens a new one, so "what was this person's
 * legal name when they signed that contract" keeps exactly one answer forever. Back-dating is
 * ordinary — the certificate arrives weeks after the date on it — and a back-dated change
 * *splits* the history rather than discarding whatever was recorded after it (ADR-0037).
 */
export const recordPersonNameHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordPersonNameCommand, PersonAffected> => ({
  commandName: 'people.record-person-name',
  permission: PeoplePermissions.personManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const siblings = await dependencies.stores.names.forPerson(transaction, command.personId);
      const plan = placementOf(siblings, command.effectiveFrom);

      const name = PersonName.record(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          legalName: command.legalName,
          ...(command.preferredName === undefined ? {} : { preferredName: command.preferredName }),
          effectiveFrom: command.effectiveFrom,
          ...(plan.effectiveTo === undefined ? {} : { effectiveTo: plan.effectiveTo }),
        },
        origin,
        now,
      );

      if (!name.ok) return refusedBy(name.error);

      const closed = await closeSuperseded(transaction, {
        store: dependencies.stores.names,
        superseded: plan.superseded,
        rehydrate: (state) => PersonName.rehydrate(state),
        at: command.effectiveFrom,
        origin,
        occurredAt: now,
      });

      if (!closed.ok) return refusedBy(closed.error);

      await insertChild(transaction, dependencies.stores.names, name.value);
      return success({ personId: command.personId });
    }),
});

export interface RevisePersonMetadataCommand extends Command {
  readonly commandName: 'people.revise-person-metadata';
  readonly personId: string;
  readonly metadata: Metadata;
  readonly expectedVersion: number;
}

export const revisePersonMetadataHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RevisePersonMetadataCommand, PersonAffected> => ({
  commandName: 'people.revise-person-metadata',
  permission: PeoplePermissions.personManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const person = personFrom(loaded.value);
      const revised = person.reviseMetadata(
        command.metadata,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!revised.ok) return refusedBy(revised.error);

      await dependencies.stores.people.update(
        transaction,
        person.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(person.pullEvents());
      return success({ personId: person.id });
    }),
});

export interface SetPersonPhotoCommand extends Command {
  readonly commandName: 'people.set-person-photo';
  readonly personId: string;
  /** A reference into the document store. Absent removes the photograph. */
  readonly documentId?: string;
  readonly expectedVersion: number;
}

export const setPersonPhotoHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<SetPersonPhotoCommand, PersonAffected> => ({
  commandName: 'people.set-person-photo',
  permission: PeoplePermissions.personManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const person = personFrom(loaded.value);
      const attached = person.setPhoto(
        command.documentId,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!attached.ok) return refusedBy(attached.error);

      await dependencies.stores.people.update(
        transaction,
        person.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(person.pullEvents());
      return success({ personId: person.id });
    }),
});

export interface MergePeopleCommand extends Command {
  readonly commandName: 'people.merge-people';
  /** The record that stops being used. */
  readonly personId: string;
  /** The record everything redirects to. */
  readonly survivorPersonId: string;
  readonly expectedVersion: number;
}

/**
 * Records that two records are one human being (AD-001).
 *
 * Deliberately narrow. It marks the duplicate as merged and points it at the survivor; it does
 * **not** move the duplicate's data onto the survivor, and it does not delete anything.
 *
 * Moving the data would be the wrong shape here and dangerous besides: this module cannot know
 * what every later module has recorded against the losing identifier, so a merge that copied the
 * People rows and left the rest would be half a merge that looks complete. The redirect is what
 * every consumer follows, and consolidating the child records is a reviewed, per-record operation
 * an administrator performs afterwards — stated in the debt register rather than pretended away.
 */
export const mergePeopleHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<MergePeopleCommand, PersonAffected> => ({
  commandName: 'people.merge-people',
  permission: PeoplePermissions.personMerge,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const survivor = await loadPerson(transaction, dependencies.stores, command.survivorPersonId);

      if (!survivor.ok) return survivor;

      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const person = personFrom(loaded.value);
      const merged = person.mergeInto(
        command.survivorPersonId,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!merged.ok) return refusedBy(merged.error);

      await dependencies.stores.people.update(
        transaction,
        person.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(person.pullEvents());
      return success({ personId: person.id });
    }),
});
