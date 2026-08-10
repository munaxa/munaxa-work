import type { Transaction } from '@work/kernel';

import type { BalanceState } from '../domain/balance.js';
import type { AdjustmentState, EntitlementState } from '../domain/entitlement.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { LeaveTypeState } from '../domain/leave-type.js';
import type { LedgerBucket, LedgerEntryState } from '../domain/ledger.js';
import type { BlackoutState, PolicyAssignmentState } from '../domain/policy-assignment.js';
import type { AccrualRunState, LeaveYearState } from '../domain/runs.js';
import type {
  LeaveRequestState,
  RequestDayState,
  RequestDecisionState,
  RequestEventState,
} from '../domain/leave-request-state.js';

/**
 * What the application layer needs from persistence and from the modules Leave depends on, stated
 * as interfaces it owns.
 *
 * The dependency points inward: the application declares what it needs and infrastructure
 * implements it, which is what lets every use case in this module be tested against fakes with no
 * database present. Every persistence method takes the `Transaction`, so a use case cannot
 * accidentally read outside the unit of work it is writing in.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TState> {
  readonly items: readonly TState[];
  readonly total: number;
}

export interface LeaveTypeStore {
  byId(transaction: Transaction, id: string): Promise<LeaveTypeState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<LeaveTypeState | undefined>;
  all(transaction: Transaction): Promise<readonly LeaveTypeState[]>;
  insert(transaction: Transaction, state: LeaveTypeState): Promise<void>;
  update(transaction: Transaction, state: LeaveTypeState, expected: number): Promise<void>;
}

export interface PolicyStore {
  byId(transaction: Transaction, id: string): Promise<LeavePolicyState | undefined>;
  forType(transaction: Transaction, leaveTypeId: string): Promise<readonly LeavePolicyState[]>;
  all(transaction: Transaction): Promise<readonly LeavePolicyState[]>;
  insert(transaction: Transaction, state: LeavePolicyState): Promise<void>;
  update(transaction: Transaction, state: LeavePolicyState, expected: number): Promise<void>;
}

export interface AssignmentStore {
  byId(transaction: Transaction, id: string): Promise<PolicyAssignmentState | undefined>;
  /**
   * Every assignment that could govern this employment on this date, across all four scopes.
   *
   * Returned unranked: which one wins is `resolvePolicy`'s decision, and a query that applied
   * most-specific-wins in SQL would put the rule in two places.
   */
  candidates(
    transaction: Transaction,
    scopeIds: readonly string[],
    onDate: string,
  ): Promise<readonly PolicyAssignmentState[]>;
  forPolicy(
    transaction: Transaction,
    leavePolicyId: string,
  ): Promise<readonly PolicyAssignmentState[]>;
  insert(transaction: Transaction, state: PolicyAssignmentState): Promise<void>;
  update(transaction: Transaction, state: PolicyAssignmentState, expected: number): Promise<void>;
}

export interface BlackoutStore {
  between(transaction: Transaction, from: string, to: string): Promise<readonly BlackoutState[]>;
  insert(transaction: Transaction, state: BlackoutState): Promise<void>;
}

export interface EntitlementQuery extends Paged {
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly leaveYearStart?: string;
}

export interface EntitlementSource {
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly source: string;
  readonly sourceId: string;
}

export interface EntitlementStore {
  byId(transaction: Transaction, id: string): Promise<EntitlementState | undefined>;
  /**
   * The idempotency read an accrual run makes before it grants.
   *
   * Backed by `leave_entitlement_source_key`. A run restarted after an interruption finds its own
   * grants here and skips them; the unique index is what guarantees it under concurrency.
   */
  bySource(
    transaction: Transaction,
    source: EntitlementSource,
  ): Promise<EntitlementState | undefined>;
  forBucket(transaction: Transaction, bucket: LedgerBucket): Promise<readonly EntitlementState[]>;
  search(transaction: Transaction, query: EntitlementQuery): Promise<Page<EntitlementState>>;
  insert(transaction: Transaction, state: EntitlementState): Promise<void>;
}

