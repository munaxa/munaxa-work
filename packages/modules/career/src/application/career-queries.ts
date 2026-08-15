import { success, type Query, type QueryHandler } from '@work/kernel';

import type {
  CareerPathDetailView,
  CareerPathView,
  ReadinessLevelView,
  SuccessionPlanDetailView,
  SuccessionPlanView,
  TalentPoolView,
} from '../contracts/views.js';
import { civilDateOf, notFound } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import {
  careerPathView,
  careerStageView,
  readinessLevelView,
  successionPlanView,
  successorView,
  talentPoolView,
} from './career-views.js';
import { pageOf } from './career-paging.js';
import type { Page } from './career-ports.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Reading the configuration and the succession position.
 *
 * **Every collection read is bounded.** There is no query here that returns everything.
 *
 * **Derived answers are computed at read time against a stated day.** "Is this path in force", "is
 * this review due" — both are functions of a stored date and today, and no column holds either. The
 * `asOf` a caller supplies is echoed in the result so a screen can say what day it answered for
 * rather than implying "now" and being wrong by one when the request crossed midnight.
 *
 * **Two questions this module deliberately cannot answer**, stated here rather than approximated:
 *
 * *"List this tenant's critical positions."* `organization.list-positions` has no `criticality`
 * filter and that additive change was not authorized (D-4). Career lists the succession plans it
 * holds; it cannot enumerate positions it has no plan for. Paging the whole position catalogue and
 * filtering here would be unbounded work over another module's data, and the total would be wrong.
 *
 * *"Show the nine-box band beside this nomination."* `performance.talent-matrix` is unpaged and
 * cycle-wide, and the bounded query that would answer it was not authorized (D-5). Consuming the
 * existing one per nomination would be an unbounded read at 100,000 employments. There is no
 * Performance port, so no handler here can drift into one.
 */

export interface SearchCareerPaths extends Query {
  readonly queryName: 'career.search-paths';
  readonly status?: string;
  readonly kind?: string;
  readonly asOf?: string;
  readonly page?: number;
  readonly size?: number;
}

export interface PagedPaths extends Page<CareerPathView> {
  readonly asOf: string;
}

export const searchPathsHandler = (
  dependencies: CareerDependencies,
): QueryHandler<SearchCareerPaths, PagedPaths> => ({
  queryName: 'career.search-paths',
  permission: CareerPermissions.pathRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const found = await dependencies.stores.paths.search(
        transaction,
        {
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.kind === undefined ? {} : { kind: query.kind }),
        },
        pageOf(query),
      );
      const items = await Promise.all(
        found.items.map(async (path) =>
          careerPathView(
            path,
            await dependencies.stores.paths.stageCountOf(transaction, path.pathId),
            asOf,
          ),
        ),
      );

      return success({ items, total: found.total, asOf });
    }),
});

export interface ReadCareerPath extends Query {
  readonly queryName: 'career.read-path';
  readonly pathId: string;
  readonly asOf?: string;
}

/** A path with the stages along it, in order. The order is an order and never a gate (D-17). */
export const readPathHandler = (
  dependencies: CareerDependencies,
): QueryHandler<ReadCareerPath, CareerPathDetailView> => ({
  queryName: 'career.read-path',
  permission: CareerPermissions.pathRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, query.pathId);

      if (path === undefined) return notFound<CareerPathDetailView>('career_path');

      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const stages = await dependencies.stores.paths.stagesFor(transaction, path.pathId);

      return success({
        path: careerPathView(path, stages.length, asOf),
        stages: stages.map(careerStageView),
        asOf,
      });
    }),
});

export interface ListTalentPools extends Query {
  readonly queryName: 'career.list-pools';
  readonly status?: string;
  readonly page?: number;
  readonly size?: number;
}

