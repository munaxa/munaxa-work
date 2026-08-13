import {
  bumped,
  expectVersion,
  heldOr,
  like,
  paged,
  planConflicts,
  type Tables,
} from './in-memory-tables.js';
import type { PathStore, PlanStore, PoolStore, ReadinessLevelStore } from './career-ports.js';

/**
 * The configuration half of the in-memory stores: paths and their stages, career plans, pools and
 * readiness levels.
 *
 * Split from the record half so each factory stays readable rather than becoming one wall — the
 * shape Learning's two files and Performance's three established.
 *
 * `stageCountOf` and its siblings count the table rather than a page, because that is what the
 * production repository does with `count(*)`. A fake that returned `items.length` would let a
 * handler pass a test it would fail against a real bench of more than fifty.
 */

export const pathStore = (tables: Tables): PathStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.paths.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.paths.values()].find((held) => held.code === code)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.paths.values()].filter(
          (held) => like(held.status, filters.status) && like(held.kind, filters.kind),
        ),
        page,
      ),
    ),
  stagesFor: (_transaction, pathId) =>
    Promise.resolve(
      [...tables.stages.values()]
        .filter((held) => held.pathId === pathId)
        .sort((first, second) => first.sequence - second.sequence),
    ),
  stageCountOf: (_transaction, pathId) =>
    Promise.resolve([...tables.stages.values()].filter((held) => held.pathId === pathId).length),
  insert: (_transaction, state) => {
    tables.paths.set(state.pathId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('career_path', tables.paths.get(state.pathId));

    expectVersion('career_path', held, expected);
    tables.paths.set(state.pathId, bumped(state));
    return Promise.resolve();
  },
  insertStage: (_transaction, state) => {
    tables.stages.set(state.stageId, state);
    return Promise.resolve();
  },
  stageById: (_transaction, id) => Promise.resolve(tables.stages.get(id)),
});

/**
 * Career plans.
 *
 * `insertIfAbsent` and `update` both consult `planConflicts`, because the one-active-plan index does
 * not care which statement produced the row: activating a second draft is refused exactly as
 * inserting a second active plan is. The update path raises `ConcurrencyException` rather than
 * returning `false`, which is what a `unique_violation` surfaced through `updateRow` becomes at the
 * edge — a 409 saying somebody else changed this person's plan while you were looking at it.
 */
export const planStore = (tables: Tables): PlanStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.plans.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.plans.values()].filter(
          (held) =>
            like(held.employmentId, filters.employmentId) &&
            like(held.pathId, filters.pathId) &&
            like(held.status, filters.status) &&
            (filters.employmentIdsIn === undefined ||
              filters.employmentIdsIn.includes(held.employmentId)),
        ),
        page,
      ),
    ),
  activeFor: (_transaction, employmentId) =>
    Promise.resolve(
      [...tables.plans.values()].find(
        (held) => held.employmentId === employmentId && held.status === 'active',
      ),
    ),
  insertIfAbsent: (_transaction, state) => {
    if (planConflicts(tables, state) !== undefined) return Promise.resolve(false);
    tables.plans.set(state.careerPlanId, state);
    return Promise.resolve(true);
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('career_plan', tables.plans.get(state.careerPlanId));

    expectVersion('career_plan', held, expected);
    if (planConflicts(tables, state) !== undefined) {
      throw new ConflictingActivePlan(state.employmentId);
    }
    tables.plans.set(state.careerPlanId, bumped(state));
    return Promise.resolve();
  },
});

/**
 * What a second active plan for one employment raises.
 *
 * A named error rather than a bare `Error`, so a suite asserting on it names the invariant instead
 * of matching a message — and so the reader sees that the *database* is what refuses this, with the
 * fake standing in for `career_plan_active_idx`.
 */
export class ConflictingActivePlan extends Error {
  public constructor(public readonly employmentId: string) {
    super(`career_plan_active_idx: ${employmentId} already has an active career plan`);
    this.name = 'ConflictingActivePlan';
  }
}

export const poolStore = (tables: Tables): PoolStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.pools.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.pools.values()].find((held) => held.code === code)),
  all: (_transaction, status, page) =>
    Promise.resolve(
      paged(
        [...tables.pools.values()].filter((held) => like(held.status, status)),
        page,
      ),
    ),
  insert: (_transaction, state) => {
    tables.pools.set(state.talentPoolId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('career_talent_pool', tables.pools.get(state.talentPoolId));

    expectVersion('career_talent_pool', held, expected);
    tables.pools.set(state.talentPoolId, bumped(state));
    return Promise.resolve();
  },
});

/** The tenant's ladder. Ordered by `ordinal`, least to most ready — never published as a scale. */
export const readinessLevelStore = (tables: Tables): ReadinessLevelStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.readinessLevels.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.readinessLevels.values()].find((held) => held.code === code)),
  byOrdinal: (_transaction, ordinal) =>
    Promise.resolve([...tables.readinessLevels.values()].find((held) => held.ordinal === ordinal)),
  all: (_transaction, activeOnly) =>
    Promise.resolve(
      [...tables.readinessLevels.values()]
        .filter((held) => !activeOnly || held.active)
        .sort((first, second) => first.ordinal - second.ordinal),
    ),
  insert: (_transaction, state) => {
    tables.readinessLevels.set(state.readinessLevelId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr(
      'career_readiness_level',
      tables.readinessLevels.get(state.readinessLevelId),
    );

    expectVersion('career_readiness_level', held, expected);
    tables.readinessLevels.set(state.readinessLevelId, bumped(state));
    return Promise.resolve();
  },
});
