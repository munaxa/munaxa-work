import { loadPortalProcessEnvironment } from '@work/config';
import type {
  EntitlementView,
  LeaveAdjustmentView,
  LeaveBalanceView,
  LeaveCalendarEntryView,
  LeaveDashboardView,
  LeavePolicyView,
  LeaveRequestView,
  LeaveTypeView,
  LedgerEntryView,
} from '@work/leave/contracts';

/**
 * Reading the leave register from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no business
 * knowing about.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * So these calls are written against the real contract and fail closed: an unreachable or
 * unauthorized API renders the empty state rather than an error page, because "not signed in yet" is
 * the expected condition today rather than a fault.
 *
 * **The reconciliation count is read and shown but never acted on from here.** It is the one number
 * on the screen that reveals a *failure* — balances whose ledger moved and which nobody has
 * recalculated — and running the recalculation is a `POST` an operator makes.
 */

export interface LeaveForDisplay {
  readonly dashboard: LeaveDashboardView | undefined;
  readonly types: readonly LeaveTypeView[];
  readonly policies: readonly LeavePolicyView[];
  readonly entitlements: readonly EntitlementView[];
  readonly balances: readonly LeaveBalanceView[];
  readonly ledger: readonly LedgerEntryView[];
  readonly requests: readonly LeaveRequestView[];
  readonly approvals: readonly LeaveRequestView[];
  readonly calendar: readonly LeaveCalendarEntryView[];
  readonly adjustments: readonly LeaveAdjustmentView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/leave${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

interface Page<TItem> {
  readonly items: readonly TItem[];
}

const EMPTY: LeaveForDisplay = {
  dashboard: undefined,
  types: [],
  policies: [],
  entitlements: [],
  balances: [],
  ledger: [],
  requests: [],
  approvals: [],
  calendar: [],
  adjustments: [],
  unavailable: true,
};

/**
 * A civil date window around today, in whichever zone the *browser process* is in.
 *
 * The screen is honest about this: it is a default range for a list, not a leave date. Which dates a
 * request covers is decided by the day rows the domain wrote, in the schedule's zone, and never here
 * — a screen that computed a leave date would be a second answer to a question the module already
 * answered once.
 */
const windowAround = (today: Date, days: number): { from: string; to: string } => {
  const start = new Date(today.getTime() - days * 86_400_000);
  const end = new Date(today.getTime() + days * 86_400_000);

  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
};

/**
 * The reads the screen makes.
 *
 * The dashboard is read first and its failure is the signal: if the service will not answer the
 * cheapest question, the rest is a page of empty tables and a wall of failed requests.
 */
export const loadLeave = async (today = new Date()): Promise<LeaveForDisplay> => {
  const dashboard = await read<LeaveDashboardView>('/dashboard');

  if (dashboard === undefined) return EMPTY;

  return { dashboard, unavailable: false, ...(await lists(windowAround(today, 30))) };
};

/**
 * The nine reads behind the nine sections.
 *
 * Each one falls back to empty rather than failing the page: a caller who holds
 * `leave.balance.read` but not `leave.read` should get the balance list and an empty request list,
 * which is exactly what that permission separation means.
 */
const lists = async (range: {
  readonly from: string;
  readonly to: string;
}): Promise<Omit<LeaveForDisplay, 'dashboard' | 'unavailable'>> => ({
  types: itemsOf(await read<Page<LeaveTypeView>>('/types')),
  policies: itemsOf(await read<Page<LeavePolicyView>>('/policies')),
  entitlements: itemsOf(await read<Page<EntitlementView>>('/entitlements')),
  balances: itemsOf(await read<Page<LeaveBalanceView>>('/balances')),
  ledger: itemsOf(await read<Page<LedgerEntryView>>('/balances/ledger')),
  requests: itemsOf(await read<Page<LeaveRequestView>>('/requests')),
  approvals: itemsOf(await read<Page<LeaveRequestView>>('/requests?state=pending_approval')),
  calendar:
    (
      await read<{ entries: readonly LeaveCalendarEntryView[] }>(
        `/requests/calendar?from=${range.from}&to=${range.to}`,
      )
    )?.entries ?? [],
  adjustments: itemsOf(await read<Page<LeaveAdjustmentView>>('/adjustments')),
});

const itemsOf = <TItem>(page: Page<TItem> | undefined): readonly TItem[] => page?.items ?? [];
