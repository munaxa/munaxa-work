import {
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import { civilDateOf } from '../domain/onboarding-vocabulary.js';
import type { TaskEventView, TaskView } from '../contracts/views.js';

import { notFound } from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import { byOccurredAt, taskEventView, taskView } from './onboarding-views.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Reading tasks: the queues people actually open.
 *
 * **A queue is a filter on an index, not a scan.** "Everything waiting on IT" is
 * `(tenant, owner_role, status)`; "everything overdue" is `(tenant, due_on, status)`. Both are the
 * queries a dashboard makes every few seconds, and both are the ones that stop being fast first if
 * they are written as a load-and-filter.
 *
 * **Overdue is computed here, from a date.** There is no stored flag, so there is nothing to sweep
 * and nothing to be wrong between sweeps — and the `asOf` the caller supplies is what makes the
 * answer reproducible in a test rather than dependent on the wall clock.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface SearchTasks extends Query {
  readonly queryName: 'onboarding.search-tasks';
  readonly onboardingId?: string;
  readonly ownerKind?: string;
  readonly ownerRef?: string;
  readonly ownerRole?: string;
  readonly status?: string;
  readonly kind?: string;
  readonly overdue?: boolean;
  readonly requiredOnly?: boolean;
  readonly page?: number;
  readonly size?: number;
}

/**
 * The filters that pass through unchanged, copied only when present.
 *
 * Written as a list rather than as six conditional spreads inside the handler, because the handler's
 * job is the paging bounds and the clock — and a filter omitted from the copy is a filter the API
 * accepts and silently ignores.
 */
const filtersOf = (query: SearchTasks): Record<string, string | boolean> =>
  Object.fromEntries(
    (
      [
        'onboardingId',
        'ownerKind',
        'ownerRef',
        'ownerRole',
        'status',
        'kind',
        'requiredOnly',
      ] as const
    )
      .filter((key) => query[key] !== undefined)
      .map((key) => [key, query[key] as string | boolean]),
  );

export const searchTasksHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<SearchTasks, PagedResult<TaskView>> => ({
  queryName: 'onboarding.search-tasks',
  permission: OnboardingPermissions.taskRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));
      const found = await dependencies.stores.tasks.search(transaction, {
        limit: size,
        offset: (page - 1) * size,
        ...filtersOf(query),
        ...(query.overdue === true ? { overdueAsOf: civilDateOf(dependencies.clock.now()) } : {}),
      });

      return success(pagedResult(found.items.map(taskView), page, size, found.total));
    }),
});

export interface ReadTaskHistory extends Query {
  readonly queryName: 'onboarding.read-task-history';
  readonly taskId: string;
}

/**
 * Everything that happened to one task, oldest first.
 *
 * This is where "who moved this deadline" is answered. The actor on every row was taken from the
 * authenticated context when the movement happened; a caller could never supply it.
 */
export const readTaskHistoryHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<ReadTaskHistory, readonly TaskEventView[]> => ({
  queryName: 'onboarding.read-task-history',
  permission: OnboardingPermissions.taskRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const task = await dependencies.stores.tasks.byId(transaction, query.taskId);

      if (task === undefined) return notFound<readonly TaskEventView[]>('task');

      const history = await dependencies.stores.taskEvents.forTask(transaction, query.taskId);

      return success([...history].sort(byOccurredAt).map(taskEventView));
    }),
});

export interface ReadMyTasks extends Query {
  readonly queryName: 'onboarding.read-my-tasks';
  /** The caller's own employment, resolved by the edge from the authenticated member. */
  readonly employmentId: string;
  readonly includeConcluded?: boolean;
}

/**
 * The tasks belonging to one employment — the contract Employee Self-Service will consume.
 *
 * Phase 18 builds the screen; this publishes the data now so that phase needs no change to this
 * module. The employment is resolved at the edge from the authenticated member rather than taken
 * from a caller who could name somebody else's.
 */
export const readMyTasksHandler = (
  dependencies: OnboardingDependencies,
): QueryHandler<ReadMyTasks, readonly TaskView[]> => ({
  queryName: 'onboarding.read-my-tasks',
  permission: OnboardingPermissions.taskCompleteOwn,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.tasks.search(transaction, {
        limit: MAX_PAGE_SIZE,
        offset: 0,
        ownerRef: query.employmentId,
      });
      const mine = found.items.filter((task) => task.ownerKind !== 'unit');

      return success(
        (query.includeConcluded === true
          ? mine
          : mine.filter((task) => task.status !== 'cancelled')
        ).map(taskView),
      );
    }),
});
