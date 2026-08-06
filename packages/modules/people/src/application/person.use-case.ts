import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { DuplicateCandidate } from '../domain/duplicate-candidate.js';
import { Person } from '../domain/person.js';
import { PersonName } from '../domain/person-name.js';
import type { DuplicateMatch } from '../domain/duplicate-matching.js';
import type { Metadata } from '../domain/people-aggregate.js';
import type { PersonStatus } from '../domain/people-vocabulary.js';

import { detectDuplicates } from './duplicate-detection.js';
import { insertChild } from './child-writes.js';
import { conflicted, currentTenant, originOfCurrentRequest, refusedBy } from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { loadWritablePerson, personFrom } from './person-guard.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * Creating and maintaining a Person.
 *
 * The one thing worth reading closely is what `create` does before it writes. AD-001 says a Person
 * is created once, and the only place that can be enforced is here — the moment somebody is about
 * to be entered a second time. So a create runs duplicate detection first, inside the same
 * transaction, and one of three things happens:
 *
 * - **Nothing matches.** The person is written.
 * - **Something matches and the caller did not acknowledge it.** The command is *refused* with the
 *   candidates, so an administrator sees "this may already be Sara Al-Amri" before they create the
 *   second record rather than after payroll has run twice.
 * - **Something matches and the caller acknowledged it.** The person is written *and* a duplicate
 *   candidate is queued for review. Refusing outright would be wrong: two brothers with the same
 *   name and the same birthday are two people, and a registry that could not record the second is
 *   a registry somebody works around with a misspelling.
 *
 * The acknowledgement is explicit rather than a flag defaulting to true, because a default that
 * skips the check is a check nobody runs.
 */

export interface CreatePersonCommand extends Command {
  readonly commandName: 'people.create-person';
  readonly personNumber: string;
  readonly legalName: Readonly<Record<string, string>>;
  readonly preferredName?: Readonly<Record<string, string>>;
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  readonly genderCode?: string;
  readonly maritalStatusCode?: string;
  readonly metadata?: Metadata;
  /** When this identity record comes into force. Back-dating is ordinary for a migration. */
  readonly effectiveFrom?: Date;
  /**
   * The caller has seen the duplicate candidates and is creating anyway. Explicit rather than a
   * default, because a default that skips the check is a check nobody runs.
   */
  readonly acknowledgedDuplicates?: boolean;
}

export interface PersonCreated {
  readonly personId: string;
  readonly personNumber: string;
  readonly duplicatesQueued: number;
}

export const createPersonHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<CreatePersonCommand, PersonCreated> => ({
  commandName: 'people.create-person',
  permission: PeoplePermissions.personManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.people.byNumber(transaction, command.personNumber);

      // Checked here as well as by the unique index, so the caller gets "that number is taken"
      // rather than a constraint violation they cannot act on.
      if (existing !== undefined) return conflicted('person_number_taken');

      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const detection = await detectDuplicates(transaction, dependencies.stores, {
        identifierKeys: [],
        contactValues: [],
        names: Object.values(command.legalName),
        ...(command.dateOfBirth === undefined ? {} : { dateOfBirth: command.dateOfBirth }),
      });

      if (detection.matches.length > 0 && command.acknowledgedDuplicates !== true) {
        return conflicted('person_may_already_exist');
      }

      const person = Person.create(
        {
          tenantId: currentTenant(),
          personNumber: command.personNumber,
          ...optionalDetails(command),
          ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
        },
        origin,
        now,
      );

      if (!person.ok) return refusedBy(person.error);

      const name = PersonName.record(
        {
          tenantId: currentTenant(),
          personId: person.value.id,
          legalName: command.legalName,
          ...(command.preferredName === undefined ? {} : { preferredName: command.preferredName }),
          effectiveFrom: command.effectiveFrom ?? now,
        },
        origin,
        now,
      );

      if (!name.ok) return refusedBy(name.error);

      await dependencies.stores.people.insert(transaction, person.value.snapshot());
      transaction.collect(person.value.pullEvents());
      await insertChild(transaction, dependencies.stores.names, name.value);

      const queued = await queueCandidates(
        transaction,
        dependencies,
        person.value.id,
        detection.matches,
        now,
      );

      return success({
        personId: person.value.id,
        personNumber: person.value.personNumber,
        duplicatesQueued: queued,
      });
    }),
});

/** The facts a person may carry that are not their name, shared by create and amend. */
export interface PersonDetailsInput {
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  readonly genderCode?: string;
  readonly maritalStatusCode?: string;
}

/** The optional facts, hoisted so `create` stays inside the function budget. */
const optionalDetails = (command: PersonDetailsInput): PersonDetailsInput => ({
  ...(command.dateOfBirth === undefined ? {} : { dateOfBirth: command.dateOfBirth }),
  ...(command.placeOfBirth === undefined ? {} : { placeOfBirth: command.placeOfBirth }),
  ...(command.genderCode === undefined ? {} : { genderCode: command.genderCode }),
  ...(command.maritalStatusCode === undefined
    ? {}
    : { maritalStatusCode: command.maritalStatusCode }),
});

/**
 * Queues a review for each match, skipping a pair already queued.
 *
 * Exported because the identifier and contact use cases queue candidates too: a duplicate is most
 * often discovered when somebody's passport number is entered, not when their name is, and a
 * detection that only ran at create would miss the case it exists for.
 */
export const queueCandidates = async (
  transaction: Transaction,
  dependencies: PeopleDependencies,
  personId: string,
  matches: readonly DuplicateMatch[],
  now: Date,
): Promise<number> => {
  const origin = originOfCurrentRequest();
  let queued = 0;

  for (const match of matches) {
    const already = await dependencies.stores.duplicates.byPair(
      transaction,
      personId,
      match.personId,
    );

    if (already !== undefined) continue;

    const candidate = DuplicateCandidate.suspect(
      {
        tenantId: currentTenant(),
        personId,
        otherPersonId: match.personId,
        reason: match.reason,
        confidence: match.confidence,
      },
      origin,
      now,
    );

    if (!candidate.ok) continue;

    await dependencies.stores.duplicates.insert(transaction, candidate.value.snapshot());
    transaction.collect(candidate.value.pullEvents());
    queued += 1;
  }
  return queued;
};

export interface AmendPersonCommand extends Command {
  readonly commandName: 'people.amend-person';
  readonly personId: string;
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  readonly genderCode?: string;
  readonly maritalStatusCode?: string;
  readonly expectedVersion: number;
}

export interface PersonAffected {
  readonly personId: string;
}

export const amendPersonHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<AmendPersonCommand, PersonAffected> => ({
  commandName: 'people.amend-person',
  permission: PeoplePermissions.personManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const person = personFrom(loaded.value);
      const amended = person.amendDetails(
        optionalDetails(command),
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!amended.ok) return refusedBy(amended.error);

      await dependencies.stores.people.update(
        transaction,
        person.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(person.pullEvents());
      return success({ personId: person.id });
    }),
});

export interface ChangePersonStatusCommand extends Command {
  readonly commandName: 'people.change-person-status';
  readonly personId: string;
  readonly status: PersonStatus;
  readonly expectedVersion: number;
}

export const changePersonStatusHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<ChangePersonStatusCommand, PersonAffected> => ({
  commandName: 'people.change-person-status',
  permission: PeoplePermissions.personManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const person = personFrom(loaded.value);
      const changed = person.changeStatus(
        command.status,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!changed.ok) return refusedBy(changed.error);

      await dependencies.stores.people.update(
        transaction,
        person.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(person.pullEvents());
      return success({ personId: person.id });
    }),
});
