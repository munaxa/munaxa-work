import { ConcurrencyException } from '@work/kernel';

import type { DevelopmentItemState, DevelopmentPlanState } from '../domain/development.js';
import type { MobilityRecommendationState } from '../domain/mobility.js';
import type { CareerPathState, CareerStageState } from '../domain/path.js';
import type { CareerPlanState } from '../domain/plan.js';
import type { PoolMembershipState, TalentPoolState } from '../domain/pool.js';
import type { ReadinessAssessmentState, ReadinessLevelState } from '../domain/readiness.js';
import type { SuccessionPlanState, SuccessorState } from '../domain/succession.js';
import type { Page, Paged } from './career-ports.js';

/**
 * The tables the in-memory stores share, and the production rules they all keep.
 *
 * **The optimistic version is checked on every update**, exactly as a real
 * `update ... where version = $expected` affects zero rows on a mismatch, and these fakes raise the
 * same `ConcurrencyException` a repository would rather than quietly succeeding. That is what makes
 * a stale write testable before any database exists.
 *
 * **A fake more permissive than the database hides the defects these suites exist to find**, so
 * every partial unique index Checkpoint 3 created is enforced here too: one active career plan per
 * employment, one active succession plan per position, one open nomination per plan and employment,
 * one open pool membership per pool and employment, and the code and ordinal uniqueness on paths,
 * pools and readiness levels.
 *
 * **A fake stricter than the database is just as wrong**, and the partial-ness is where that bites.
 * A *full* unique index would refuse a second career plan after the first ended, a re-nomination
 * after a withdrawal, and a rejoin after a membership closed — three things the schema deliberately
 * permits. Each predicate below therefore mirrors its index's `where` clause exactly.
 *
 * **What these stores do not prove**, stated rather than implied by a green suite: they are a single
 * process with no concurrency, so they demonstrate the *rule* and not the *race*. Two callers
 * arriving at the same instant is PostgreSQL's arbitration, and Checkpoint 3 already tested it
 * across two real connections. Nothing here claims to have re-proven that.
 *
 * **`career_readiness_assessment` has no update and no remove**, matching its production store and
 * the trigger behind it. A correction is a new assessment.
 */

export const paged = <TState>(items: readonly TState[], page: Paged): Page<TState> => ({
  items: items.slice(page.offset, page.offset + page.limit),
  total: items.length,
});

/**
 * The optimistic check, raising exactly what `Repository.updateRow` raises.
 *
 * `ConcurrencyException` rather than a quiet failure, because that is what the real repository
 * throws when its `where version = $expected` matches no row — and every module since Phase 2 lets
 * it travel to the edge, where it becomes a 409. A fake that returned a quiet failure instead would
 * let a losing writer look like a successful one.
 */
export const expectVersion = (
  table: string,
  held: { readonly version: number },
  expected: number,
): void => {
  if (held.version !== expected) throw new ConcurrencyException(table, expected, held.version);
};

export const bumped = <TState extends { readonly version: number }>(state: TState): TState => ({
  ...state,
  version: state.version + 1,
});

/** Reads the row an update targets, refusing the same way a vanished row would. */
export const heldOr = <TState>(table: string, candidate: TState | undefined): TState => {
  if (candidate === undefined) throw new ConcurrencyException(table, -1, -1);
  return candidate;
};

export interface Tables {
  readonly paths: Map<string, CareerPathState>;
  readonly stages: Map<string, CareerStageState>;
  readonly plans: Map<string, CareerPlanState>;
  readonly pools: Map<string, TalentPoolState>;
  readonly memberships: Map<string, PoolMembershipState>;
  readonly successionPlans: Map<string, SuccessionPlanState>;
  readonly successors: Map<string, SuccessorState>;
  readonly readinessLevels: Map<string, ReadinessLevelState>;
  readonly assessments: ReadinessAssessmentState[];
  readonly developmentPlans: Map<string, DevelopmentPlanState>;
  readonly developmentItems: Map<string, DevelopmentItemState>;
  readonly mobility: Map<string, MobilityRecommendationState>;
}

export const emptyTables = (): Tables => ({
  paths: new Map(),
  stages: new Map(),
  plans: new Map(),
  pools: new Map(),
  memberships: new Map(),
  successionPlans: new Map(),
  successors: new Map(),
  readinessLevels: new Map(),
  assessments: [],
  developmentPlans: new Map(),
  developmentItems: new Map(),
  mobility: new Map(),
});

/** `undefined` in a filter means "not filtered", never "match nothing". */
export const like = (value: string | undefined, expected: string | undefined): boolean =>
  expected === undefined || value === expected;

/** A bound the caller did not supply is no bound. An empty bound is still a bound. */
export const within = (value: string, bound: readonly string[] | undefined): boolean =>
  bound === undefined || bound.includes(value);

// ------------------------------------------------------------------------------------------------
// The partial unique indexes, as the fakes see them.
//
// Each predicate mirrors one index's `where` clause. Getting the *partial* part right matters more
// than getting the uniqueness right: a fake that refused too much would make the suites pass on
// behaviour PostgreSQL permits, which is the more expensive of the two mistakes because nothing
// would ever fail to reveal it.
// ------------------------------------------------------------------------------------------------

/** `career_plan_active_idx`: one active plan per employment. A draft or an ended plan is free. */
export const planConflicts = (
  tables: Tables,
  candidate: CareerPlanState,
): CareerPlanState | undefined =>
  candidate.status !== 'active'
    ? undefined
    : [...tables.plans.values()].find(
        (held) =>
          held.employmentId === candidate.employmentId &&
          held.status === 'active' &&
          held.careerPlanId !== candidate.careerPlanId,
      );

/** `career_succession_plan_active_idx`: one active plan per position. */
export const successionPlanConflicts = (
  tables: Tables,
  candidate: SuccessionPlanState,
): SuccessionPlanState | undefined =>
  candidate.status !== 'active'
    ? undefined
    : [...tables.successionPlans.values()].find(
        (held) =>
          held.positionId === candidate.positionId &&
          held.status === 'active' &&
          held.successionPlanId !== candidate.successionPlanId,
      );

/**
 * `career_successor_open_idx`: one **open** nomination per plan and employment.
 *
 * `nominated` and `confirmed` occupy the slot; `withdrawn` does not — somebody taken off a bench may
 * be put back on it (D-15's shape, per plan rather than per employment).
 */
export const successorConflicts = (
  tables: Tables,
  candidate: SuccessorState,
): SuccessorState | undefined =>
  [...tables.successors.values()].find(
    (held) =>
      held.successionPlanId === candidate.successionPlanId &&
      held.employmentId === candidate.employmentId &&
      (held.status === 'nominated' || held.status === 'confirmed') &&
      held.successorId !== candidate.successorId,
  );

/**
 * `career_pool_membership_open_idx`: one **open** membership per pool and employment.
 *
 * An ended period does not occupy the slot: a person may rejoin a pool they left, and may be in two
 * pools at once.
 */
export const membershipConflicts = (
  tables: Tables,
  candidate: PoolMembershipState,
): PoolMembershipState | undefined =>
  [...tables.memberships.values()].find(
    (held) =>
      held.talentPoolId === candidate.talentPoolId &&
      held.employmentId === candidate.employmentId &&
      held.to === undefined &&
      held.membershipId !== candidate.membershipId,
  );
