import { success, type Query, type QueryHandler } from '@work/kernel';

import type {
  BenchStrengthView,
  CareerPlanView,
  DevelopmentPlanDetailView,
  MobilityRecommendationView,
  PoolMembershipView,
  ReadinessAssessmentView,
} from '../contracts/views.js';
import { civilDateOf, notFound } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import {
  careerPlanView,
  developmentItemView,
  developmentMixView,
  developmentPlanView,
  mobilityRecommendationView,
  poolMembershipView,
  readinessAssessmentView,
} from './career-views.js';
import { boundOf, personScopeFor, type ReadScope } from './authorization.js';
import { emptyPage, pageOf } from './career-paging.js';
import type { Page } from './career-ports.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Reading records about named people — plans, memberships, assessments, development and mobility.
 *
 * **A record read is scoped before it is filtered.** A caller with no scope gets an empty page
 * rather than an unbounded one, and an `employmentId` in the request never widens what the caller
 * may see: it is a filter applied *inside* the scope, never a credential that establishes one.
 *
 * That distinction is the whole of the self-service story here. `career.plan.read-team` resolves to
 * nothing, whatever `managerEmploymentId` a caller types, because this product cannot say which
 * employment the caller *is* (ADR-0032). Honouring the identifier would let anybody read anybody's
 * readiness standing by changing a number in a URL — a worse version of the IDOR Learning avoided,
 * because "your manager has recorded that you are not ready" is more sensitive than a training
 * record. `NOT VERIFIED`, and the scope resolver says so rather than guessing.
 */

const scopeFor = (dependencies: CareerDependencies, wide: string): Promise<ReadScope> =>
  personScopeFor(dependencies, wide);

/**
 * The employment filter, and the scope's bound where it has one.
 *
 * The two are not the same thing and the order matters: `employmentId` is what the caller asked
 * for, `employmentIdsIn` is what they are allowed to see. A store applies both, so a caller naming
 * an employment outside their bound matches nothing rather than widening the bound.
 */
const filtersWith = (
  scope: ReadScope,
  employmentId: string | undefined,
): { readonly employmentId?: string; readonly employmentIdsIn?: readonly string[] } => {
  const bound = boundOf(scope);

  return {
    ...(employmentId === undefined ? {} : { employmentId }),
    ...(bound === undefined ? {} : { employmentIdsIn: bound }),
  };
};

export interface SearchCareerPlans extends Query {
  readonly queryName: 'career.search-plans';
  readonly employmentId?: string;
  readonly pathId?: string;
  readonly status?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchPlansHandler = (
  dependencies: CareerDependencies,
): QueryHandler<SearchCareerPlans, Page<CareerPlanView>> => ({
  queryName: 'career.search-plans',
  permission: CareerPermissions.planRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scope = await scopeFor(dependencies, CareerPermissions.planRead);

      if (scope.kind === 'none') return success(emptyPage<CareerPlanView>());

      const found = await dependencies.stores.plans.search(
        transaction,
        {
          ...filtersWith(scope, query.employmentId),
          ...(query.pathId === undefined ? {} : { pathId: query.pathId }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        pageOf(query),
      );

      return success({ items: found.items.map(careerPlanView), total: found.total });
    }),
});

export interface SearchPoolMemberships extends Query {
  readonly queryName: 'career.search-pool-memberships';
  readonly talentPoolId?: string;
  readonly employmentId?: string;
  /** Who was in the pool on this civil day. Both ends inclusive — the as-of read a review asks for. */
  readonly inForceOn?: string;
  readonly openOnly?: boolean;
  readonly page?: number;
  readonly size?: number;
}

export interface PagedMemberships extends Page<PoolMembershipView> {
  readonly asOf?: string;
}

/**
 * Membership periods, optionally as of a day.
 *
 * "Who was in this pool in March" is answered from the periods rather than from a flag nothing
 * maintains, and the day it was answered for is echoed back.
 */
export const searchMembershipsHandler = (
  dependencies: CareerDependencies,
): QueryHandler<SearchPoolMemberships, PagedMemberships> => ({
  queryName: 'career.search-pool-memberships',
  permission: CareerPermissions.poolRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scope = await scopeFor(dependencies, CareerPermissions.poolRead);

      if (scope.kind === 'none') return success(emptyPage<PoolMembershipView>());

      const found = await dependencies.stores.memberships.search(
        transaction,
        {
          ...filtersWith(scope, query.employmentId),
          ...(query.talentPoolId === undefined ? {} : { talentPoolId: query.talentPoolId }),
          ...(query.inForceOn === undefined ? {} : { inForceOn: query.inForceOn }),
          ...(query.openOnly === undefined ? {} : { openOnly: query.openOnly }),
        },
        pageOf(query),
      );

      return success({
        items: found.items.map(poolMembershipView),
        total: found.total,
        ...(query.inForceOn === undefined ? {} : { asOf: query.inForceOn }),
      });
    }),
});

export interface ReadReadinessHistory extends Query {
  readonly queryName: 'career.read-readiness-history';
  readonly employmentId: string;
}

export interface ReadinessHistoryView {
  readonly employmentId: string;
  /** Every statement made about this person, most recent first. Nothing is overwritten (D-14). */
  readonly assessments: readonly ReadinessAssessmentView[];
  /**
   * The most recent statement — a *selection* and never a computation.
   *
   * It picks the assessment somebody wrote most recently and returns it whole. It does not average,
   * does not weight, and does not combine two assessors' views into a third that neither of them
   * holds (ADR-0074).
   */
  readonly latest?: ReadinessAssessmentView;
}

