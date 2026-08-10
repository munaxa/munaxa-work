import { success, type Query, type QueryHandler } from '@work/kernel';

import {
  accrualRunView,
  adjustmentView,
  entitlementView,
  policyView,
  typeView,
} from './leave-views.js';
import { LeavePermissions } from './leave-permissions.js';
import { MAX_BATCH } from './recalculate.use-case.js';
import type {
  AccrualRunView,
  EntitlementView,
  LeaveAdjustmentView,
  LeaveDashboardView,
  LeavePolicyView,
  LeaveTypeView,
} from '../contracts/views.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * The configuration reads, the administrative register, and the dashboard.
 *
 * Every one is bounded. The dashboard's `balancesAwaitingRecalculation` is the number that grows
 * when something is quietly not working — it is on the screen for the same reason Attendance's
 * equivalent is, because a number a human can see is a number a human notices growing.
 */

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const paged = (query: { readonly limit?: number; readonly offset?: number }) => ({
  limit: Math.min(MAX_PAGE, Math.max(1, query.limit ?? DEFAULT_PAGE)),
  offset: Math.max(0, query.offset ?? 0),
});

export interface ListTypes extends Query {
  readonly queryName: 'leave.types';
}

export interface TypesView {
  readonly items: readonly LeaveTypeView[];
}

/**
 * The configured leave types.
 *
 * A tenant that has configured none gets an empty list, and the screen says so. Nothing is seeded
 * and nothing is suggested (§7).
 */
export const listTypesHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ListTypes, TypesView> => ({
  queryName: 'leave.types',
  permission: LeavePermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const types = await dependencies.stores.types.all(transaction);

      return success({ items: types.map(typeView) });
    }),
});

export interface ListPolicies extends Query {
  readonly queryName: 'leave.policies';
  readonly leaveTypeId?: string;
}

export interface PoliciesView {
  readonly items: readonly LeavePolicyView[];
}

export const listPoliciesHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ListPolicies, PoliciesView> => ({
  queryName: 'leave.policies',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const policies =
        query.leaveTypeId === undefined
          ? await dependencies.stores.policies.all(transaction)
          : await dependencies.stores.policies.forType(transaction, query.leaveTypeId);
      const items: LeavePolicyView[] = [];

      for (const policy of policies) {
        const assignments = await dependencies.stores.assignments.forPolicy(transaction, policy.id);

        items.push(policyView(policy, assignments));
      }
      return success({ items });
    }),
});

export interface ListEntitlements extends Query {
  readonly queryName: 'leave.entitlements';
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly leaveYearStart?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface EntitlementsView {
  readonly items: readonly EntitlementView[];
  readonly total: number;
}

export const listEntitlementsHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ListEntitlements, EntitlementsView> => ({
  queryName: 'leave.entitlements',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.entitlements.search(transaction, {
        ...paged(query),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.leaveTypeId === undefined ? {} : { leaveTypeId: query.leaveTypeId }),
        ...(query.leaveYearStart === undefined ? {} : { leaveYearStart: query.leaveYearStart }),
      });

      return success({ items: page.items.map(entitlementView), total: page.total });
    }),
});

export interface ListAdjustments extends Query {
  readonly queryName: 'leave.adjustments';
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AdjustmentsView {
  readonly items: readonly LeaveAdjustmentView[];
  readonly total: number;
}

/**
 * Every manual movement, with its actor and its reason.
 *
 * Behind `leave.read` rather than `leave.balance.read`, because an adjustment carries a written
 * note explaining why somebody's balance was changed by hand — and that note is the closest thing
 * in this module to a personnel comment.
 */
export const listAdjustmentsHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ListAdjustments, AdjustmentsView> => ({
  queryName: 'leave.adjustments',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.adjustments.search(transaction, {
        ...paged(query),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.leaveTypeId === undefined ? {} : { leaveTypeId: query.leaveTypeId }),
      });

      return success({ items: page.items.map(adjustmentView), total: page.total });
    }),
});

export interface ListAccrualRuns extends Query {
  readonly queryName: 'leave.accrual-runs';
  readonly limit?: number;
}

export interface AccrualRunsView {
  readonly items: readonly AccrualRunView[];
}

export const listAccrualRunsHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ListAccrualRuns, AccrualRunsView> => ({
  queryName: 'leave.accrual-runs',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const runs = await dependencies.stores.accrualRuns.recent(
        transaction,
        Math.min(MAX_PAGE, Math.max(1, query.limit ?? DEFAULT_PAGE)),
      );

      return success({ items: runs.map(accrualRunView) });
    }),
});

export interface ReadDashboard extends Query {
  readonly queryName: 'leave.dashboard';
  readonly onDate?: string;
}

export const readDashboardHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadDashboard, LeaveDashboardView> => ({
  queryName: 'leave.dashboard',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const today = query.onDate ?? dependencies.clock.now().toISOString().slice(0, 10);
      const pending = await dependencies.stores.requests.search(transaction, {
        state: 'pending_approval',
        limit: MAX_PAGE,
        offset: 0,
      });
      const away = await dependencies.stores.requests.search(transaction, {
        state: 'approved',
        fromDate: today,
        toDate: today,
        limit: MAX_PAGE,
        offset: 0,
      });
      const stale = await dependencies.stores.balances.stale(transaction, MAX_BATCH);
      const types = await dependencies.stores.types.all(transaction);
      const policies = await dependencies.stores.policies.all(transaction);

      return success({
        pendingApprovals: pending.total,
        onLeaveToday: away.total,
        balancesAwaitingRecalculation: stale.length,
        leaveTypesConfigured: types.length,
        publishedPolicies: policies.filter((one) => one.status === 'published').length,
      });
    }),
});
