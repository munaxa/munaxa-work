import { success, type Command, type CommandHandler } from '@work/kernel';

import { OrganizationUnitType } from '../domain/organization-unit-type.js';

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
 * Defining and retiring the levels of this tenant's hierarchy.
 *
 * There is no command here that creates the nine levels the specification names, and that
 * absence is deliberate (ADR-0034). A tenant defines the levels it has. The nine are documented
 * as a starting set an administrator may adopt, not a set the product installs — a customer
 * whose structure is company, region and store should never have to look at *division* and
 * *section* to find out they are unused.
 */

export interface DefineUnitTypeCommand extends Command {
  readonly commandName: 'organization.define-unit-type';
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly ordinal: number;
  readonly allowedParentCodes?: readonly string[];
  readonly allowedAtRoot?: boolean;
  readonly carriesLegalEntity?: boolean;
}

export interface UnitTypeDefined {
  readonly unitTypeId: string;
  readonly code: string;
}

export const defineUnitTypeHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<DefineUnitTypeCommand, UnitTypeDefined> => ({
  commandName: 'organization.define-unit-type',
  permission: OrganizationPermissions.unitTypeManage,

  validate: (command) =>
    Number.isInteger(command.ordinal) && command.ordinal >= 0
      ? []
      : [{ field: 'ordinal', message: 'must be a whole number, zero or greater' }],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.unitTypes.byCode(transaction, command.code);

      // Checked here as well as by the unique index, so the caller gets "that code is taken"
      // rather than a constraint violation they cannot act on.
      if (existing !== undefined) return conflicted('unit_type_code_taken');

      const defined = OrganizationUnitType.define(
        {
          tenantId: currentTenant(),
          code: command.code,
          name: command.name,
          ordinal: command.ordinal,
          ...(command.allowedParentCodes === undefined
            ? {}
            : { allowedParentCodes: command.allowedParentCodes }),
          ...(command.allowedAtRoot === undefined ? {} : { allowedAtRoot: command.allowedAtRoot }),
          ...(command.carriesLegalEntity === undefined
            ? {}
            : { carriesLegalEntity: command.carriesLegalEntity }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!defined.ok) return refusedBy(defined.error);

      await dependencies.stores.unitTypes.insert(transaction, defined.value.snapshot());
      transaction.collect(defined.value.pullEvents());
      return success({ unitTypeId: defined.value.id, code: defined.value.code });
    }),
});

export interface RetireUnitTypeCommand extends Command {
  readonly commandName: 'organization.retire-unit-type';
  readonly unitTypeId: string;
  readonly expectedVersion: number;
}

export const retireUnitTypeHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<RetireUnitTypeCommand, UnitTypeDefined> => ({
  commandName: 'organization.retire-unit-type',
  permission: OrganizationPermissions.unitTypeManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.unitTypes.byId(transaction, command.unitTypeId);

      if (existing === undefined) return notFound('unit type');

      const type = OrganizationUnitType.rehydrate(existing);
      const retired = type.retire(originOfCurrentRequest(), dependencies.clock.now());

      if (!retired.ok) return refusedBy(retired.error);

      await dependencies.stores.unitTypes.update(
        transaction,
        type.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(type.pullEvents());
      return success({ unitTypeId: type.id, code: type.code });
    }),
});
