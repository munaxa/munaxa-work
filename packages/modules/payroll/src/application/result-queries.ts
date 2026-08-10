import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';

import { notFound } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import { deductionView, earningView, resultView } from './payroll-views.js';
import type { PayrollDependencies } from './payroll-dependencies.js';
import type {
  DeductionLineView,
  EarningLineView,
  PayrollResultView,
  PayslipView,
} from '../contracts/views.js';

/**
 * The reads that carry money, **every one behind `payroll.read-result`**.
 *
 * This is the separation that matters most in the module. `payroll.read` sees that a run covered
 * 1,400 people; these see what a named person was paid. Collapsing the two would make every payroll
 * administrator a reader of every salary in the company.
 *
 * The payslip read is the answer to "why did this person receive this amount", and it is assembled
 * **entirely from persisted rows** — the result, its lines and their calculation detail. No live
 * source is read, which is what lets a five-year-old payslip still explain itself (ADR-0064).
 */

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const bounded = (size: number | undefined): number =>
  Math.min(Math.max(size ?? DEFAULT_PAGE, 1), MAX_PAGE);

export interface ListResults extends Query {
  readonly queryName: 'payroll.results';
  readonly payrollRunId: string;
  readonly page?: number;
  readonly size?: number;
}

export interface ResultPage {
  readonly items: readonly PayrollResultView[];
  readonly total: number;
}

export const listResultsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ListResults, ResultPage> => ({
  queryName: 'payroll.results',
  permission: PayrollPermissions.readResult,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const size = bounded(query.size);
      const run = await dependencies.stores.runs.byId(transaction, query.payrollRunId);
      const page = await dependencies.stores.results.forRun(transaction, query.payrollRunId, {
        limit: size,
        offset: ((query.page ?? 1) - 1) * size,
      });
      const finalized = run?.finalizedAt !== undefined;

      return success({
        items: page.items.map((state) => resultView(state, finalized)),
        total: page.total,
      });
    }),
});

export interface ReadEarnings extends Query {
  readonly queryName: 'payroll.earnings';
  readonly payrollResultId: string;
}

export const readEarningsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadEarnings, { readonly items: readonly EarningLineView[] }> => ({
  queryName: 'payroll.earnings',
  permission: PayrollPermissions.readResult,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const lines = await dependencies.stores.earnings.forResult(
        transaction,
        query.payrollResultId,
      );

      return success({ items: lines.map(earningView) });
    }),
});

export interface ReadDeductions extends Query {
  readonly queryName: 'payroll.deductions';
  readonly payrollResultId: string;
}

export const readDeductionsHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadDeductions, { readonly items: readonly DeductionLineView[] }> => ({
  queryName: 'payroll.deductions',
  permission: PayrollPermissions.readResult,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const lines = await dependencies.stores.deductions.forResult(
        transaction,
        query.payrollResultId,
      );

      return success({ items: lines.map(deductionView) });
    }),
});

export interface ReadPayslip extends Query {
  readonly queryName: 'payroll.payslip';
  readonly payrollResultId: string;
}

/**
 * The payslip **data**, and only the data.
 *
 * Payroll owns this. Rendering, storage and delivery belong to a future Document domain, and no
 * `DocumentPort` exists in this repository — so nothing here produces a PDF or stores a file
 * (ADR-0067). It carries no name and no personal data: whatever renders it resolves those under its
 * own permissions (ADR-0038).
 */
export const readPayslipHandler = (
  dependencies: PayrollDependencies,
): QueryHandler<ReadPayslip, PayslipView> => ({
  queryName: 'payroll.payslip',
  permission: PayrollPermissions.readResult,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const assembled = await payslipFor(dependencies, transaction, query.payrollResultId);

      return assembled === undefined ? notFound<PayslipView>('payroll-result') : success(assembled);
    }),
});

const payslipFor = async (
  dependencies: PayrollDependencies,
  transaction: Transaction,
  payrollResultId: string,
): Promise<PayslipView | undefined> => {
  const result = await dependencies.stores.results.byId(transaction, payrollResultId);

  if (result === undefined) return undefined;

  const run = await dependencies.stores.runs.byId(transaction, result.payrollRunId);

  if (run === undefined) return undefined;

  const period = await dependencies.stores.periods.byId(transaction, run.payrollPeriodId);

  if (period === undefined) return undefined;

  const [earnings, deductions] = await Promise.all([
    dependencies.stores.earnings.forResult(transaction, payrollResultId),
    dependencies.stores.deductions.forResult(transaction, payrollResultId),
  ]);
  const view = resultView(result, run.finalizedAt !== undefined);

  return {
    payrollResultId: result.payrollResultId,
    employmentId: result.employmentId,
    periodCode: period.code,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    paymentDate: period.paymentDate,
    currencyCode: result.currencyCode,
    currencyExponent: result.currencyExponent,
    gross: view.gross,
    totalDeductions: view.totalDeductions,
    net: view.net,
    earnings: earnings.map(earningView),
    deductions: deductions.map(deductionView),
    calculationVersion: result.calculationVersion,
    snapshotDigest: result.snapshotDigest,
    finalized: view.finalized,
  };
};
