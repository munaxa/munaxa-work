import { success, type Query, type QueryHandler } from '@work/kernel';

import { notFound } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import { adjustmentView, approvalChainView, exceptionView, runView } from './payroll-views.js';
import type { PayrollDependencies } from './payroll-dependencies.js';
import type {
  PayrollAdjustmentView,
  PayrollApprovalChainView,
  PayrollExceptionView,
  PayrollReconciliationView,
  PayrollRunView,
} from '../contracts/views.js';

/**
 * The run reads: what happened, what went wrong, who approved it and what moved underneath it.
 *
 * Behind `payroll.read`, because none of these carries a figure. The exception list carries
 * employment identifiers and codes; the reconciliation list carries digests. A caller who may see
 * that a run had forty exceptions still cannot see what anybody was paid.
 */

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const bounded = (size: number | undefined): number =>
  Math.min(Math.max(size ?? DEFAULT_PAGE, 1), MAX_PAGE);

export interface ListRuns extends Query {
  readonly queryName: 'payroll.runs';
  readonly page?: number;
  readonly size?: number;
}

export const listRunsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<
  ListRuns,
  { readonly items: readonly PayrollRunView[]; readonly total: number }
> => ({
  queryName: 'payroll.runs',
  permission: PayrollPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const size = bounded(query.size);
      const page = await dependencies.stores.runs.page(transaction, {
        limit: size,
        offset: ((query.page ?? 1) - 1) * size,
      });

      return success({ items: page.items.map(runView), total: page.total });
    }),
});

export interface ReadRun extends Query {
  readonly queryName: 'payroll.run';
  readonly payrollRunId: string;
}

export const readRunHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadRun, PayrollRunView> => ({
  queryName: 'payroll.run',
  permission: PayrollPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const run = await dependencies.stores.runs.byId(transaction, query.payrollRunId);

      return run === undefined ? notFound<PayrollRunView>('payroll-run') : success(runView(run));
    }),
});

export interface ListExceptions extends Query {
  readonly queryName: 'payroll.exceptions';
  readonly payrollRunId: string;
}

export const listExceptionsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ListExceptions, { readonly items: readonly PayrollExceptionView[] }> => ({
  queryName: 'payroll.exceptions',
  permission: PayrollPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const raised = await dependencies.stores.exceptions.forRun(transaction, query.payrollRunId);

      return success({ items: raised.map(exceptionView) });
    }),
});

export interface ReadReconciliation extends Query {
  readonly queryName: 'payroll.reconciliation';
  readonly payrollRunId: string;
}

/** What reconciliation found. Nothing here repaired anything, and nothing here could. */
export const readReconciliationHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadReconciliation, { readonly items: readonly PayrollReconciliationView[] }> => ({
  queryName: 'payroll.reconciliation',
  permission: PayrollPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const records = await dependencies.stores.reconciliations.forRun(
        transaction,
        query.payrollRunId,
      );

      return success({
        items: records.map((record) => ({
          employmentId: record.employmentId,
          staleSource: record.staleSource,
          ...(record.previousDigest === undefined ? {} : { previousDigest: record.previousDigest }),
          ...(record.currentDigest === undefined ? {} : { currentDigest: record.currentDigest }),
          detectedAt: record.detectedAt,
        })),
      });
    }),
});

export interface ReadApprovalChain extends Query {
  readonly queryName: 'payroll.approval-chain';
  readonly payrollRunId: string;
}

export const readApprovalChainHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadApprovalChain, PayrollApprovalChainView> => ({
  queryName: 'payroll.approval-chain',
  permission: PayrollPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const chain = await dependencies.stores.decisions.forRun(transaction, query.payrollRunId);

      return success(approvalChainView(query.payrollRunId, chain));
    }),
});

export interface ListAdjustments extends Query {
  readonly queryName: 'payroll.adjustments';
  readonly payrollRunId: string;
}

/**
 * Adjustments, **without their notes**.
 *
 * The note is the sentence somebody wrote about why a person's pay changed, and it sits behind
 * `payroll.adjust`. This handler declares `payroll.read`, so it never returns one — a caller who
 * needs the reasons reads them through the adjust-scoped endpoint.
 */
export const listAdjustmentsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ListAdjustments, { readonly items: readonly PayrollAdjustmentView[] }> => ({
  queryName: 'payroll.adjustments',
  permission: PayrollPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const adjustments = await dependencies.stores.adjustments.forRun(
        transaction,
        query.payrollRunId,
      );

      return success({ items: adjustments.map((state) => adjustmentView(state, false)) });
    }),
});

export interface ListAdjustmentReasons extends Query {
  readonly queryName: 'payroll.adjustment-reasons';
  readonly payrollRunId: string;
}

/** The same rows **with** their notes, behind the permission that governs the reason. */
export const listAdjustmentReasonsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ListAdjustmentReasons, { readonly items: readonly PayrollAdjustmentView[] }> => ({
  queryName: 'payroll.adjustment-reasons',
  permission: PayrollPermissions.adjust,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const adjustments = await dependencies.stores.adjustments.forRun(
        transaction,
        query.payrollRunId,
      );

      return success({ items: adjustments.map((state) => adjustmentView(state, true)) });
    }),
});
