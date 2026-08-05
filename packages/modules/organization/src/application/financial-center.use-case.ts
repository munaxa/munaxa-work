import { success, type Command, type CommandHandler } from '@work/kernel';

import { FinancialCenter, type CenterKind } from '../domain/financial-center.js';
import type { Metadata } from '../domain/organization-aggregate.js';
import type { OrganizationStatus } from '../domain/organization-vocabulary.js';

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
 * Opening and closing cost and profit centres.
 *
 * Four handlers built from two factories, because the two concepts have the same shape and the
 * same rules — duplicating the pipeline would guarantee they drift the first time one of them
 * gained a field.
 *
 * What is *not* shared is the permission, and that is why there are four handlers rather than
 * two with a `kind` field. The pipeline resolves a handler's permission before the handler runs,
 * so a single handler can declare only one; and in most finance functions the person who
 * maintains cost centres is not the person who maintains profit centres. Parameterizing the
 * factory by kind keeps one implementation and gives each kind its own guarded command.
 */

export interface OpenCenterCommand extends Command {
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly unitId?: string;
  readonly metadata?: Metadata;
  readonly effectiveFrom: Date;
}

export interface OpenCostCenter extends OpenCenterCommand {
  readonly commandName: 'organization.open-cost-center';
}

export interface OpenProfitCenter extends OpenCenterCommand {
  readonly commandName: 'organization.open-profit-center';
}

export interface CenterChanged {
  readonly centerId: string;
  readonly kind: CenterKind;
  readonly code: string;
  readonly status: OrganizationStatus;
}

const openHandler = <TCommand extends OpenCenterCommand>(
  dependencies: OrganizationDependencies,
  commandName: TCommand['commandName'],
  kind: CenterKind,
  permission: string,
): CommandHandler<TCommand, CenterChanged> => ({
  commandName,
  permission,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (command.unitId !== undefined) {
        const unit = await dependencies.stores.units.byId(transaction, command.unitId);

        // Read first, so a centre attached to another tenant's unit is impossible in code as
        // well as in the database, and the caller gets "no such unit" rather than a foreign key
        // error they cannot act on.
        if (unit === undefined) return notFound<CenterChanged>('unit');
      }

      const taken = await dependencies.stores.centers.byCode(transaction, kind, command.code);

      if (taken !== undefined) return conflicted<CenterChanged>('center_code_taken');

      const opened = FinancialCenter.open(
        {
          tenantId: currentTenant(),
          kind,
          code: command.code,
          name: command.name,
          ...(command.unitId === undefined ? {} : { unitId: command.unitId }),
          ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
          effectiveFrom: command.effectiveFrom,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!opened.ok) return refusedBy(opened.error);

      await dependencies.stores.centers.insert(transaction, opened.value.snapshot());
      transaction.collect(opened.value.pullEvents());
      return success({
        centerId: opened.value.id,
        kind: opened.value.kind,
        code: opened.value.code,
        status: opened.value.currentStatus,
      });
    }),
});

export const openCostCenterHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<OpenCostCenter, CenterChanged> =>
  openHandler<OpenCostCenter>(
    dependencies,
    'organization.open-cost-center',
    'cost',
    OrganizationPermissions.costCenterManage,
  );

export const openProfitCenterHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<OpenProfitCenter, CenterChanged> =>
  openHandler<OpenProfitCenter>(
    dependencies,
    'organization.open-profit-center',
    'profit',
    OrganizationPermissions.profitCenterManage,
  );

export interface CloseCenterCommand extends Command {
  readonly centerId: string;
  readonly effectiveTo: Date;
  readonly expectedVersion: number;
}

export interface CloseCostCenter extends CloseCenterCommand {
  readonly commandName: 'organization.close-cost-center';
}

export interface CloseProfitCenter extends CloseCenterCommand {
  readonly commandName: 'organization.close-profit-center';
}

const closeHandler = <TCommand extends CloseCenterCommand>(
  dependencies: OrganizationDependencies,
  commandName: TCommand['commandName'],
  kind: CenterKind,
  permission: string,
): CommandHandler<TCommand, CenterChanged> => ({
  commandName,
  permission,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.centers.byId(transaction, command.centerId);

      if (existing === undefined) return notFound<CenterChanged>('centre');

      // The permission that guarded this command is the one for `kind`, so a caller holding only
      // the cost-centre permission must not reach a profit centre by identifier. Refusing as
      // "not found" rather than "forbidden" is deliberate: the caller has no business knowing
      // that identifier names anything.
      if (existing.kind !== kind) return notFound<CenterChanged>('centre');

      const center = FinancialCenter.rehydrate(existing);
      const closed = center.close(
        command.effectiveTo,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!closed.ok) return refusedBy(closed.error);

      await dependencies.stores.centers.update(
        transaction,
        center.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(center.pullEvents());
      return success({
        centerId: center.id,
        kind: center.kind,
        code: center.code,
        status: center.currentStatus,
      });
    }),
});

export const closeCostCenterHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<CloseCostCenter, CenterChanged> =>
  closeHandler<CloseCostCenter>(
    dependencies,
    'organization.close-cost-center',
    'cost',
    OrganizationPermissions.costCenterManage,
  );

export const closeProfitCenterHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<CloseProfitCenter, CenterChanged> =>
  closeHandler<CloseProfitCenter>(
    dependencies,
    'organization.close-profit-center',
    'profit',
    OrganizationPermissions.profitCenterManage,
  );
