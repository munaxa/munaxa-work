import { wasMemberOn } from '../domain/pool.js';
import {
  bumped,
  expectVersion,
  heldOr,
  like,
  membershipConflicts,
  paged,
  successionPlanConflicts,
  successorConflicts,
  within,
  type Tables,
} from './in-memory-tables.js';
import type {
  DevelopmentItemStore,
  DevelopmentPlanStore,
  MembershipStore,
  MobilityStore,
  ReadinessAssessmentStore,
  SuccessionPlanStore,
  SuccessorStore,
} from './career-ports.js';

/**
 * The record half of the in-memory stores: memberships, succession, readiness, development and
 * mobility.
 *
 * Two things here are worth reading twice.
 *
 * **`assessmentStore` has no `update` and no `remove`**, matching its production counterpart and the
 * trigger behind it (D-14). The absence is the guarantee: a store with no method to rewrite a
 * readiness assessment cannot be misused into rewriting one, and a suite cannot accidentally prove
 * that a correction overwrote the statement it corrected.
 *
 * **`inForceOn` uses the domain's own `wasMemberOn`** rather than reimplementing the comparison.
 * Both ends are inclusive — somebody removed on the 30th was in the pool on the 30th — and a fake
 * that got that boundary wrong by one would quietly disagree with the SQL the repository will write.
 */

export const membershipStore = (tables: Tables): MembershipStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.memberships.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.memberships.values()].filter(
          (held) =>
            like(held.talentPoolId, filters.talentPoolId) &&
            like(held.employmentId, filters.employmentId) &&
            within(held.employmentId, filters.employmentIdsIn) &&
            (filters.openOnly !== true || held.to === undefined) &&
            (filters.inForceOn === undefined || wasMemberOn(held, filters.inForceOn)),
        ),
        page,
      ),
    ),
  openFor: (_transaction, talentPoolId, employmentId) =>
    Promise.resolve(
      [...tables.memberships.values()].find(
        (held) =>
          held.talentPoolId === talentPoolId &&
          held.employmentId === employmentId &&
          held.to === undefined,
      ),
    ),
  insertIfAbsent: (_transaction, state) => {
    if (membershipConflicts(tables, state) !== undefined) return Promise.resolve(false);
    tables.memberships.set(state.membershipId, state);
    return Promise.resolve(true);
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('career_pool_membership', tables.memberships.get(state.membershipId));

    expectVersion('career_pool_membership', held, expected);
    tables.memberships.set(state.membershipId, bumped(state));
    return Promise.resolve();
  },
});

export const successionPlanStore = (tables: Tables): SuccessionPlanStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.successionPlans.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.successionPlans.values()].filter(
          (held) =>
            like(held.positionId, filters.positionId) &&
            like(held.status, filters.status) &&
            (filters.reviewOnOrBefore === undefined ||
              (held.status === 'active' &&
                held.reviewOn !== undefined &&
                held.reviewOn <= filters.reviewOnOrBefore)),
        ),
        page,
      ),
    ),
  activeFor: (_transaction, positionId) =>
    Promise.resolve(
      [...tables.successionPlans.values()].find(
        (held) => held.positionId === positionId && held.status === 'active',
      ),
    ),
  insertIfAbsent: (_transaction, state) => {
    if (successionPlanConflicts(tables, state) !== undefined) return Promise.resolve(false);
    tables.successionPlans.set(state.successionPlanId, state);
    return Promise.resolve(true);
  },
  update: (_transaction, state, expected) => {
    const held = heldOr(
      'career_succession_plan',
      tables.successionPlans.get(state.successionPlanId),
    );

    expectVersion('career_succession_plan', held, expected);
    if (successionPlanConflicts(tables, state) !== undefined) {
      throw new ConflictingActiveSuccessionPlan(state.positionId);
    }
    tables.successionPlans.set(state.successionPlanId, bumped(state));
    return Promise.resolve();
  },
});

/** What a second active succession plan for one position raises. `career_succession_plan_active_idx`. */
export class ConflictingActiveSuccessionPlan extends Error {
  public constructor(public readonly positionId: string) {
    super(`career_succession_plan_active_idx: ${positionId} already has an active succession plan`);
    this.name = 'ConflictingActiveSuccessionPlan';
  }
}

export const successorStore = (tables: Tables): SuccessorStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.successors.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.successors.values()].filter(
          (held) =>
            like(held.successionPlanId, filters.successionPlanId) &&
            like(held.employmentId, filters.employmentId) &&
            like(held.status, filters.status) &&
            within(held.employmentId, filters.employmentIdsIn),
        ),
        page,
      ),
    ),
  forPlan: (_transaction, successionPlanId) =>
    Promise.resolve(
      [...tables.successors.values()]
        .filter((held) => held.successionPlanId === successionPlanId)
        .sort((first, second) => (first.rank ?? Infinity) - (second.rank ?? Infinity)),
    ),
  openFor: (_transaction, successionPlanId, employmentId) =>
    Promise.resolve(
      [...tables.successors.values()].find(
        (held) =>
          held.successionPlanId === successionPlanId &&
          held.employmentId === employmentId &&
          (held.status === 'nominated' || held.status === 'confirmed'),
      ),
    ),
  benchCountsOf: (_transaction, successionPlanId) => {
    const bench = [...tables.successors.values()].filter(
      (held) => held.successionPlanId === successionPlanId,
    );

    return Promise.resolve({
      nominated: bench.filter((held) => held.status === 'nominated').length,
      confirmed: bench.filter((held) => held.status === 'confirmed').length,
    });
  },
  insertIfAbsent: (_transaction, state) => {
    if (successorConflicts(tables, state) !== undefined) return Promise.resolve(false);
    tables.successors.set(state.successorId, state);
    return Promise.resolve(true);
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('career_successor', tables.successors.get(state.successorId));

    expectVersion('career_successor', held, expected);
    tables.successors.set(state.successorId, bumped(state));
    return Promise.resolve();
  },
});

