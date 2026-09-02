import type { EmploymentView } from '@work/employment/contracts';
import { apiOutcome } from '../shell/api-request';
import type {
  AccrualRunView,
  EntitlementView,
  LeaveAdjustmentView,
  LeaveApprovalChainView,
  LeaveBalanceView,
  LeaveDashboardView,
  LeavePolicyView,
  LeaveRequestView,
  LeaveTypeView,
  LedgerEntryView,
  ProjectedBalanceView,
} from '@work/leave/contracts';

/**
 * Reading leave from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps these screens from breaking on a refactor they have no
 * business knowing about.
 *
 * **No screen reads the first row of anything.** A request is addressed by `leave.request`, which
 * answers `notFound` for an identifier it will not resolve; an employment's standing is addressed
 * by that employment's own identifier. Nothing here picks a row and describes it as *the* request,
 * *the* balance or *the* leave type.
 *
 * **A 404 and a 403 are different answers, and this layer keeps them apart.** Every read before
 * this slice collapsed both into `undefined`, so a route could not tell "no such request" from "you
 * may not read requests" and rendered not-found for both. `outcome` carries the distinction as far
 * as the route, which is the only place that can act on it: a missing record is a 404 page, a
 * refusal is the withheld state. Sections that are not the route's subject stay `undefined`-or-
 * value, because a section has only one thing to say either way.
 *
 * **Two permissions, two different refusals.** `leave.read` answers requests, the approval chain,
 * types, policies, entitlements and adjustments; `leave.balance.read` answers balances, the ledger,
 * the projection and the reconciliation queue. The module separates them because a request carries
 * the requester's own words and a balance does not, and a caller may hold either alone — so each
 * read is kept as its own value and each section says which of them happened to it.
 *
 * **The total is the server's, always.** Every paged read returns `{ items, total }` counted in the
 * database. The screen this replaced discarded `total` in an `itemsOf` helper and showed five rows
 * of two hundred and sixty-eight with nothing saying so.
 *
 * **Nothing here computes.** No balance from a sum of ledger entries, no duration from two dates,
 * no working days, no accrual, no "current" leave year. Every figure is published or it is not
 * shown.
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
 * What a read that defines a route actually answered.
 *
 * `missing` is a 404 the module raised deliberately — Leave answers 404 rather than 403 for a
 * record in another tenant, because "forbidden" on a leave request identifier would confirm that
 * somebody in this system asked for leave, and on a sick-leave request that is close to a health
 * disclosure. `refused` is a 401 or a 403. Collapsing the two would either leak that distinction or
 * render a not-found page at a caller who simply lacks a permission.
 */
export type Outcome<TValue> =
  | { readonly kind: 'ok'; readonly value: TValue }
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused' };

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a leave page holds the justification somebody wrote on a sick-leave
 * request, and a cached copy of it is health-adjacent text sitting somewhere nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  const answer = await outcome<TValue>(path);

  return answer.kind === 'ok' ? answer.value : undefined;
};

const outcome = async <TValue>(path: string): Promise<Outcome<TValue>> => {
  const answer = await apiOutcome<TValue>(`${path}`);

  if (answer.kind === 'ok') return { kind: 'ok', value: answer.value };
  return answer.kind === 'missing' ? { kind: 'missing' } : { kind: 'refused' };
};

const listing = <TItem>(page: Paged<TItem> | undefined): Listing<TItem> | undefined =>
  page === undefined ? undefined : { items: page.items, total: page.total };

const itemsOf = <TItem>(
  wrapper: { readonly items: readonly TItem[] } | undefined,
): readonly TItem[] | undefined => wrapper?.items;

/** The reconciliation read publishes a total and a bounded sample, not a page. */
export interface Reconciliation {
  readonly total: number;
  readonly balances: readonly {
    readonly balanceId: string;
    readonly employmentId: string;
    readonly leaveTypeId: string;
    readonly leaveYearStart: string;
    readonly inputsChangedAt?: Date;
    readonly calculatedAt?: Date;
  }[];
}

export interface LeaveRegister {
  /** Absent means refused. The cheapest read under `leave.read`, and the signal for the rest. */
  readonly dashboard: LeaveDashboardView | undefined;
  readonly requests: Listing<LeaveRequestView> | undefined;
  /** Absent means `leave.balance.read` was refused — not that no balance has been calculated. */
  readonly balances: Listing<LeaveBalanceView> | undefined;
  readonly reconciliation: Reconciliation | undefined;
  readonly types: readonly LeaveTypeView[] | undefined;
  readonly policies: readonly LeavePolicyView[] | undefined;
  readonly accrualRuns: readonly AccrualRunView[] | undefined;
}

/**
 * The register: what leave has been asked for, what the balances behind it are, and what they are
 * calculated from.
 *
 * Seven reads across two permissions, issued together. The reconciliation count is read and shown
 * but never acted on from here — it is the one number on the screen that reveals a *failure*, and
 * running the recalculation is a `POST` an operator or a scheduler makes.
 */
export const loadLeaveRegister = async (): Promise<LeaveRegister> => {
  const [dashboard, requests, balances, reconciliation, types, policies, accrualRuns] =
    await Promise.all([
      read<LeaveDashboardView>('/leave/dashboard'),
      read<Paged<LeaveRequestView>>(`/leave/requests?${PAGE}`),
      read<Paged<LeaveBalanceView>>(`/leave/balances?${PAGE}`),
      read<Reconciliation>('/leave/balances/reconciliation'),
      read<{ readonly items: readonly LeaveTypeView[] }>('/leave/types'),
      read<{ readonly items: readonly LeavePolicyView[] }>('/leave/policies'),
      read<{ readonly items: readonly AccrualRunView[] }>('/leave/accrual-runs'),
    ]);

  return {
    dashboard,
    requests: listing(requests),
    balances: listing(balances),
    reconciliation,
    types: itemsOf(types),
    policies: itemsOf(policies),
    accrualRuns: itemsOf(accrualRuns),
  };
};