/**
 * One person's readiness history, whole.
 *
 * **The history is the point.** A correction is a new assessment, so the trail shows what was
 * thought and when it changed — which is what a succession review asks and what an edited row could
 * not answer. Nothing here reconstructs a current state by overwriting the past.
 */
export const readReadinessHistoryHandler = (
  dependencies: CareerDependencies,
): QueryHandler<ReadReadinessHistory, ReadinessHistoryView> => ({
  queryName: 'career.read-readiness-history',
  permission: CareerPermissions.readinessRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scope = await scopeFor(dependencies, CareerPermissions.readinessRead);

      if (scope.kind === 'none') {
        return success({ employmentId: query.employmentId, assessments: [] });
      }

      const history = await dependencies.stores.assessments.historyFor(
        transaction,
        query.employmentId,
      );
      const views = history.map(readinessAssessmentView);
      const [latest] = views;

      return success({
        employmentId: query.employmentId,
        assessments: views,
        ...(latest === undefined ? {} : { latest }),
      });
    }),
});

export interface ReadDevelopmentPlan extends Query {
  readonly queryName: 'career.read-development-plan';
  readonly developmentPlanId: string;
  readonly asOf?: string;
}

/**
 * One development plan, its items, and the three category counts.
 *
 * `mix.mixVerdict` is the constant `NOT VERIFIED`. The counts are counts; nothing validates a
 * 70-20-10 balance, because the specification supplies a weighting and no rule (D-12).
 *
 * **A course item shows its Learning identifier and no status Career invented.** Whether somebody
 * finished is Learning's answer, and nothing here reads Learning per item — that would be an N+1 on
 * every page and a second copy of a fact that goes stale.
 */
export const readDevelopmentPlanHandler = (
  dependencies: CareerDependencies,
): QueryHandler<ReadDevelopmentPlan, DevelopmentPlanDetailView> => ({
  queryName: 'career.read-development-plan',
  permission: CareerPermissions.developmentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.developmentPlans.byId(
        transaction,
        query.developmentPlanId,
      );

      if (plan === undefined) return notFound<DevelopmentPlanDetailView>('career_development_plan');

      const scope = await scopeFor(dependencies, CareerPermissions.developmentRead);

      // Not-found rather than forbidden: knowing that a development plan exists for a named person
      // is itself a disclosure about them.
      if (scope.kind === 'none')
        return notFound<DevelopmentPlanDetailView>('career_development_plan');

      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const items = await dependencies.stores.developmentItems.forPlan(
        transaction,
        plan.developmentPlanId,
      );

      return success({
        plan: developmentPlanView(plan),
        items: items.map((item) => developmentItemView(item, asOf)),
        mix: developmentMixView(items),
        asOf,
      });
    }),
});

export interface SearchMobilityRecommendations extends Query {
  readonly queryName: 'career.search-recommendations';
  readonly employmentId?: string;
  readonly status?: string;
  readonly kind?: string;
  readonly asOf?: string;
  readonly page?: number;
  readonly size?: number;
}

export interface PagedRecommendations extends Page<MobilityRecommendationView> {
  readonly asOf: string;
}

/**
 * Recommendations, with what each stands as today.
 *
 * `status` filters the **stored** value. `standing` is derived per row and is the only place
 * `expired` appears — so a caller asking for `status: 'expired'` matches nothing, correctly: nothing
 * ever wrote that word (D-13).
 */
export const searchRecommendationsHandler = (
  dependencies: CareerDependencies,
): QueryHandler<SearchMobilityRecommendations, PagedRecommendations> => ({
  queryName: 'career.search-recommendations',
  permission: CareerPermissions.mobilityRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const scope = await scopeFor(dependencies, CareerPermissions.mobilityRead);

      if (scope.kind === 'none')
        return success({ ...emptyPage<MobilityRecommendationView>(), asOf });

      const found = await dependencies.stores.mobility.search(
        transaction,
        {
          ...filtersWith(scope, query.employmentId),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.kind === undefined ? {} : { kind: query.kind }),
        },
        pageOf(query),
      );

      return success({
        items: found.items.map((held) => mobilityRecommendationView(held, asOf)),
        total: found.total,
        asOf,
      });
    }),
});

export interface ReadBenchStrength extends Query {
  readonly queryName: 'career.read-bench-strength';
  readonly successionPlanId: string;
  readonly asOf?: string;
}

/**
 * How deep a bench is, counted by the database.
 *
 * Separate from reading the plan deliberately: a count taken from `items.length` would be the size
 * of the page, and "this director has three successors" computed that way would be wrong the moment
 * there were more than a page of them. It is also what makes the count safe under row-level
 * security — a total computed without the tenant predicate would disclose how many successors
 * another organization has groomed.
 */
export const readBenchStrengthHandler = (
  dependencies: CareerDependencies,
): QueryHandler<ReadBenchStrength, BenchStrengthView> => ({
  queryName: 'career.read-bench-strength',
  permission: CareerPermissions.successionRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.successionPlans.byId(
        transaction,
        query.successionPlanId,
      );

      if (plan === undefined) return notFound<BenchStrengthView>('career_succession_plan');

      const counts = await dependencies.stores.successors.benchCountsOf(
        transaction,
        plan.successionPlanId,
      );

      return success({
        successionPlanId: plan.successionPlanId,
        positionId: plan.positionId,
        nominated: counts.nominated,
        confirmed: counts.confirmed,
        asOf: query.asOf ?? civilDateOf(dependencies.clock.now()),
      });
    }),
});