export const listPoolsHandler = (
  dependencies: CareerDependencies,
): QueryHandler<ListTalentPools, Page<TalentPoolView>> => ({
  queryName: 'career.list-pools',
  permission: CareerPermissions.poolRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.pools.all(transaction, query.status, pageOf(query));

      return success({ items: found.items.map(talentPoolView), total: found.total });
    }),
});

export interface ListReadinessLevels extends Query {
  readonly queryName: 'career.list-readiness-levels';
  readonly activeOnly?: boolean;
}

/**
 * The tenant's ladder, in order.
 *
 * Unpaged, and that is deliberate rather than an oversight: a readiness ladder is four or five rungs
 * that a screen must show whole to be meaningful, and the domain caps it at 100. It is bounded by
 * the vocabulary rather than by a page — the same treatment Learning gives its course categories.
 */
export const listReadinessLevelsHandler = (
  dependencies: CareerDependencies,
): QueryHandler<ListReadinessLevels, { readonly items: readonly ReadinessLevelView[] }> => ({
  queryName: 'career.list-readiness-levels',
  permission: CareerPermissions.readinessRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const levels = await dependencies.stores.readinessLevels.all(
        transaction,
        query.activeOnly ?? false,
      );

      return success({ items: levels.map(readinessLevelView) });
    }),
});

export interface SearchSuccessionPlans extends Query {
  readonly queryName: 'career.search-succession-plans';
  readonly positionId?: string;
  readonly status?: string;
  /** Active plans whose review day has arrived. Answered because somebody asked; nothing fires. */
  readonly reviewDueBy?: string;
  readonly asOf?: string;
  readonly page?: number;
  readonly size?: number;
}

export interface PagedSuccessionPlans extends Page<SuccessionPlanView> {
  readonly asOf: string;
}

/**
 * The succession plans this tenant holds.
 *
 * **This is not "the tenant's critical positions".** It is the positions somebody has written a plan
 * for, which is a different and smaller set — and the difference is `NOT VERIFIED` rather than
 * papered over (D-4).
 */
export const searchSuccessionPlansHandler = (
  dependencies: CareerDependencies,
): QueryHandler<SearchSuccessionPlans, PagedSuccessionPlans> => ({
  queryName: 'career.search-succession-plans',
  permission: CareerPermissions.successionRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const found = await dependencies.stores.successionPlans.search(
        transaction,
        {
          ...(query.positionId === undefined ? {} : { positionId: query.positionId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.reviewDueBy === undefined ? {} : { reviewOnOrBefore: query.reviewDueBy }),
        },
        pageOf(query),
      );

      return success({
        items: found.items.map((plan) => successionPlanView(plan, asOf)),
        total: found.total,
        asOf,
      });
    }),
});

export interface ReadSuccessionPlan extends Query {
  readonly queryName: 'career.read-succession-plan';
  readonly successionPlanId: string;
  readonly asOf?: string;
}

/**
 * One plan and its bench, whole.
 *
 * Bounded by the aggregate: a bench is the people nominated for one position, and a plan with more
 * than a page of successors is not a real succession plan. Withdrawn nominations are included,
 * because "we put this person forward and later took them off" is the history a review reads.
 *
 * **No criticality and no potential band appear here**, and no cross-module read happens per
 * successor — which is the N+1 this shape exists to avoid.
 */
export const readSuccessionPlanHandler = (
  dependencies: CareerDependencies,
): QueryHandler<ReadSuccessionPlan, SuccessionPlanDetailView> => ({
  queryName: 'career.read-succession-plan',
  permission: CareerPermissions.successionRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.successionPlans.byId(
        transaction,
        query.successionPlanId,
      );

      if (plan === undefined) return notFound<SuccessionPlanDetailView>('career_succession_plan');

      const asOf = query.asOf ?? civilDateOf(dependencies.clock.now());
      const bench = await dependencies.stores.successors.forPlan(
        transaction,
        plan.successionPlanId,
      );

      return success({
        plan: successionPlanView(plan, asOf),
        successors: bench.map(successorView),
        asOf,
      });
    }),
});
