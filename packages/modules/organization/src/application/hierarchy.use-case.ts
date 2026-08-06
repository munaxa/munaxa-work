import { success, type Command, type CommandHandler } from '@work/kernel';

import { UnitPlacement } from '../domain/unit-placement.js';

import {
  alreadyPlacedAsRequested,
  checkPlacementIsPermitted,
  supersedePeriodInForce,
} from './placement-rules.js';
import {
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './organization-context.js';
import { OrganizationPermissions } from './organization-permissions.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * Placing a unit under a parent, and detaching it.
 *
 * This is the only write in the module that changes the *shape* of the organization, and it is
 * the one the whole phase turns on: a move must supersede rather than overwrite, so that
 * "which division was this department under last March" keeps its old answer and gains a new one
 * for dates after the move.
 *
 * The sequence is deliberate and the order matters:
 *
 * 1. Refuse a move that would make the unit its own ancestor. A cycle is not bad data, it is a
 *    structure walk that never terminates.
 * 2. Close the period in force at the effective date — *at* that date, so the two periods meet
 *    exactly and there is no instant with two answers or none.
 * 3. Open the new one.
 *
 * All three happen in one transaction, so a failure at step three cannot leave a unit whose
 * placement was closed and never reopened — which would be a unit that silently vanished from
 * the org chart.
 */

export interface PlaceUnitCommand extends Command {
  readonly commandName: 'organization.place-unit';
  readonly unitId: string;
  /** Absent means "make this a root of the structure", which is a placement, not an absence. */
  readonly parentUnitId?: string;
  readonly effectiveFrom: Date;
}

export interface UnitPlaced {
  readonly placementId: string;
  readonly unitId: string;
  readonly parentUnitId?: string;
  readonly effectiveFrom: Date;
}

export const placeUnitHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<PlaceUnitCommand, UnitPlaced> => ({
  commandName: 'organization.place-unit',
  permission: OrganizationPermissions.hierarchyManage,

  validate: (command) =>
    command.parentUnitId === command.unitId && command.parentUnitId !== undefined
      ? [{ field: 'parentUnitId', message: 'a unit cannot be its own parent' }]
      : [],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const unit = await dependencies.stores.units.byId(transaction, command.unitId);

      if (unit === undefined) return notFound<UnitPlaced>('unit');

      const permitted = await checkPlacementIsPermitted(dependencies, transaction, unit, command);

      if (!permitted.ok) return permitted;

      const existing = await dependencies.stores.placements.forUnit(transaction, command.unitId);
      const already = alreadyPlacedAsRequested(existing, command);

      // Placing a unit where it already is, from the date it has been there since, is a no-op
      // rather than a new period. Without this, re-running an import after fixing one bad row
      // would either refuse (two periods starting at the same instant) or write a period of no
      // duration, and an import that cannot be re-run is an import nobody can recover from.
      if (already !== undefined) {
        return success({
          placementId: already.id,
          unitId: command.unitId,
          ...(already.parentUnitId === undefined ? {} : { parentUnitId: already.parentUnitId }),
          effectiveFrom: already.effectiveFrom,
        });
      }

      const superseded = await supersedePeriodInForce(
        dependencies,
        transaction,
        existing,
        command.effectiveFrom,
      );

      if (!superseded.ok) return superseded;

      const placement = UnitPlacement.open(
        {
          tenantId: currentTenant(),
          unitId: command.unitId,
          ...(command.parentUnitId === undefined ? {} : { parentUnitId: command.parentUnitId }),
          effectiveFrom: command.effectiveFrom,
          // Bounded only when this placement is being inserted *in front of* a period that was
          // recorded earlier — a back-dated correction ahead of a move already on the record.
          ...(superseded.value === undefined ? {} : { effectiveTo: superseded.value }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      await dependencies.stores.placements.insert(transaction, placement.snapshot());
      transaction.collect(placement.pullEvents());

      return success({
        placementId: placement.id,
        unitId: command.unitId,
        ...(command.parentUnitId === undefined ? {} : { parentUnitId: command.parentUnitId }),
        effectiveFrom: command.effectiveFrom,
      });
    }),
});

export interface DetachUnitCommand extends Command {
  readonly commandName: 'organization.detach-unit';
  readonly unitId: string;
  readonly effectiveTo: Date;
  readonly expectedVersion: number;
}

export const detachUnitHandler = (
  dependencies: OrganizationDependencies,
): CommandHandler<DetachUnitCommand, UnitPlaced> => ({
  commandName: 'organization.detach-unit',
  permission: OrganizationPermissions.hierarchyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const periods = await dependencies.stores.placements.forUnit(transaction, command.unitId);
      const open = periods.find((period) => period.effectiveTo === undefined);

      if (open === undefined) return notFound<UnitPlaced>('open placement');

      const placement = UnitPlacement.rehydrate(open);
      const closed = placement.closeAt(
        command.effectiveTo,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!closed.ok) return refusedBy(closed.error);

      await dependencies.stores.placements.update(
        transaction,
        placement.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(placement.pullEvents());

      return success({
        placementId: placement.id,
        unitId: command.unitId,
        ...(placement.parentUnitId === undefined ? {} : { parentUnitId: placement.parentUnitId }),
        effectiveFrom: open.effectiveFrom,
      });
    }),
});
