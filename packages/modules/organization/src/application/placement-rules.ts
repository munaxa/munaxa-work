import { success, type HandlerFailure, type Result, type Transaction } from '@work/kernel';

import { OrganizationUnit, type OrganizationUnitState } from '../domain/organization-unit.js';
import { OrganizationUnitType } from '../domain/organization-unit-type.js';
import {
  UnitPlacement,
  parentOn,
  wouldCreateCycle,
  type UnitPlacementState,
} from '../domain/unit-placement.js';

import { ancestorsOf, loadPlacementIndex } from './hierarchy.js';
import { notFound, originOfCurrentRequest, refusedBy } from './organization-context.js';
import type { OrganizationDependencies } from './organization-dependencies.js';

/**
 * The rules a placement must satisfy, and the timeline surgery a move performs.
 *
 * Split from the handler because they are the parts worth reading on their own: one decides
 * whether a change to the shape of the organization is legal, and the other is what keeps the
 * history answering exactly once.
 */

export interface ProposedPlacement {
  readonly unitId: string;
  readonly parentUnitId?: string;
  readonly effectiveFrom: Date;
}

/**
 * The period that makes this command a no-op: same parent, same start, still open.
 *
 * Same *start* matters as much as same parent. A unit that has been under this parent since
 * January and is placed under it again from June is a real change to record — the administrator
 * is restating the relationship from a later date — and only an exact match is a repeat.
 */
export const alreadyPlacedAsRequested = (
  periods: readonly UnitPlacementState[],
  command: ProposedPlacement,
): UnitPlacementState | undefined =>
  periods.find(
    (period) =>
      period.effectiveTo === undefined &&
      period.parentUnitId === command.parentUnitId &&
      period.effectiveFrom.getTime() === command.effectiveFrom.getTime(),
  );

/** The two rules a placement must satisfy, each checked by the function below it. */
export const checkPlacementIsPermitted = async (
  dependencies: OrganizationDependencies,
  transaction: Transaction,
  unit: OrganizationUnitState,
  command: ProposedPlacement,
): Promise<Result<true, HandlerFailure>> => {
  const byType = await checkTypeRulePermits(dependencies, transaction, unit, command);

  if (!byType.ok) return byType;
  if (command.parentUnitId === undefined) return success(true);

  return checkNoCycle(dependencies, transaction, unit, command.parentUnitId, command.effectiveFrom);
};

/**
 * The tenant's own rule about which levels may nest, and whether the parent is in a state that
 * can take new structure.
 *
 * Neither is this product's opinion: `allowedParentCodes` is configuration a tenant sets, and an
 * empty list means any parent — because a tenant that has not stated a rule does not have one.
 */
const checkTypeRulePermits = async (
  dependencies: OrganizationDependencies,
  transaction: Transaction,
  unit: OrganizationUnitState,
  command: ProposedPlacement,
): Promise<Result<true, HandlerFailure>> => {
  const type = await dependencies.stores.unitTypes.byId(transaction, unit.unitTypeId);

  if (type === undefined) return notFound<true>('unit type');

  const parent = await resolveParent(dependencies, transaction, command.parentUnitId);

  if (!parent.ok) return parent;

  const parentType =
    parent.value === undefined
      ? undefined
      : await dependencies.stores.unitTypes.byId(transaction, parent.value.unitTypeId);

  if (!OrganizationUnitType.rehydrate(type).permitsParent(parentType?.code)) {
    return refusedBy<true>({
      reason: 'placement_not_permitted_by_type',
      messageKey: 'organization.rejection.placement_not_permitted_by_type',
      values: { type: type.code, parent: parentType?.code ?? 'root' },
    });
  }
  return success(true);
};

/**
 * The parent, or the absence of one for a root — and a refusal if it was named but is not there,
 * or is not in a state that can take new structure.
 *
 * `undefined` is a legitimate answer, not a failure: a root is a real placement rather than an
 * absent one.
 */
const resolveParent = async (
  dependencies: OrganizationDependencies,
  transaction: Transaction,
  parentUnitId: string | undefined,
): Promise<Result<OrganizationUnitState | undefined, HandlerFailure>> => {
  if (parentUnitId === undefined) return success(undefined);

  const parent = await dependencies.stores.units.byId(transaction, parentUnitId);

  if (parent === undefined) return notFound<OrganizationUnitState | undefined>('parent unit');
  if (!OrganizationUnit.rehydrate(parent).canAcceptStructure()) {
    return refusedBy<OrganizationUnitState | undefined>({
      reason: 'parent_not_accepting_structure',
      messageKey: 'organization.rejection.parent_not_accepting_structure',
      values: { status: parent.status },
    });
  }
  return success(parent);
};

/**
 * A unit may not become its own ancestor.
 *
 * Checked *as of the effective date* rather than as of today: a back-dated move that was legal
 * in March must not be refused because of a placement made in June, and a forward-dated move
 * that would create a cycle in June must be refused now rather than discovered then.
 */
const checkNoCycle = async (
  dependencies: OrganizationDependencies,
  transaction: Transaction,
  unit: OrganizationUnitState,
  parentUnitId: string,
  effectiveFrom: Date,
): Promise<Result<true, HandlerFailure>> => {
  const index = await loadPlacementIndex(dependencies.stores.placements, transaction);

  if (wouldCreateCycle(unit.id, parentUnitId, ancestorsOf(index, parentUnitId, effectiveFrom))) {
    return refusedBy<true>({
      reason: 'placement_would_create_cycle',
      messageKey: 'organization.rejection.placement_would_create_cycle',
      values: { unit: unit.code },
    });
  }
  return success(true);
};

/**
 * Splits whichever period is in force at the new effective date, and reports where the new
 * period must end.
 *
 * `Timeline` decides which period that is rather than "the open one", and the difference is the
 * back-dated case. Correcting the record for March, on a unit that also moved in June, must
 * shorten the January period to March and leave the June move exactly where it is — so the new
 * March period runs until June rather than open-ended. Closing "the open one" instead would put
 * two answers in the middle of the history and none at the end; discarding the later period, as
 * a naive timeline replacement would, would delete a move somebody recorded.
 *
 * Returns the instant the new period must end at, or `undefined` for the ordinary case where it
 * runs open-ended.
 */
export const supersedePeriodInForce = async (
  dependencies: OrganizationDependencies,
  transaction: Transaction,
  periods: readonly UnitPlacementState[],
  effectiveFrom: Date,
): Promise<Result<Date | undefined, HandlerFailure>> => {
  const inForce = parentOn(periods, effectiveFrom);
  const state =
    inForce === undefined
      ? undefined
      : periods.find((period) => period.id === inForce.value.placementId);

  if (state === undefined) {
    // No period covers this date. It may still sit *before* one that does — placing a unit in
    // January when its earliest recorded period starts in June — so the new period ends where
    // the next one begins rather than running through it.
    return success(earliestStartAfter(periods, effectiveFrom));
  }

  const placement = UnitPlacement.rehydrate(state);
  const closed = placement.closeAt(
    effectiveFrom,
    originOfCurrentRequest(),
    dependencies.clock.now(),
  );

  if (!closed.ok) return refusedBy<Date | undefined>(closed.error);

  await dependencies.stores.placements.update(transaction, placement.snapshot(), state.version);
  transaction.collect(placement.pullEvents());
  return success(state.effectiveTo);
};

const earliestStartAfter = (
  periods: readonly UnitPlacementState[],
  instant: Date,
): Date | undefined =>
  periods
    .map((period) => period.effectiveFrom)
    .filter((start) => start.getTime() > instant.getTime())
    .sort((left, right) => left.getTime() - right.getTime())[0];
