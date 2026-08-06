import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { matchKeyFor } from '../domain/duplicate-matching.js';
import { PersonIdentifier, type RecordIdentifier } from '../domain/person-identifier.js';

import { detectDuplicates } from './duplicate-detection.js';
import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { loadWritablePerson } from './person-guard.js';
import { queueCandidates } from './person.use-case.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * Government and business identifiers.
 *
 * This is where duplicate detection earns its keep. A duplicate person is most often discovered
 * when somebody's national identifier is entered — not when their name is — because two records
 * for one human being usually differ in spelling and agree exactly on the number the government
 * issued. So recording an identifier runs detection again, on the strongest signal there is.
 *
 * The **value never leaves this layer un-permissioned**: it is digested for matching, stored, and
 * returned only to a caller holding `people.identifier.read-value`, whose read is recorded.
 */

export interface RecordIdentifierCommand extends Command {
  readonly commandName: 'people.record-identifier';
  readonly personId: string;
  readonly identifierType: string;
  readonly value: string;
  readonly issuingCountry?: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly isPrimary?: boolean;
  readonly acknowledgedDuplicates?: boolean;
}

export interface IdentifierRecorded {
  readonly identifierId: string;
  readonly duplicatesQueued: number;
}

export const recordIdentifierHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordIdentifierCommand, IdentifierRecorded> => ({
  commandName: 'people.record-identifier',
  permission: PeoplePermissions.identifierManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const matchKey = matchKeyFor(command.identifierType, command.value, (type, normalized) =>
        dependencies.digest.digest(type, normalized),
      );

      const detection = await detectDuplicates(transaction, dependencies.stores, {
        personId: command.personId,
        identifierKeys: [matchKey],
        contactValues: [],
        names: [],
      });

      if (detection.matches.length > 0 && command.acknowledgedDuplicates !== true) {
        // The refusal names the *kind* that clashed and never the number: a message echoing a
        // national identifier would put it into a browser history and a support ticket.
        return conflicted('identifier_may_belong_to_another_person');
      }

      const identifier = PersonIdentifier.record(
        requestFrom(command),
        dependencies.digest,
        origin,
        now,
      );

      if (!identifier.ok) return refusedBy(identifier.error);

      if (command.isPrimary === true) {
        await demoteOtherPrimaries(
          transaction,
          dependencies,
          command.personId,
          command.identifierType,
        );
      }

      await dependencies.stores.identifiers.insert(transaction, identifier.value.snapshot());
      transaction.collect(identifier.value.pullEvents());

      const queued = await queueCandidates(
        transaction,
        dependencies,
        command.personId,
        detection.matches,
        now,
      );

      return success({ identifierId: identifier.value.id, duplicatesQueued: queued });
    }),
});

/** The command's optional fields, hoisted so the handler stays inside its budget. */
const requestFrom = (command: RecordIdentifierCommand): RecordIdentifier => ({
  tenantId: currentTenant(),
  personId: command.personId,
  identifierType: command.identifierType,
  value: command.value,
  ...(command.issuingCountry === undefined ? {} : { issuingCountry: command.issuingCountry }),
  ...(command.issuedOn === undefined ? {} : { issuedOn: command.issuedOn }),
  ...(command.expiresOn === undefined ? {} : { expiresOn: command.expiresOn }),
  ...(command.isPrimary === undefined ? {} : { isPrimary: command.isPrimary }),
});

/**
 * A person may hold two valid passports; only one is the one this employer files with.
 *
 * Demoting rather than refusing, because the second passport becoming the primary one is an
 * ordinary event and refusing it would mean withdrawing a valid document to record another.
 */
const demoteOtherPrimaries = async (
  transaction: Transaction,
  dependencies: PeopleDependencies,
  personId: string,
  identifierType: string,
): Promise<void> => {
  const held = await dependencies.stores.identifiers.forPerson(transaction, personId);

  for (const state of held) {
    if (!state.isPrimary || state.identifierType !== identifierType) continue;

    const other = PersonIdentifier.rehydrate(state);

    other.demote();
    await dependencies.stores.identifiers.update(transaction, other.snapshot(), state.version);
  }
};

export interface AmendIdentifierCommand extends Command {
  readonly commandName: 'people.amend-identifier';
  readonly identifierId: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly isPrimary?: boolean;
  readonly expectedVersion: number;
}

export interface IdentifierAffected {
  readonly identifierId: string;
}

export const amendIdentifierHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<AmendIdentifierCommand, IdentifierAffected> => ({
  commandName: 'people.amend-identifier',
  permission: PeoplePermissions.identifierManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.identifiers.byId(transaction, command.identifierId);

      if (state === undefined) return notFound('identifier');

      const identifier = PersonIdentifier.rehydrate(state);
      const amended = identifier.amend(
        {
          ...(command.issuedOn === undefined ? {} : { issuedOn: command.issuedOn }),
          ...(command.expiresOn === undefined ? {} : { expiresOn: command.expiresOn }),
          ...(command.isPrimary === undefined ? {} : { isPrimary: command.isPrimary }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!amended.ok) return refusedBy(amended.error);

      await dependencies.stores.identifiers.update(
        transaction,
        identifier.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(identifier.pullEvents());
      return success({ identifierId: identifier.id });
    }),
});

export interface WithdrawIdentifierCommand extends Command {
  readonly commandName: 'people.withdraw-identifier';
  readonly identifierId: string;
  readonly expectedVersion: number;
}

/**
 * Withdraws a document — replaced, revoked, or recorded in error.
 *
 * The row survives with its match key, so a withdrawn passport still answers "who held this
 * number" (AD-009). What it stops doing is being offered as current, and it stops counting as a
 * duplicate signal — a renewed passport should not flag its own holder against themselves.
 */
export const withdrawIdentifierHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<WithdrawIdentifierCommand, IdentifierAffected> => ({
  commandName: 'people.withdraw-identifier',
  permission: PeoplePermissions.identifierManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.identifiers.byId(transaction, command.identifierId);

      if (state === undefined) return notFound('identifier');

      const identifier = PersonIdentifier.rehydrate(state);
      const withdrawn = identifier.withdraw(originOfCurrentRequest(), dependencies.clock.now());

      if (!withdrawn.ok) return refusedBy(withdrawn.error);

      await dependencies.stores.identifiers.update(
        transaction,
        identifier.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(identifier.pullEvents());
      return success({ identifierId: identifier.id });
    }),
});
