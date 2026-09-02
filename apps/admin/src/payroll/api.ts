import { apiRead } from '../shell/api-request';
import type {
  AccountingLineView,
  DeductionDefinitionView,
  PaymentInstructionView,
  PayrollAdjustmentView,
  PayrollApprovalChainView,
  PayrollDashboardView,
  PayrollExceptionView,
  PayrollGroupView,
  PayrollPeriodView,
  PayrollReconciliationView,
  PayrollResultView,
  PayrollRunView,
  PayslipView,
} from '@work/payroll/contracts';

/**
 * Reading payroll from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps these screens from breaking on a refactor they have no
 * business knowing about.
 *
 * **No screen reads the first row of anything.** The previous composition asked for the page of runs
 * and then described `runs[0]` as though it were *the* run, and did the same with
 * `results.items[0]`: an operator could not look at last month's payroll, and had no way to know
 * they were not already. A run and a result are each addressed by a bounded read keyed on their own
 * identifier — `payroll.run` and `payroll.payslip`, both of which answer `notFound` for an
 * identifier they will not resolve — so a route resolves one, or renders not-found.
 *
 * **Four permissions, four different refusals.** Payroll separates `payroll.read` (a run's shape and
 * counts) from `payroll.read-result` (what a named person was paid), `payroll.accounting` (the
 * journal) and `payroll.payment` (the instructions). A caller may hold the first and none of the
 * rest, so each of those reads is kept as its own `undefined`-or-value and the screen says which was
 * withheld rather than showing an empty table.
 *
 * **The total is the server's, always.** Both paged reads return `{ items, total }` counted in the
 * database; a screen reporting `items.length` would tell somebody with fourteen hundred results that
 * they have fifty.
 *
 * **Nothing here computes.** No net from a gross, no total of a column, no "latest" run, no period
 * duration. Every figure is published or it is not shown.
 */

/** What one screen shows at once. The server clamps its own bound; this is the request. */
const PAGE = 'page=1&size=50';

interface Paged<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/** A page, or the fact that there was not one. Rows and the server's total travel together. */
export interface Listing<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a payroll page holds what named people were paid, and a cached copy of
 * it is a company's salary bill sitting somewhere nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> =>
  apiRead<TValue>(`/payroll${path}`);

const listing = <TItem>(page: Paged<TItem> | undefined): Listing<TItem> | undefined =>
  page === undefined ? undefined : { items: page.items, total: page.total };

const itemsOf = <TItem>(
  wrapper: { readonly items: readonly TItem[] } | undefined,
): readonly TItem[] | undefined => wrapper?.items;

export interface PayrollWorkspace {
  /** Absent means refused. The cheapest read, and the signal for the rest. */
  readonly dashboard: PayrollDashboardView | undefined;
  readonly runs: Listing<PayrollRunView> | undefined;
  readonly periods: Listing<PayrollPeriodView> | undefined;
  readonly groups: readonly PayrollGroupView[] | undefined;
  /** Deduction definitions are **per group**, so this is the first group's or nothing. */
  readonly definitions: readonly DeductionDefinitionView[] | undefined;
  /** Which group the definitions belong to, so the screen can name it rather than imply a tenant rule. */
  readonly definitionsGroup: PayrollGroupView | undefined;
}

/**
 * The payroll workspace: what is open, what has been run, and what the runs are configured from.
 *
 * Four reads under one permission, issued together. Deduction definitions are asked for last because
 * the module scopes them to a payroll group and publishes no tenant-wide read — asking for the first
 * group's is the honest version, and the screen names the group.
 */
export const loadPayrollWorkspace = async (): Promise<PayrollWorkspace> => {
  const [dashboard, runs, periods, groups] = await Promise.all([
    read<PayrollDashboardView>('/dashboard'),
    read<Paged<PayrollRunView>>(`/runs?${PAGE}`),
    read<Paged<PayrollPeriodView>>(`/periods?${PAGE}`),
    read<Paged<PayrollGroupView>>('/groups'),
  ]);
  const first = groups?.items[0];

  return {
    dashboard,
    runs: listing(runs),
    periods: listing(periods),
    groups: groups?.items,
    definitionsGroup: first,
    definitions:
      first === undefined
        ? undefined
        : itemsOf(
            await read<{ readonly items: readonly DeductionDefinitionView[] }>(
              `/deduction-definitions?payrollGroupId=${first.payrollGroupId}`,
            ),
          ),
  };
};

export interface RunForDisplay {
  readonly run: PayrollRunView;
  /** Absent means `payroll.read-result` was refused — not that the run produced nothing. */
  readonly results: Listing<PayrollResultView> | undefined;
  readonly exceptions: readonly PayrollExceptionView[] | undefined;
  readonly adjustments: readonly PayrollAdjustmentView[] | undefined;
  readonly approvals: PayrollApprovalChainView | undefined;
  readonly reconciliation: readonly PayrollReconciliationView[] | undefined;
  /** Absent means `payroll.accounting` was refused. Its own permission, its own answer. */
  readonly accounting: Listing<AccountingLineView> | undefined;
  /** Absent means `payroll.payment` was refused. */
  readonly payments: Listing<PaymentInstructionView> | undefined;
}

/**
 * One run, asked for first and on its own.
 *
 * An identifier the API will not resolve is a 404 rather than a page of refusals about a run that
 * may not exist, and asking for seven more things about it would be seven requests spent to render
 * nothing.
 */
export const loadRun = async (payrollRunId: string): Promise<PayrollRunView | undefined> =>
  read<PayrollRunView>(`/runs/${payrollRunId}`);

/** Everything else about it, in one round. */
export const loadRunDetail = async (run: PayrollRunView): Promise<RunForDisplay> => {
  const id = run.payrollRunId;
  const [results, exceptions, adjustments, approvals, reconciliation, accounting, payments] =
    await Promise.all([
      read<Paged<PayrollResultView>>(`/runs/${id}/results?${PAGE}`),
      read<{ readonly items: readonly PayrollExceptionView[] }>(`/runs/${id}/exceptions`),
      read<{ readonly items: readonly PayrollAdjustmentView[] }>(`/runs/${id}/adjustments`),
      read<PayrollApprovalChainView>(`/runs/${id}/approval-chain`),
      read<{ readonly items: readonly PayrollReconciliationView[] }>(`/runs/${id}/reconciliation`),
      read<Paged<AccountingLineView>>(`/runs/${id}/accounting-output?${PAGE}`),
      read<Paged<PaymentInstructionView>>(`/runs/${id}/payment-instructions?${PAGE}`),
    ]);

  return {
    run,
    results: listing(results),
    exceptions: itemsOf(exceptions),
    adjustments: itemsOf(adjustments),
    approvals,
    reconciliation: itemsOf(reconciliation),
    accounting: listing(accounting),
    payments: listing(payments),
  };
};

/**
 * One employee's result, whole, from one bounded read.
 *
 * `PayslipView` carries the period, the payment date, the currency, the three published totals and
 * **both line sets** together, so nothing here asks for earnings or deductions a second time — the
 * module returns them together precisely so a screen cannot show one line set from one state beside
 * a total from another. It answers `notFound` for a result it will not resolve.
 */
export const loadPayslip = async (payrollResultId: string): Promise<PayslipView | undefined> =>
  read<PayslipView>(`/results/${payrollResultId}/payslip`);
