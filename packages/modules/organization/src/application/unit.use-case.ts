import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { OrganizationUnit } from '../domain/organization-unit.js';
import {
  ORGANIZATION_STATUSES,
  type OrganizationStatus,
} from '../domain/organization-vocabulary.js';
import type { Metadata } from '../domain/organization-aggregate.js';

import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './organization-context.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * Creating and maintaining the nodes of the structure.
 *
 * Creating a unit does not place it. A unit that exists but sits nowhere is a real and useful
 * state — a branch approved before the group decides which region owns it — and forcing a parent
 * at creation would make that state inexpressible, or worse, make somebody pick a wrong parent
 * and correct it later, leaving a placement period that never actually happened.
 */

export interface CreateUnitCommand extends Command {
  readonly commandName: 'organization.create-unit';
  readonly unitTypeId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly metadata?: Metadata;
  readonly effectiveFrom: Date;
}

export interface UnitChanged {
  readonly unitId: string;
  readonly code: string;
  readonly status: OrganizationStatus;
}

export const createUnitHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<CreateUnitCommand, UnitChanged> => ({
  commandName: 'organization.create-unit',
  permission: OrganizationPermissions.unitManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const type = await dependencies.stores.unitTypes.byId(transaction, command.unitTypeId);

      // Reading the type first is what makes a unit of another tenant's type impossible in code
      // as well as in the database, and produces "no such unit type" rather than a foreign key
      // error the caller cannot act on.
      if (type === undefined) return notFound('unit type');

      const taken = await dependencies.stores.units.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted('unit_code_taken');

      const created = OrganizationUnit.create(
        {
          tenantId: currentTenant(),
          unitTypeId: command.unitTypeId,
          code: command.code,
          name: command.name,
          ...(command.description === undefined ? {} : { description: command.description }),
          ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
          effectiveFrom: command.effectiveFrom,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!created.ok) return refusedBy(created.error);

      await dependencies.stores.units.insert(transaction, created.value.snapshot());
      transaction.collect(created.value.pullEvents());
      return success({
        unitId: created.value.id,
        code: created.value.code,
        status: created.value.currentStatus,
      });
    }),
});

export interface RenameUnitCommand extends Command {
  readonly commandName: 'organization.rename-unit';
  readonly unitId: string;
  readonly name: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly expectedVersion: number;
}

export const renameUnitHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<RenameUnitCommand, UnitChanged> => ({
  commandName: 'organization.rename-unit',
  permission: OrganizationPermissions.unitManage,

  handle: async (command) =>
    withUnit(dependencies, command.unitId, async (unit, transaction) => {
      const renamed = unit.rename(
        command.name,
        command.description,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!renamed.ok) return refusedBy(renamed.error);

      await dependencies.stores.units.update(transaction, unit.snapshot(), command.expectedVersion);
      transaction.collect(unit.pullEvents());
      return success({ unitId: unit.id, code: unit.code, status: unit.currentStatus });
    }),
});

export interface ChangeUnitStatusCommand extends Command {
  readonly commandName: 'organization.change-unit-status';
  readonly unitId: string;
  readonly status: OrganizationStatus;
  readonly effectiveAt: Date;
  readonly expectedVersion: number;
}

export const changeUnitStatusHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<ChangeUnitStatusCommand, UnitChanged> => ({
  commandName: 'organization.change-unit-status',
  permission: OrganizationPermissions.unitManage,

  validate: (command) =>
    ORGANIZATION_STATUSES.includes(command.status)
      ? []
      : [{ field: 'status', message: `must be one of ${ORGANIZATION_STATUSES.join(', ')}` }],

  handle: async (command) =>
    withUnit(dependencies, command.unitId, async (unit, transaction) => {
      const changed = unit.changeStatus(
        command.status,
        command.effectiveAt,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!changed.ok) return refusedBy(changed.error);

      await dependencies.stores.units.update(transaction, unit.snapshot(), command.expectedVersion);
      transaction.collect(unit.pullEvents());
      return success({ unitId: unit.id, code: unit.code, status: unit.currentStatus });
    }),
});

export interface ReviseUnitMetadataCommand extends Command {
  readonly commandName: 'organization.revise-unit-metadata';
  readonly unitId: string;
  readonly metadata: Metadata;
  readonly expectedVersion: number;
}

export const reviseUnitMetadataHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<ReviseUnitMetadataCommand, UnitChanged> => ({
  commandName: 'organization.revise-unit-metadata',
  permission: OrganizationPermissions.unitManage,

  handle: async (command) =>
    withUnit(dependencies, command.unitId, async (unit, transaction) => {
      const revised = unit.reviseMetadata(
        command.metadata,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!revised.ok) return refusedBy(revised.error);

      await dependencies.stores.units.update(transaction, unit.snapshot(), command.expectedVersion);
      transaction.collect(unit.pullEvents());
      return success({ unitId: unit.id, code: unit.code, status: unit.currentStatus });
    }),
});

/** Loads a unit or refuses, so three handlers do not each write the same four lines. */
const withUnit = <TValue>(
  dependencies: OrganizationDependencies,
  unitId: string,
  work: (
    unit: OrganizationUnit,
    transaction: Transaction,
  ) => Promise<Result<TValue, HandlerFailure>>,
): Promise<Result<TValue, HandlerFailure>> =>
  dependencies.unitOfWork.execute(async (transaction) => {
    const existing = await dependencies.stores.units.byId(transaction, unitId);

    if (existing === undefined) return notFound<TValue>('unit');
    return work(OrganizationUnit.rehydrate(existing), transaction);
  });