export interface LedgerQuery extends Paged {
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly leaveYearStart?: string;
  readonly kind?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

/**
 * The ledger: **inserted and read, and nothing else**.
 *
 * No `update`, no `remove`, no `restore`. A balance somebody disputes is a sum of rows, and the
 * cheapest way to guarantee nobody rewrote one is to have no method that could (ADR-0052 applied to
 * a second module). A correction inserts a reversal naming what it reverses.
 */
export interface LedgerStore {
  byId(transaction: Transaction, id: string): Promise<LedgerEntryState | undefined>;
  /** Every entry in a bucket. What the balance projection sums. */
  forBucket(transaction: Transaction, bucket: LedgerBucket): Promise<readonly LedgerEntryState[]>;
  /** Every entry in a bucket up to a civil date. What the as-of query re-derives from. */
  forBucketUpTo(
    transaction: Transaction,
    bucket: LedgerBucket,
    onDate: string,
  ): Promise<readonly LedgerEntryState[]>;
  /** The idempotency read every writer makes before it writes. The unique index enforces it. */
  bySource(
    transaction: Transaction,
    source: { readonly sourceKind: string; readonly sourceId: string; readonly kind: string },
  ): Promise<LedgerEntryState | undefined>;
  /** Every entry a request produced, for the reversal a cancellation or an amendment writes. */
  forSource(
    transaction: Transaction,
    source: { readonly sourceKind: string; readonly sourceId: string },
  ): Promise<readonly LedgerEntryState[]>;
  search(transaction: Transaction, query: LedgerQuery): Promise<Page<LedgerEntryState>>;
  insert(transaction: Transaction, state: LedgerEntryState): Promise<void>;
}

export interface BalanceQuery extends Paged {
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly leaveYearStart?: string;
}

export interface BalanceStore {
  forBucket(transaction: Transaction, bucket: LedgerBucket): Promise<BalanceState | undefined>;
  forEmployment(transaction: Transaction, employmentId: string): Promise<readonly BalanceState[]>;
  /**
   * Balances whose ledger moved after they were last calculated — the reconciliation read.
   *
   * The predicate is **presence of the stale mark**, matching the partial index exactly. Never a
   * comparison against `calculated_at`: an entry written within the same clock tick as the
   * calculation it invalidates would be lost by a comparison, and lost silently (ADR-0053).
   */
  stale(transaction: Transaction, limit: number): Promise<readonly BalanceState[]>;
  /**
   * Marks balances as needing recalculation, in the same transaction as the ledger entry.
   *
   * A bulk statement rather than a read-modify-write loop, because closing a leave year touches
   * every balance of a policy and loading them to mark them would be the N+1 this module cannot
   * afford. The tenant clause is not optional: a predicate write that lost it would fail silently
   * across tenants rather than loudly, which is why the isolation suite asserts this method
   * specifically (§24.3).
   */
  markStale(
    transaction: Transaction,
    scope: { readonly employmentId?: string; readonly leaveTypeId?: string },
    at: Date,
  ): Promise<number>;
  search(transaction: Transaction, query: BalanceQuery): Promise<Page<BalanceState>>;
  insert(transaction: Transaction, state: BalanceState): Promise<void>;
  update(transaction: Transaction, state: BalanceState, expected: number): Promise<void>;
}

export interface RequestQuery extends Paged {
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly state?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface RequestStore {
  byId(transaction: Transaction, id: string): Promise<LeaveRequestState | undefined>;
  forEmployment(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<readonly LeaveRequestState[]>;
  byIds(transaction: Transaction, ids: readonly string[]): Promise<readonly LeaveRequestState[]>;
  search(transaction: Transaction, query: RequestQuery): Promise<Page<LeaveRequestState>>;
  insert(transaction: Transaction, state: LeaveRequestState): Promise<void>;
  update(transaction: Transaction, state: LeaveRequestState, expected: number): Promise<void>;
}

/**
 * A day row joined to the two facts about its request a consumer needs.
 *
 * The leave type comes from the request rather than being copied onto the day row: a day belongs to
 * a request and a request has one type, and duplicating it would be a second copy that could differ.
 */
export interface CoveredDay extends RequestDayState {
  readonly requestState: string;
  readonly leaveTypeId: string;
}

export interface CoverageQuery {
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
  /** Only requests changed since this instant. What Attendance's reconciliation asks for. */
  readonly changedSince?: Date;
}

export interface RequestDayStore {
  forRequest(transaction: Transaction, requestId: string): Promise<readonly RequestDayState[]>;
  forRequests(
    transaction: Transaction,
    requestIds: readonly string[],
  ): Promise<readonly RequestDayState[]>;
  /**
   * The published coverage read, and the index it uses.
   *
   * `(tenant_id, employment_id, on_date)` — this is the query Attendance calls on every
   * recalculation, so its cost is multiplied by every day of every run.
   */
  covering(transaction: Transaction, query: CoverageQuery): Promise<readonly CoveredDay[]>;
  insert(transaction: Transaction, state: RequestDayState): Promise<void>;
  /** An amendment's superseded days step out of the overlap constraint's way. Soft, never hard. */
  remove(transaction: Transaction, id: string, at: Date): Promise<void>;
}

export interface DecisionStore {
  forRequest(transaction: Transaction, requestId: string): Promise<readonly RequestDecisionState[]>;
  insert(transaction: Transaction, state: RequestDecisionState): Promise<void>;
}

export interface RequestEventStore {
  forRequest(transaction: Transaction, requestId: string): Promise<readonly RequestEventState[]>;
  insert(transaction: Transaction, state: RequestEventState): Promise<void>;
}

export interface AdjustmentQuery extends Paged {
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
}

export interface AdjustmentStore {
  byId(transaction: Transaction, id: string): Promise<AdjustmentState | undefined>;
  search(transaction: Transaction, query: AdjustmentQuery): Promise<Page<AdjustmentState>>;
  insert(transaction: Transaction, state: AdjustmentState): Promise<void>;
}

export interface AccrualRunStore {
  byId(transaction: Transaction, id: string): Promise<AccrualRunState | undefined>;
  /** The run for a policy and period, so re-invoking the command resumes rather than reopens. */
  forPeriod(
    transaction: Transaction,
    leavePolicyId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<AccrualRunState | undefined>;
  recent(transaction: Transaction, limit: number): Promise<readonly AccrualRunState[]>;
  insert(transaction: Transaction, state: AccrualRunState): Promise<void>;
  update(transaction: Transaction, state: AccrualRunState, expected: number): Promise<void>;
}

export interface LeaveYearStore {
  byPolicyAndYear(
    transaction: Transaction,
    leavePolicyId: string,
    leaveYearStart: string,
  ): Promise<LeaveYearState | undefined>;
  recent(transaction: Transaction, limit: number): Promise<readonly LeaveYearState[]>;
  insert(transaction: Transaction, state: LeaveYearState): Promise<void>;
}

/** Everything this module's use cases persist, in one injectable bundle. */
export interface LeaveStores {
  readonly types: LeaveTypeStore;
  readonly policies: PolicyStore;
  readonly assignments: AssignmentStore;
  readonly blackouts: BlackoutStore;
  readonly entitlements: EntitlementStore;
  readonly ledger: LedgerStore;
  readonly balances: BalanceStore;
  readonly requests: RequestStore;
  readonly requestDays: RequestDayStore;
  readonly decisions: DecisionStore;
  readonly requestEvents: RequestEventStore;
  readonly adjustments: AdjustmentStore;
  readonly accrualRuns: AccrualRunStore;
  readonly leaveYears: LeaveYearStore;
}

/**
 * What Leave needs of Employment, and nothing more.
 *
 * A port rather than a query, because Employment owns the employment and this module may not read
 * its tables. **Every method here runs under a bounded service grant** (ADR-0043): the caller is
 * authorized for the *leave* operation, and the module — not the user — holds the narrow Employment
 * read the check needs. Managing leave must not require a permission on the employment register.
 *
 * Note what is *not* here: no `create`, no `update`, no `personId`, no salary and no employment
 * status this module stores. Leave references an employment and copies no fact from it (ADR-0051),
 * and there is deliberately no `on_leave` status anywhere — ADR-0040 explains why an absence is not
 * a change of employment status.
 */
export interface EmploymentForLeave {
  readonly employmentId: string;
  readonly status: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly unitId?: string;
  readonly legalEntityId?: string;
  readonly managerEmploymentId?: string;
  /**
   * The contracted hours a day is converted through, where Employment knows them.
   *
   * **Absent is a real answer**, and the calculation refuses by name rather than assuming eight
   * hours. There is no default working day in this product, and inventing one would be a
   * labour-relations decision for a customer who never asked (§18).
   */
  readonly workingHoursPerWeek?: number;
  readonly onProbation?: boolean;
}

export interface EmploymentDirectoryPort {
  /** One employment **as it stood on a date**. Never "as it is now" when calculating history. */
  find(employmentId: string, asOf: string): Promise<EmploymentForLeave | undefined>;
  /** A bounded page of employments a run covers. */
  activeEmployments(limit: number): Promise<readonly EmploymentForLeave[]>;
}

/**
 * What Attendance can tell Leave about a working pattern.
 *
 * **Leave does not reimplement the schedule engine and does not read Organization's calendar.**
 * Attendance already owns "was Tuesday a working day, and for how long", already applies the roster
 * (so a public holiday recorded as a roster entry is picked up), and already resolves the schedule's
 * zone. Duplicating any of that here would create a second answer to the same question, and the two
 * would disagree the first time a rota changed (§19, decision D-1).
 *
 * **`known: false` is not "no working days".** It means Attendance could not be asked, and the
 * difference decides whether a request is computed against a pattern or refused by name. Collapsing
 * the two would silently compute somebody's leave against a calendar week they do not work — which
 * is the same class of mistake `leaveUnavailable` exists to prevent in the other direction
 * (ADR-0056).
 */
export interface WorkingDay {
  readonly onDate: string;
  readonly expected: boolean;
  readonly expectedMinutes: number;
  readonly dayKind: string;
  readonly zone: string;
}

export type WorkingDays =
  { readonly known: false } | { readonly known: true; readonly days: readonly WorkingDay[] };

export interface WorkingDayPort {
  expectedWorkingDays(employmentId: string, from: string, to: string): Promise<WorkingDays>;
}

/**
 * The Attendance adapter for a repository where Attendance cannot answer.
 *
 * It exists for tests and for a composition that deliberately leaves Attendance out. It answers
 * "unknown" honestly, and a `working_days` request against it is **refused by name** rather than
 * silently counted as calendar days.
 */
export const workingDaysUnavailable: WorkingDayPort = {
  expectedWorkingDays: () => Promise.resolve({ known: false }),
};

/** The clock, injected so recorded instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
