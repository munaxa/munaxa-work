import { success, type Command, type CommandHandler } from '@work/kernel';

import { PersonCapability } from '../domain/person-capability.js';
import { PersonHistory } from '../domain/person-history.js';
import { PersonNationality } from '../domain/person-nationality.js';
import type { CapabilityKind, HistoryKind } from '../domain/people-vocabulary.js';

import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { loadWritablePerson } from './person-guard.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * The records that are claims rather than values: nationalities, capabilities, history,
 * tags and notes.
 *
 * None of these is effective-dated, and that is a decision rather than an omission. A skill is not
 * a value that had a different value last March; it is a claim that was either made or withdrawn.
 * Putting it on a timeline would model a history of nothing — while the one attribute where
 * yesterday's value has legal force today, the legal name, *is* on a timeline (ADR-0037).
 *
 * Every one of them is **withdrawn, never deleted** (AD-009). There is no delete command anywhere
 * in this module.
 */

export interface RecordNationalityCommand extends Command {
  readonly commandName: 'people.record-nationality';
  readonly personId: string;
  readonly countryCode: string;
  readonly isPrimary?: boolean;
  readonly acquiredOn?: string;
}

export const recordNationalityHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordNationalityCommand, { readonly nationalityId: string }> => ({
  commandName: 'people.record-nationality',
  permission: PeoplePermissions.nationalityManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const held = await dependencies.stores.nationalities.forPerson(transaction, command.personId);

      if (
        held.some((row) => row.countryCode === command.countryCode && row.withdrawnAt === undefined)
      ) {
        return refusedBy({
          reason: 'nationality_already_held',
          messageKey: 'people.rejection.nationality_already_held',
        });
      }

      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const nationality = PersonNationality.record(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          countryCode: command.countryCode,
          ...(command.isPrimary === undefined ? {} : { isPrimary: command.isPrimary }),
          ...(command.acquiredOn === undefined ? {} : { acquiredOn: command.acquiredOn }),
        },
        origin,
        now,
      );

      if (!nationality.ok) return refusedBy(nationality.error);

      if (command.isPrimary === true) {
        for (const state of held.filter((row) => row.isPrimary)) {
          const other = PersonNationality.rehydrate(state);

          other.demote();
          await dependencies.stores.nationalities.update(
            transaction,
            other.snapshot(),
            state.version,
          );
        }
      }

      await dependencies.stores.nationalities.insert(transaction, nationality.value.snapshot());
      transaction.collect(nationality.value.pullEvents());
      return success({ nationalityId: nationality.value.id });
    }),
});

export interface RecordCapabilityCommand extends Command {
  readonly commandName: 'people.record-capability';
  readonly personId: string;
  readonly kind: CapabilityKind;
  readonly capabilityCode: string;
  readonly title?: Readonly<Record<string, string>>;
  readonly level: string;
  readonly yearsOfExperience?: number;
  readonly lastUsedOn?: string;
}

export const recordCapabilityHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordCapabilityCommand, { readonly capabilityId: string }> => ({
  commandName: 'people.record-capability',
  permission: PeoplePermissions.capabilityManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const capability = PersonCapability.record(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          kind: command.kind,
          capabilityCode: command.capabilityCode,
          ...(command.title === undefined ? {} : { title: command.title }),
          level: command.level,
          ...(command.yearsOfExperience === undefined
            ? {}
            : { yearsOfExperience: command.yearsOfExperience }),
          ...(command.lastUsedOn === undefined ? {} : { lastUsedOn: command.lastUsedOn }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!capability.ok) return refusedBy(capability.error);

      await dependencies.stores.capabilities.insert(transaction, capability.value.snapshot());
      transaction.collect(capability.value.pullEvents());
      return success({ capabilityId: capability.value.id });
    }),
});

export interface RecordHistoryCommand extends Command {
  readonly commandName: 'people.record-history';
  readonly personId: string;
  readonly kind: HistoryKind;
  readonly organizationName: Readonly<Record<string, string>>;
  readonly title: Readonly<Record<string, string>>;
  readonly fieldOfStudy?: Readonly<Record<string, string>>;
  readonly countryCode?: string;
  readonly fromDate: string;
  readonly toDate?: string;
  readonly expiresOn?: string;
  readonly reference?: string;
}

export const recordHistoryHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordHistoryCommand, { readonly historyId: string }> => ({
  commandName: 'people.record-history',
  permission: PeoplePermissions.historyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const history = PersonHistory.record(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          kind: command.kind,
          organizationName: command.organizationName,
          title: command.title,
          ...(command.fieldOfStudy === undefined ? {} : { fieldOfStudy: command.fieldOfStudy }),
          ...(command.countryCode === undefined ? {} : { countryCode: command.countryCode }),
          fromDate: command.fromDate,
          ...(command.toDate === undefined ? {} : { toDate: command.toDate }),
          ...(command.expiresOn === undefined ? {} : { expiresOn: command.expiresOn }),
          ...(command.reference === undefined ? {} : { reference: command.reference }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!history.ok) return refusedBy(history.error);

      await dependencies.stores.history.insert(transaction, history.value.snapshot());
      transaction.collect(history.value.pullEvents());
      return success({ historyId: history.value.id });
    }),
});

export interface WithdrawCapabilityCommand extends Command {
  readonly commandName: 'people.withdraw-capability';
  readonly capabilityId: string;
  readonly expectedVersion: number;
}

export const withdrawCapabilityHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<WithdrawCapabilityCommand, { readonly capabilityId: string }> => ({
  commandName: 'people.withdraw-capability',
  permission: PeoplePermissions.capabilityManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.capabilities.byId(transaction, command.capabilityId);

      if (state === undefined) return notFound('capability');

      const capability = PersonCapability.rehydrate(state);
      const withdrawn = capability.withdraw(originOfCurrentRequest(), dependencies.clock.now());

      if (!withdrawn.ok) return refusedBy(withdrawn.error);

      await dependencies.stores.capabilities.update(
        transaction,
        capability.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(capability.pullEvents());
      return success({ capabilityId: capability.id });
    }),
});
