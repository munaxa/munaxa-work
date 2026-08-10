import { success, type Query, type QueryHandler } from '@work/kernel';

import { oneTimeView } from './compensation-views.js';
import { componentsFor, viewOf } from './compensation-queries.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type {
  CompensationChangedSinceView,
  CompensationDashboardView,
} from '../contracts/views.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * The reconciliation read, and the dashboard.
 *
 * **`changed-since` is how Payroll finds a retroactive correction, and it is a pull.** Compensation
 * raises internal events, but nothing downstream depends on one for correctness: if every event
 * were dropped, a payroll run asking this question would still find every change. That is the
 * ADR-0058 discipline applied before the consumer exists — the module publishes a read and does not
 * push.
 *
 * The axis is **system time**, not business time. A raise effective 1 March entered on 20 April
 * appears to a caller asking "what has been recorded since my last run on 15 April", which is
 * exactly the question a payroll run needs answered and exactly the one an effective-date filter
 * cannot answer.
 *
 * **Nothing here computes arrears.** What a retroactive raise costs depends on what was actually
 * paid and which periods are closed, and both are Payroll's facts.
 */

/** The page a reconciliation read returns. Bounded, because a busy month is not a small answer. */
const MAX_CHANGES = 500;

export interface ReadChangedSince extends Query {
  readonly queryName: 'compensation.changed-since';
  readonly recordedAfter: Date;
  readonly from: string;
  readonly to: string;
}

export const readChangedSinceHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ReadChangedSince, CompensationChangedSinceView> => ({
  queryName: 'compensation.changed-since',
  permission: CompensationPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const period = { from: query.from, to: query.to };
      const recurring = await dependencies.stores.recurring.recordedAfter(
        transaction,
        query.recordedAfter,
        period,
        MAX_CHANGES,
      );
      const oneTime = await dependencies.stores.oneTime.recordedAfter(
        transaction,
        query.recordedAfter,
        period,
        MAX_CHANGES,
      );
      const components = await componentsFor(dependencies, transaction, recurring);
      const codes = new Map(components.map((component) => [component.id, component.code]));

      return success({
        recordedAfter: query.recordedAfter,
        employmentIds: [
          ...new Set([
            ...recurring.map((record) => record.employmentId),
            ...oneTime.map((item) => item.employmentId),
          ]),
        ],
        recurring: recurring.map((record) => viewOf(record, recurring, components)),
        oneTime: oneTime.map((item) => oneTimeView(item, codes.get(item.componentId) ?? '')),
        // A filled page means there is more. Saying so is what stops a caller treating a bounded
        // answer as a complete one — the failure mode a silent cap produces.
        truncated: recurring.length >= MAX_CHANGES || oneTime.length >= MAX_CHANGES,
      });
    }),
});

export interface ReadCompensationDashboard extends Query {
  readonly queryName: 'compensation.dashboard';
}

/**
 * The overview.
 *
 * `employmentsWithoutCompensation` is the number on this screen that reveals a *gap*: somebody
 * employed and not yet paid anything is a real state and a mistake worth noticing, and reporting it
 * as a count is different from reporting their compensation as zero.
 */
export const readCompensationDashboardHandler = (
  dependencies: CompensationDependencies,
): QueryHandler<ReadCompensationDashboard, CompensationDashboardView> => ({
  queryName: 'compensation.dashboard',
  permission: CompensationPermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plans = await dependencies.stores.plans.all(transaction);
      const components = await dependencies.stores.components.all(transaction);
      const awaiting = await dependencies.stores.decisions.pendingCount(transaction);
      const now = dependencies.clock.now();
      const today = now.toISOString().slice(0, 10);
      const monthStart = `${today.slice(0, 7)}-01`;
      const page = await dependencies.stores.recurring.search(transaction, {
        limit: 200,
        offset: 0,
      });

      return success({
        plansPublished: plans.filter((plan) => plan.status === 'published').length,
        componentsConfigured: components.filter((one) => one.status === 'published').length,
        awaitingApproval: awaiting,
        effectiveThisMonth: page.items.filter(
          (record) => record.effectiveFrom >= monthStart && record.effectiveFrom <= today,
        ).length,
        futureDatedChanges: page.items.filter((record) => record.effectiveFrom > today).length,
        employmentsWithoutCompensation: await withoutCompensation(dependencies, page.items),
      });
    }),
});

/**
 * Employments the tenant employs and has assigned nothing to.
 *
 * Bounded: a page of active employments compared against a page of compensation records. An exact
 * figure would need a full scan of both, and a dashboard is not worth one.
 */
const withoutCompensation = async (
  dependencies: CompensationDependencies,
  records: readonly { readonly employmentId: string }[],
): Promise<number> => {
  const employments = await dependencies.employment.activeEmployments(200);
  const paid = new Set(records.map((record) => record.employmentId));

  return employments.filter((employment) => !paid.has(employment.employmentId)).length;
};