/** True when not one of the register's reads answered — the ordinary state of this deployment. */
export const registerAnsweredNothing = (register: LeaveRegister): boolean =>
  register.dashboard === undefined &&
  register.requests === undefined &&
  register.balances === undefined &&
  register.reconciliation === undefined &&
  register.types === undefined &&
  register.policies === undefined;

/**
 * One request, asked for first and on its own.
 *
 * An identifier the API will not resolve is a 404 rather than a page of refusals about a request
 * that may not exist, and asking for three more things about it would be three requests spent to
 * render nothing. The outcome is carried out whole so the route can tell the two apart.
 */
export const loadRequest = async (leaveRequestId: string): Promise<Outcome<LeaveRequestView>> =>
  outcome<LeaveRequestView>(`/leave/requests/${leaveRequestId}`);

export interface RequestForDisplay {
  readonly request: LeaveRequestView;
  /** Absent means the chain was refused. `approvalRequired: false` means nobody had to decide. */
  readonly approvals: LeaveApprovalChainView | undefined;
  /** The configured types, read once to name this request's own. Leave publishes no read by id. */
  readonly types: readonly LeaveTypeView[] | undefined;
  /**
   * The requester's employment, from Employment's own bounded read of one identifier.
   *
   * One request for one employment, never a list scanned for a match: this is the only honest way
   * to put a name on this page, and `personName` is present only when the caller may read the
   * person, which Employment decides rather than this screen.
   */
  readonly employment: EmploymentView | undefined;
}

/** Everything else about it, in one round. */
export const loadRequestDetail = async (request: LeaveRequestView): Promise<RequestForDisplay> => {
  const [approvals, types, employment] = await Promise.all([
    read<LeaveApprovalChainView>(`/leave/requests/${request.leaveRequestId}/approval-chain`),
    read<{ readonly items: readonly LeaveTypeView[] }>('/leave/types'),
    read<EmploymentView>(`/employments/${request.employmentId}`),
  ]);

  return { request, approvals, types: itemsOf(types), employment };
};

export interface StandingForDisplay {
  /** Absent means `leave.balance.read` was refused. */
  readonly balances: Listing<LeaveBalanceView> | undefined;
  readonly ledger: Listing<LedgerEntryView> | undefined;
  /**
   * Present only when a leave type was chosen.
   *
   * `leave.projected-balance` is keyed on one leave type, and choosing one on the reader's behalf
   * would be the `runs[0]` defect in another module. `missing` is a real answer here: the module
   * returns 404 when the employment, the published policy or the balance bucket does not exist.
   */
  readonly projection: Outcome<ProjectedBalanceView> | undefined;
  /** Absent means `leave.read` was refused. Its own permission, its own answer. */
  readonly entitlements: Listing<EntitlementView> | undefined;
  readonly adjustments: Listing<LeaveAdjustmentView> | undefined;
  readonly requests: Listing<LeaveRequestView> | undefined;
  readonly types: readonly LeaveTypeView[] | undefined;
  readonly employment: EmploymentView | undefined;
}

/**
 * One employment's leave standing: every balance it holds, and the movements that produced them.
 *
 * Seven reads across two permissions. The projection is asked for only when a leave type was
 * chosen, so the page issues one projection request at most and never one per balance row.
 */
export const loadStanding = async (
  employmentId: string,
  selected: { readonly leaveTypeId?: string; readonly onDate: string },
): Promise<StandingForDisplay> => {
  const forEmployment = `employmentId=${employmentId}`;
  const narrowed = selected.leaveTypeId === undefined ? '' : `&leaveTypeId=${selected.leaveTypeId}`;

  const [balances, ledger, entitlements, adjustments, requests, types, employment, projection] =
    await Promise.all([
      read<Paged<LeaveBalanceView>>(`/leave/balances?${forEmployment}${narrowed}&${PAGE}`),
      read<Paged<LedgerEntryView>>(`/leave/balances/ledger?${forEmployment}${narrowed}&${PAGE}`),
      read<Paged<EntitlementView>>(`/leave/entitlements?${forEmployment}${narrowed}&${PAGE}`),
      read<Paged<LeaveAdjustmentView>>(`/leave/adjustments?${forEmployment}${narrowed}&${PAGE}`),
      read<Paged<LeaveRequestView>>(`/leave/requests?${forEmployment}${narrowed}&${PAGE}`),
      read<{ readonly items: readonly LeaveTypeView[] }>('/leave/types'),
      read<EmploymentView>(`/employments/${employmentId}`),
      selected.leaveTypeId === undefined
        ? undefined
        : outcome<ProjectedBalanceView>(
            `/leave/balances/${employmentId}/projected?leaveTypeId=${selected.leaveTypeId}&date=${selected.onDate}`,
          ),
    ]);

  return {
    balances: listing(balances),
    ledger: listing(ledger),
    projection,
    entitlements: listing(entitlements),
    adjustments: listing(adjustments),
    requests: listing(requests),
    types: itemsOf(types),
    employment,
  };
};

/** True when not one of the standing's reads answered. */
export const standingAnsweredNothing = (standing: StandingForDisplay): boolean =>
  standing.balances === undefined &&
  standing.ledger === undefined &&
  standing.entitlements === undefined &&
  standing.adjustments === undefined &&
  standing.requests === undefined &&
  standing.types === undefined;