/**
 * Insert and read. **No update, no remove** (D-14).
 *
 * An array rather than a map, because an assessment has no identity anybody replaces — the sequence
 * is the record. `historyFor` returns most recent first, breaking a same-day tie on `recordedAt`, so
 * the correction sorts above the statement it corrected.
 */
export const assessmentStore = (tables: Tables): ReadinessAssessmentStore => ({
  byId: (_transaction, id) =>
    Promise.resolve(tables.assessments.find((held) => held.readinessAssessmentId === id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        tables.assessments.filter(
          (held) =>
            like(held.employmentId, filters.employmentId) &&
            like(held.successionPlanId, filters.successionPlanId) &&
            like(held.positionId, filters.positionId) &&
            like(held.readinessLevelId, filters.readinessLevelId) &&
            within(held.employmentId, filters.employmentIdsIn),
        ),
        page,
      ),
    ),
  historyFor: (_transaction, employmentId) =>
    Promise.resolve(
      tables.assessments.filter((held) => held.employmentId === employmentId).sort(mostRecentFirst),
    ),
  insert: (_transaction, state) => {
    tables.assessments.push(state);
    return Promise.resolve();
  },
});

const mostRecentFirst = (
  first: { readonly assessedOn: string; readonly recordedAt: Date },
  second: { readonly assessedOn: string; readonly recordedAt: Date },
): number =>
  second.assessedOn === first.assessedOn
    ? second.recordedAt.getTime() - first.recordedAt.getTime()
    : second.assessedOn.localeCompare(first.assessedOn);

export const developmentPlanStore = (tables: Tables): DevelopmentPlanStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.developmentPlans.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.developmentPlans.values()].filter(
          (held) =>
            like(held.employmentId, filters.employmentId) &&
            like(held.status, filters.status) &&
            like(held.careerPlanId, filters.careerPlanId) &&
            within(held.employmentId, filters.employmentIdsIn),
        ),
        page,
      ),
    ),
  activeFor: (_transaction, employmentId) =>
    Promise.resolve(
      [...tables.developmentPlans.values()].find(
        (held) => held.employmentId === employmentId && held.status === 'active',
      ),
    ),
  insert: (_transaction, state) => {
    tables.developmentPlans.set(state.developmentPlanId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr(
      'career_development_plan',
      tables.developmentPlans.get(state.developmentPlanId),
    );

    expectVersion('career_development_plan', held, expected);
    tables.developmentPlans.set(state.developmentPlanId, bumped(state));
    return Promise.resolve();
  },
});

export const developmentItemStore = (tables: Tables): DevelopmentItemStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.developmentItems.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.developmentItems.values()].filter(
          (held) =>
            like(held.developmentPlanId, filters.developmentPlanId) &&
            like(held.category, filters.category) &&
            like(held.status, filters.status) &&
            (filters.targetOnOrBefore === undefined ||
              (held.targetDate !== undefined && held.targetDate <= filters.targetOnOrBefore)),
        ),
        page,
      ),
    ),
  forPlan: (_transaction, developmentPlanId) =>
    Promise.resolve(
      [...tables.developmentItems.values()].filter(
        (held) => held.developmentPlanId === developmentPlanId,
      ),
    ),
  itemCountOf: (_transaction, developmentPlanId) =>
    Promise.resolve(
      [...tables.developmentItems.values()].filter(
        (held) => held.developmentPlanId === developmentPlanId,
      ).length,
    ),
  insert: (_transaction, state) => {
    tables.developmentItems.set(state.developmentItemId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr(
      'career_development_item',
      tables.developmentItems.get(state.developmentItemId),
    );

    expectVersion('career_development_item', held, expected);
    tables.developmentItems.set(state.developmentItemId, bumped(state));
    return Promise.resolve();
  },
});

/**
 * Mobility recommendations.
 *
 * `status` filters the **stored** value, which is never `expired` — a check constraint refuses that
 * word at the table and this store never produces it either. A caller filtering on `expired` matches
 * nothing, which is correct: expiry is derived at the view boundary from `validUntil` and the day
 * asked (D-13).
 */
export const mobilityStore = (tables: Tables): MobilityStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.mobility.get(id)),
  search: (_transaction, filters, page) =>
    Promise.resolve(
      paged(
        [...tables.mobility.values()].filter(
          (held) =>
            like(held.employmentId, filters.employmentId) &&
            like(held.status, filters.status) &&
            like(held.kind, filters.kind) &&
            within(held.employmentId, filters.employmentIdsIn),
        ),
        page,
      ),
    ),
  openFor: (_transaction, employmentId) =>
    Promise.resolve(
      [...tables.mobility.values()].filter(
        (held) => held.employmentId === employmentId && held.status === 'proposed',
      ),
    ),
  insert: (_transaction, state) => {
    tables.mobility.set(state.mobilityRecommendationId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr(
      'career_mobility_recommendation',
      tables.mobility.get(state.mobilityRecommendationId),
    );

    expectVersion('career_mobility_recommendation', held, expected);
    tables.mobility.set(state.mobilityRecommendationId, bumped(state));
    return Promise.resolve();
  },
});
