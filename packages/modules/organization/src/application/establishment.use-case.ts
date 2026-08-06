import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import {
  Establishment,
  establishmentTimeline,
  type EstablishmentState,
} from '../domain/establishment.js';
import type { EstablishmentStatus } from '../domain/organization-vocabulary.js';

import {
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './organization-context.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * Manpower planning: how many of a position a unit is budgeted to have, from a date.
 *
 * Setting an establishment supersedes rather than overwrites, exactly as a placement does, and
 * for the same reason: "how many did we approve for this branch last year" is a question an
 * audit asks, and a mutable number cannot answer it. The period in force at the new effective
 * date is closed *at* that date, so the two meet exactly.
 */

export interface SetEstablishmentCommand extends Command {
  readonly commandName: 'organization.set-establishment';
  readonly positionId: string;
  readonly unitId: string;
  readonly budgetedHeadcount: number;
  readonly effectiveFrom: Date;
}

export interface EstablishmentChanged {
  readonly establishmentId: string;
  readonly positionId: string;
  readonly unitId: string;
  readonly budgetedHeadcount: number;
  readonly status: EstablishmentStatus;
}

export const setEstablishmentHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<SetEstablishmentCommand, EstablishmentChanged> => ({
  commandName: 'organization.set-establishment',
  permission: OrganizationPermissions.establishmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const position = await dependencies.stores.positions.byId(transaction, command.positionId);

      if (position === undefined) return notFound<EstablishmentChanged>('position');

      const unit = await dependencies.stores.units.byId(transaction, command.unitId);

      if (unit === undefined) return notFound<EstablishmentChanged>('unit');

      const existing = await dependencies.stores.establishments.forPositionInUnit(
        transaction,
        command.positionId,
        command.unitId,
      );
      const closed = await closePeriodInForce(
        dependencies,
        transaction,
        existing,
        command.effectiveFrom,
      );

      if (!closed.ok) return closed;

      const line = Establishment.set(
        {
          tenantId: currentTenant(),
          positionId: command.positionId,
          unitId: command.unitId,
          budgetedHeadcount: command.budgetedHeadcount,
          effectiveFrom: command.effectiveFrom,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!line.ok) return refusedBy(line.error);

      await dependencies.stores.establishments.insert(transaction, line.value.snapshot());
      transaction.collect(line.value.pullEvents());
      return success({
        establishmentId: line.value.id,
        positionId: line.value.positionId,
        unitId: line.value.unitId,
        budgetedHeadcount: line.value.budgetedHeadcount,
        status: line.value.currentStatus,
      });
    }),
});

export interface ApproveEstablishmentCommand extends Command {
  readonly commandName: 'organization.approve-establishment';
  readonly establishmentId: string;
  readonly expectedVersion: number;
}

export const approveEstablishmentHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<ApproveEstablishmentCommand, EstablishmentChanged> => ({
  commandName: 'organization.approve-establishment',
  // Separate from `establishmentManage` deliberately: proposing a budget and approving one are
  // different acts, and a requisition is validated against the approved figure (Phase 6).
  permission: OrganizationPermissions.establishmentApprove,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.establishments.byId(
        transaction,
        command.establishmentId,
      );

      if (existing === undefined) return notFound<EstablishmentChanged>('establishment');

      const line = Establishment.rehydrate(existing);
      // The approver is the authenticated actor from the context, never a field on the command:
      // a caller that could name its own approver could approve its own budget as somebody else.
      const approved = line.approve(
        originOfCurrentRequest().actor,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!approved.ok) return refusedBy(approved.error);

      await dependencies.stores.establishments.update(
        transaction,
        line.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(line.pullEvents());
      return success({
        establishmentId: line.id,
        positionId: line.positionId,
        unitId: line.unitId,
        budgetedHeadcount: line.budgetedHeadcount,
        status: line.currentStatus,
      });
    }),
});

/** Closes whichever period is in force at the new effective date, as a placement move does. */
const closePeriodInForce = async (
  dependencies: OrganizationDependencies,
  transaction: Transaction,
  periods: readonly EstablishmentState[],
  effectiveFrom: Date,
): Promise<Result<true, HandlerFailure>> => {
  const inForce = establishmentTimeline(periods).at(effectiveFrom);

  if (inForce === undefined) return success(true);

  const line = Establishment.rehydrate(inForce.value);
  const closed = line.closeAt(effectiveFrom, originOfCurrentRequest(), dependencies.clock.now());

  if (!closed.ok) return refusedBy<true>(closed.error);

  await dependencies.stores.establishments.update(
    transaction,
    line.snapshot(),
    inForce.value.version,
  );
  transaction.collect(line.pullEvents());
  return success(true);
};
