import { loadPortalProcessEnvironment } from '@work/config';
import type {
  AccountingLineView,
  DeductionDefinitionView,
  DeductionLineView,
  EarningLineView,
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
 * Reading the payroll from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no business
 * knowing about. **Nothing here touches a repository or a database.** Every figure on the screen
 * came out of an HTTP response.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * So these calls are written against the real contract and fail closed: an unreachable or
 * unauthorized API renders the empty state rather than an error page, because "not signed in yet" is
 * the expected condition today rather than a fault.
 *
 * **Several reads are expected to fail for most callers, and that is the design.** Results sit
 * behind `payroll.read-result`, adjustment *reasons* behind `payroll.adjust`, the accounting export
 * behind `payroll.accounting` and the payment file behind `payroll.payment`. A caller who can see
 * that a run covered 1,400 people and not what any of them was paid gets an empty results table —
 * which is exactly what that permission separation means, and the screen says so rather than
 * showing a blank.
 *
 * **Every amount is rendered as the string the API sent.** Nothing here parses a monetary value into
 * a JavaScript number: 9,007,199,254,740,993 minor units becomes 9,007,199,254,740,992 the moment
 * anything does, and a payroll is exactly where that matters.
 */

export interface PayrollForDisplay {
  readonly dashboard: PayrollDashboardView | undefined;
  readonly groups: readonly PayrollGroupView[];
  readonly definitions: readonly DeductionDefinitionView[];
  readonly periods: readonly PayrollPeriodView[];
  readonly runs: readonly PayrollRunView[];
  /** The run the detail sections describe: the most recent one, or nothing. */
  readonly run: PayrollRunView | undefined;
  readonly exceptions: readonly PayrollExceptionView[];
  readonly results: readonly PayrollResultView[];
  readonly earnings: readonly EarningLineView[];
  readonly deductions: readonly DeductionLineView[];
  readonly payslip: PayslipView | undefined;
  readonly approvals: PayrollApprovalChainView | undefined;
  readonly adjustments: readonly PayrollAdjustmentView[];
  readonly reconciliation: readonly PayrollReconciliationView[];
  readonly accounting: readonly AccountingLineView[];
  readonly payments: readonly PaymentInstructionView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
  /** True when the run is visible but its figures are not: a permission boundary, not an error. */
  readonly figuresWithheld: boolean;
}

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/payroll${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

interface Page<TItem> {
  readonly items: readonly TItem[];
}

const itemsOf = <TItem>(page: Page<TItem> | undefined): readonly TItem[] => page?.items ?? [];

const EMPTY: PayrollForDisplay = {
  dashboard: undefined,
  groups: [],
  definitions: [],
  periods: [],
  runs: [],
  run: undefined,
  exceptions: [],
  results: [],
  earnings: [],
  deductions: [],
  payslip: undefined,
  approvals: undefined,
  adjustments: [],
  reconciliation: [],
  accounting: [],
  payments: [],
  unavailable: true,
  figuresWithheld: false,
};

/**
 * The reads the screen makes.
 *
 * The dashboard is read first and its failure is the signal: if the service will not answer the
 * cheapest question, the rest is a page of empty tables and a wall of failed requests.
 */
export const loadPayroll = async (): Promise<PayrollForDisplay> => {
  const dashboard = await read<PayrollDashboardView>('/dashboard');

  if (dashboard === undefined) return EMPTY;

  const configuration = await configured();
  const runs = itemsOf(await read<Page<PayrollRunView>>('/runs?page=1&size=50'));
  const run = runs[0];

  return {
    ...EMPTY,
    dashboard,
    unavailable: false,
    ...configuration,
    runs,
    ...(run === undefined ? {} : await forRun(run)),
  };
};

const configured = async (): Promise<
  Pick<PayrollForDisplay, 'groups' | 'definitions' | 'periods'>
> => {
  const groups = itemsOf(await read<Page<PayrollGroupView>>('/groups'));
  const first = groups[0];

  return {
    groups,
    periods: itemsOf(await read<Page<PayrollPeriodView>>('/periods?page=1&size=50')),
    // Deduction definitions are **per group**, so the screen shows the first group's rather than
    // pretending there is a tenant-wide answer. There is no tenant-wide endpoint, and inventing
    // one here would be a screen answering a question the module deliberately scopes.
    definitions:
      first === undefined
        ? []
        : itemsOf(
            await read<Page<DeductionDefinitionView>>(
              `/deduction-definitions?payrollGroupId=${first.payrollGroupId}`,
            ),
          ),
  };
};

/** Everything about one run. Each read stands on its own permission and may legitimately fail. */
const forRun = async (
  run: PayrollRunView,
): Promise<
  Omit<PayrollForDisplay, 'dashboard' | 'groups' | 'definitions' | 'periods' | 'runs'>
> => {
  const id = run.payrollRunId;
  const results = await read<Page<PayrollResultView>>(`/runs/${id}/results?page=1&size=50`);
  const first = results?.items[0];

  return {
    run,
    unavailable: false,
    // The run reports how many results it produced. If it produced some and this caller was shown
    // none, the difference is `payroll.read-result` — a boundary, not an outage.
    figuresWithheld: results === undefined && run.resultCount > 0,
    results: itemsOf(results),
    exceptions: itemsOf(await read<Page<PayrollExceptionView>>(`/runs/${id}/exceptions`)),
    approvals: await read<PayrollApprovalChainView>(`/runs/${id}/approval-chain`),
    adjustments: itemsOf(await read<Page<PayrollAdjustmentView>>(`/runs/${id}/adjustments`)),
    reconciliation: itemsOf(
      await read<Page<PayrollReconciliationView>>(`/runs/${id}/reconciliation`),
    ),
    accounting: itemsOf(
      await read<Page<AccountingLineView>>(`/runs/${id}/accounting-output?page=1&size=50`),
    ),
    payments: itemsOf(
      await read<Page<PaymentInstructionView>>(`/runs/${id}/payment-instructions?page=1&size=50`),
    ),
    ...(await forResult(first?.payrollResultId)),
  };
};

/** One result's lines and payslip data, or nothing when the caller cannot see the figures. */
const forResult = async (
  payrollResultId: string | undefined,
): Promise<Pick<PayrollForDisplay, 'earnings' | 'deductions' | 'payslip'>> => {
  if (payrollResultId === undefined) return { earnings: [], deductions: [], payslip: undefined };

  return {
    earnings: itemsOf(await read<Page<EarningLineView>>(`/results/${payrollResultId}/earnings`)),
    deductions: itemsOf(
      await read<Page<DeductionLineView>>(`/results/${payrollResultId}/deductions`),
    ),
    payslip: await read<PayslipView>(`/results/${payrollResultId}/payslip`),
  };
};
