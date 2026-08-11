import { success, type Query, type QueryHandler } from '@work/kernel';

import { PayrollPermissions } from './payroll-permissions.js';
import { deductionDefinitionView, groupView, periodView } from './payroll-views.js';
import type { PayrollDependencies } from './payroll-dependencies.js';
import type {
  DeductionDefinitionView,
  PayrollDashboardView,
  PayrollGroupView,
  PayrollPeriodView,
} from '../contracts/views.js';

/**
 * The configuration reads: groups, deductions, periods and the dashboard.
 *
 * All behind `payroll.read`, which is the **weak** permission in this module — it sees that a run
 * covered 1,400 people, not what any of them was paid. Nothing here returns a result, a line or a
 * net figure; those are behind `payroll.read-result`.
 */

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const bounded = (size: number | undefined): number =>
  Math.min(Math.max(size ?? DEFAULT_PAGE, 1), MAX_PAGE);

export interface ListPayrollGroups extends Query {
  readonly queryName: 'payroll.groups';
}

export const listPayrollGroupsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ListPayrollGroups, { readonly items: readonly PayrollGroupView[] }> => ({
  queryName: 'payroll.groups',
  permission: PayrollPermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const groups = await dependencies.stores.groups.all(transaction);

      return success({ items: groups.map(groupView) });
    }),
});

export interface ListDeductions extends Query {
  readonly queryName: 'payroll.deduction-definitions';
  readonly payrollGroupId: string;
}

export const listDeductionsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ListDeductions, { readonly items: readonly DeductionDefinitionView[] }> => ({
  queryName: 'payroll.deduction-definitions',
  permission: PayrollPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const definitions = await dependencies.stores.deductionDefinitions.forGroup(
        transaction,
        query.payrollGroupId,
      );

      return success({ items: definitions.map(deductionDefinitionView) });
    }),
});

export interface ListPeriods extends Query {
  readonly queryName: 'payroll.periods';
  readonly page?: number;
  readonly size?: number;
}

export interface PeriodPage {
  readonly items: readonly PayrollPeriodView[];
  readonly total: number;
}

export const listPeriodsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ListPeriods, PeriodPage> => ({
  queryName: 'payroll.periods',
  permission: PayrollPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const size = bounded(query.size);
      const page = await dependencies.stores.periods.page(transaction, {
        limit: size,
        offset: ((query.page ?? 1) - 1) * size,
      });

      return success({ items: page.items.map(periodView), total: page.total });
    }),
});

export interface ReadPayrollDashboard extends Query {
  readonly queryName: 'payroll.dashboard';
}

/**
 * The dashboard, including the two numbers that reveal a **failure**.
 *
 * `staleRuns` and `unresolvedExceptions` are on this view for the reason Attendance's and Leave's
 * equivalents are: they are the numbers that grow when something is quietly not working, and a
 * number a human can see is a number a human notices growing.
 */
export const readPayrollDashboardHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadPayrollDashboard, PayrollDashboardView> => ({
  queryName: 'payroll.dashboard',
  permission: PayrollPermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) =>
      success(await dependencies.stores.dashboard.counts(transaction)),
    ),
});
