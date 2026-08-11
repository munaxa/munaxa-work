import { success, type Query, type QueryHandler } from '@work/kernel';
import { boundBy, goalScopeFor } from './authorization.js';
import { notFound } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import {
  cycleView,
  frameworkView,
  goalCategoryView,
  goalView,
  ratingScaleView,
  templateView,
} from './performance-views.js';
import type { Page, Paged } from './performance-ports.js';
import type { PerformanceDependencies } from './performance-dependencies.js';
import type {
  CompetencyFrameworkView,
  CycleView,
  GoalCategoryView,
  GoalView,
  RatingScaleView,
  ReviewTemplateView,
} from '../contracts/views.js';

/**
 * The reads, and the three rules every one of them keeps.
 *
 * **Bounded.** Every collection takes a page and clamps it. A tenant running an annual cycle for a
 * hundred thousand employments is what this is designed for.
 *
 * **Scoped before the store, not after it.** A caller holding `review.read-team` has their query
 * narrowed to the employments Employment says report to them, and the bound goes *into* the store
 * call. Filtering afterwards would mean the rows left the database first, and a count of what was
 * removed is itself a disclosure — "your colleague has a review in this cycle" is information.
 *
 * **A withheld aggregate says so.** Where a template's minimum has not been met, `peerAggregate`
 * comes back `available: false` with no scores. That withholds a number; it does not make the
 * responses anonymous, and no view here pretends it does.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  readonly page?: number;
  readonly size?: number;
}

export const bounded = (request: PageRequest): Paged => {
  const size = Math.min(Math.max(request.size ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(request.page ?? 1, 1);

  return { limit: size, offset: (page - 1) * size };
};

export interface Listed<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export const listed = <TItem>(page: Page<TItem>): Listed<TItem> => ({
  items: page.items,
  total: page.total,
});

export interface ListRatingScales extends Query {
  readonly queryName: 'performance.rating-scales';
}

export const listRatingScalesHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ListRatingScales, Listed<RatingScaleView>> => ({
  queryName: 'performance.rating-scales',
  permission: PerformancePermissions.configureRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scales = await dependencies.stores.ratingScales.all(transaction);
      const views = await Promise.all(
        scales.map(async (scale) =>
          ratingScaleView(
            scale,
            await dependencies.stores.ratingScales.levelsFor(transaction, scale.ratingScaleId),
          ),
        ),
      );

      return success({ items: views, total: views.length });
    }),
});

export interface ListFrameworks extends Query {
  readonly queryName: 'performance.frameworks';
}

export const listFrameworksHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ListFrameworks, Listed<CompetencyFrameworkView>> => ({
  queryName: 'performance.frameworks',
  permission: PerformancePermissions.configureRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const frameworks = await dependencies.stores.frameworks.all(transaction);
      const views = await Promise.all(
        frameworks.map(async (framework) =>
          frameworkView(
            framework,
            await dependencies.stores.frameworks.competenciesFor(
              transaction,
              framework.frameworkId,
            ),
          ),
        ),
      );

      return success({ items: views, total: views.length });
    }),
});

export interface ListTemplates extends Query {
  readonly queryName: 'performance.templates';
}

export const listTemplatesHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ListTemplates, Listed<ReviewTemplateView>> => ({
  queryName: 'performance.templates',
  permission: PerformancePermissions.configureRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const templates = await dependencies.stores.templates.all(transaction);
      const views = await Promise.all(
        templates.map(async (template) =>
          templateView(
            template,
            await dependencies.stores.templates.componentsFor(transaction, template.templateId),
          ),
        ),
      );

      return success({ items: views, total: views.length });
    }),
});

export interface ListGoalCategories extends Query {
  readonly queryName: 'performance.goal-categories';
}

export const listGoalCategoriesHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ListGoalCategories, Listed<GoalCategoryView>> => ({
  queryName: 'performance.goal-categories',
  permission: PerformancePermissions.configureRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const categories = await dependencies.stores.goalCategories.all(transaction);

      return success({
        items: categories.map(goalCategoryView),
        total: categories.length,
      });
    }),
});

export interface ListCycles extends Query, PageRequest {
  readonly queryName: 'performance.cycles';
}

export const listCyclesHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ListCycles, Listed<CycleView>> => ({
  queryName: 'performance.cycles',
  permission: PerformancePermissions.cycleRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.cycles.all(transaction, bounded(query));
      const views = await Promise.all(
        page.items.map(async (cycle) =>
          cycleView(
            cycle,
            (await dependencies.stores.reviews.forCycle(transaction, cycle.cycleId)).length,
          ),
        ),
      );

      return success({ items: views, total: page.total });
    }),
});

export interface SearchGoals extends Query, PageRequest {
  readonly queryName: 'performance.goals';
  readonly employmentId?: string;
  readonly organizationUnitId?: string;
  readonly cycleId?: string;
  readonly status?: string;
  readonly managerEmploymentId?: string;
}

export const searchGoalsHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<SearchGoals, Listed<GoalView>> => ({
  queryName: 'performance.goals',
  permission: PerformancePermissions.goalReadTeam,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scope = await goalScopeFor(dependencies, query);
      const page = await dependencies.stores.goals.search(
        transaction,
        { ...filtersOf(query), ...boundBy(scope) },
        bounded(query),
      );

      return success(
        listed({ items: page.items.map((goal) => goalView(goal)), total: page.total }),
      );
    }),
});

const filtersOf = (query: SearchGoals): Record<string, string> => ({
  ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
  ...(query.organizationUnitId === undefined
    ? {}
    : { organizationUnitId: query.organizationUnitId }),
  ...(query.cycleId === undefined ? {} : { cycleId: query.cycleId }),
  ...(query.status === undefined ? {} : { status: query.status }),
});

export interface ReadGoal extends Query {
  readonly queryName: 'performance.read-goal';
  readonly goalId: string;
}

export const readGoalHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ReadGoal, GoalView> => ({
  queryName: 'performance.read-goal',
  permission: PerformancePermissions.goalRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const goal = await dependencies.stores.goals.byId(transaction, query.goalId);

      if (goal === undefined) return notFound<GoalView>('performance_goal');

      const progress = await dependencies.stores.goalProgress.forGoal(transaction, query.goalId);

      return success(goalView(goal, progress));
    }),
});
