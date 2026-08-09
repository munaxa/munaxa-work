import type { Transaction } from '@work/kernel';

import type { AttendanceDayState, DayExceptionState } from '../domain/attendance-day-state.js';
import type { CorrectionRequestState } from '../domain/correction.js';
import type { PolicyState } from '../domain/attendance-policy.js';
import type { RosterEntryState } from '../domain/roster-entry.js';
import type {
  ScheduleAssignmentState,
  ScheduleDayState,
  ScheduleState,
} from '../domain/schedule.js';
import type { SegmentState, ShiftState } from '../domain/shift.js';
import type { TimeEventState } from '../domain/time-event.js';

/**
 * What the application layer needs from persistence and from the modules Attendance depends on,
 * stated as interfaces it owns.
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

export interface EventQuery extends Paged {
  readonly employmentId?: string;
  readonly source?: string;
  readonly kind?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

/**
 * Time events: inserted and read, and **nothing else**.
 *
 * No `update`, no `remove`, no `restore`. A history that can be amended is not history, and the
 * cheapest guarantee is to have no method that could (ADR-0052). A correction inserts a new event
 * carrying `supersedesEventId`.
 */
export interface TimeEventStore {
  byId(transaction: Transaction, id: string): Promise<TimeEventState | undefined>;
  /** The read ingestion makes before it writes. The unique index is what actually enforces it. */
  byKey(transaction: Transaction, eventKey: string): Promise<TimeEventState | undefined>;
  /**
   * Every event that belongs to one employment's day, including the superseded ones.
   *
   * Superseded events are returned rather than filtered in SQL because *which* events a correction
   * replaced is a domain rule, and a query that quietly applied it would put the rule in two places.
   */
  forDay(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<readonly TimeEventState[]>;
  search(transaction: Transaction, query: EventQuery): Promise<Page<TimeEventState>>;
  insert(transaction: Transaction, state: TimeEventState): Promise<void>;
}

export interface DayQuery extends Paged {
  readonly employmentId?: string;
  readonly employmentIds?: readonly string[];
  readonly state?: string;
  readonly dayKind?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface DayStore {
  byId(transaction: Transaction, id: string): Promise<AttendanceDayState | undefined>;
  /** One employment on one date. The uniqueness boundary a partial unique index enforces. */
  byDate(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<AttendanceDayState | undefined>;
  forPeriod(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<readonly AttendanceDayState[]>;
  /**
   * Days whose inputs moved after they were last calculated — the reconciliation read.
   *
   * Event delivery is at-most-once with no outbox, so recalculation is found by asking rather than
   * by being told (ADR-0053). Bounded, because a run has to finish.
   */
  stale(transaction: Transaction, limit: number): Promise<readonly AttendanceDayState[]>;
  /**
   * Marks days as needing recalculation, in the same transaction as the change that moved an input.
   *
   * A bulk statement rather than a read-modify-write loop: a published policy can touch every day
   * in a month for every employment, and loading them to mark them would be the N+1 this module
   * cannot afford.
   */
  markStale(
    transaction: Transaction,
    scope: { readonly employmentId?: string; readonly from: string; readonly to: string },
    at: Date,
  ): Promise<number>;
  search(transaction: Transaction, query: DayQuery): Promise<Page<AttendanceDayState>>;
  insert(transaction: Transaction, state: AttendanceDayState): Promise<void>;
  update(transaction: Transaction, state: AttendanceDayState, expected: number): Promise<void>;
}

export interface ExceptionQuery extends Paged {
  readonly employmentId?: string;
  readonly kind?: string;
  readonly severity?: string;
  readonly state?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface ExceptionStore {
  byId(transaction: Transaction, id: string): Promise<DayExceptionState | undefined>;
  forDay(transaction: Transaction, attendanceDayId: string): Promise<readonly DayExceptionState[]>;
  forDays(
    transaction: Transaction,
    attendanceDayIds: readonly string[],
  ): Promise<readonly DayExceptionState[]>;
  search(transaction: Transaction, query: ExceptionQuery): Promise<Page<DayExceptionState>>;
  /** Counts open blocking exceptions across a period. What freezing a snapshot reports. */
  countBlocking(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<number>;
  insert(transaction: Transaction, state: DayExceptionState): Promise<void>;
  update(transaction: Transaction, state: DayExceptionState, expected: number): Promise<void>;
  /** A recalculation supersedes the open exceptions it is about to replace. Nothing is deleted. */
  supersedeOpen(transaction: Transaction, attendanceDayId: string, at: Date): Promise<void>;
}

export interface ShiftStore {
  byId(transaction: Transaction, id: string): Promise<ShiftState | undefined>;
  byIds(transaction: Transaction, ids: readonly string[]): Promise<readonly ShiftState[]>;
  byCode(transaction: Transaction, code: string): Promise<ShiftState | undefined>;
  all(transaction: Transaction): Promise<readonly ShiftState[]>;
  insert(transaction: Transaction, state: ShiftState): Promise<void>;
  update(transaction: Transaction, state: ShiftState, expected: number): Promise<void>;
}

export interface SegmentStore {
  forShift(transaction: Transaction, shiftId: string): Promise<readonly SegmentState[]>;
  forShifts(
    transaction: Transaction,
    shiftIds: readonly string[],
  ): Promise<readonly SegmentState[]>;
  insert(transaction: Transaction, state: SegmentState): Promise<void>;
}

export interface ScheduleStore {
  byId(transaction: Transaction, id: string): Promise<ScheduleState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<ScheduleState | undefined>;
  all(transaction: Transaction): Promise<readonly ScheduleState[]>;
  insert(transaction: Transaction, state: ScheduleState): Promise<void>;
  update(transaction: Transaction, state: ScheduleState, expected: number): Promise<void>;
}

export interface ScheduleDayStore {
  forSchedule(transaction: Transaction, scheduleId: string): Promise<readonly ScheduleDayState[]>;
  insert(transaction: Transaction, state: ScheduleDayState): Promise<void>;
}

export interface AssignmentStore {
  byId(transaction: Transaction, id: string): Promise<ScheduleAssignmentState | undefined>;
  forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly ScheduleAssignmentState[]>;
  insert(transaction: Transaction, state: ScheduleAssignmentState): Promise<void>;
  update(transaction: Transaction, state: ScheduleAssignmentState, expected: number): Promise<void>;
}

export interface RosterStore {
  byId(transaction: Transaction, id: string): Promise<RosterEntryState | undefined>;
  on(
    transaction: Transaction,
    employmentId: string,
    onDate: string,
  ): Promise<RosterEntryState | undefined>;
  between(
    transaction: Transaction,
    from: string,
    to: string,
    employmentId?: string,
  ): Promise<readonly RosterEntryState[]>;
  insert(transaction: Transaction, state: RosterEntryState): Promise<void>;
  /** Superseding a past entry. Soft, so "who moved the rota" stays answerable. */
  remove(transaction: Transaction, id: string, expected: number): Promise<void>;
}

export interface PolicyStore {
  byId(transaction: Transaction, id: string): Promise<PolicyState | undefined>;
  published(transaction: Transaction): Promise<readonly PolicyState[]>;
  all(transaction: Transaction): Promise<readonly PolicyState[]>;
  insert(transaction: Transaction, state: PolicyState): Promise<void>;
  update(transaction: Transaction, state: PolicyState, expected: number): Promise<void>;
}

export interface CorrectionQuery extends Paged {
  readonly employmentId?: string;
  readonly state?: string;
  readonly kind?: string;
}

export interface CorrectionStore {
  byId(transaction: Transaction, id: string): Promise<CorrectionRequestState | undefined>;
  /**
   * The events an applied `remove_event` correction took out of the arithmetic.
   *
   * The correction record is the tombstone. Nothing deletes an event and nothing writes a
   * compensating punch that never happened, so this is how the calculation learns to leave one out
   * (ADR-0052).
   */
  appliedRemovals(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<readonly string[]>;
  search(transaction: Transaction, query: CorrectionQuery): Promise<Page<CorrectionRequestState>>;
  insert(transaction: Transaction, state: CorrectionRequestState): Promise<void>;
  update(transaction: Transaction, state: CorrectionRequestState, expected: number): Promise<void>;
}

/** The frozen output Payroll reads. Inserted and read; a correction produces the next sequence. */
export interface SnapshotState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly sequence: number;
  readonly frozenAt: Date;
  readonly frozenBy: string;
  readonly workedMinutes: number;
  readonly regularCandidateMinutes: number;
  readonly overtimeCandidateMinutes: number;
  readonly unpaidMinutes: number;
  readonly absenceMinutes: number;
  readonly leaveMinutes: number;
  readonly leaveState: string;
  readonly daysTotal: number;
  readonly daysApproved: number;
  readonly daysUnapproved: number;
  readonly blockingExceptions: number;
  readonly calculationVersion: number;
  readonly inputsDigest: string;
  readonly version: number;
}

export interface SnapshotStore {
  latest(
    transaction: Transaction,
    employmentId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<SnapshotState | undefined>;
  forPeriod(
    transaction: Transaction,
    periodStart: string,
    periodEnd: string,
    employmentId?: string,
  ): Promise<readonly SnapshotState[]>;
  insert(transaction: Transaction, state: SnapshotState): Promise<void>;
}

export interface ImportBatchState {
  readonly id: string;
  readonly tenantId: string;
  readonly source: string;
  readonly sourceLabel?: string;
  readonly submittedAt: Date;
  readonly submittedBy: string;
  readonly rowsSubmitted: number;
  readonly rowsCreated: number;
  readonly rowsSkipped: number;
  readonly rowsFailed: number;
  readonly version: number;
}

export interface ImportBatchStore {
  byId(transaction: Transaction, id: string): Promise<ImportBatchState | undefined>;
  recent(transaction: Transaction, limit: number): Promise<readonly ImportBatchState[]>;
  insert(transaction: Transaction, state: ImportBatchState): Promise<void>;
  update(transaction: Transaction, state: ImportBatchState, expected: number): Promise<void>;
}

/** Everything this module's use cases persist, in one injectable bundle. */
export interface AttendanceStores {
  readonly events: TimeEventStore;
  readonly days: DayStore;
  readonly exceptions: ExceptionStore;
  readonly shifts: ShiftStore;
  readonly segments: SegmentStore;
  readonly schedules: ScheduleStore;
  readonly scheduleDays: ScheduleDayStore;
  readonly assignments: AssignmentStore;
  readonly rosters: RosterStore;
  readonly policies: PolicyStore;
  readonly corrections: CorrectionStore;
  readonly snapshots: SnapshotStore;
  readonly imports: ImportBatchStore;
}

/**
 * What Attendance needs of Employment, and nothing more.
 *
 * A port rather than a query, because Employment owns the employment and this module may not read
 * its tables. **Every method here runs under a bounded service grant** (ADR-0043): the caller is
 * authorized for the *attendance* operation, and the module — not the user — holds the narrow
 * Employment read the check needs.
 *
 * Note what is *not* here: no `create`, no `update`, no `personId`, and no contracted hours stored
 * anywhere. Attendance references an employment and copies no fact from it (ADR-0051).
 */
export interface EmploymentForAttendance {
  readonly employmentId: string;
  readonly status: string;
  readonly startDate: string;
  readonly endDate?: string;
  /** The assignment in force on the date asked for. Used for scoping, never as a place of work. */
  readonly unitId?: string;
  readonly managerEmploymentId?: string;
}

export interface EmploymentDirectoryPort {
  /** One employment **as it stood on a date**. Never "as it is now" when calculating history. */
  find(employmentId: string, asOf: string): Promise<EmploymentForAttendance | undefined>;
  /** A bounded page of employments that could have attendance. The roster and scoping read. */
  activeEmployments(limit: number): Promise<readonly EmploymentForAttendance[]>;
}

/**
 * What Leave will be able to tell Attendance, once Leave exists.
 *
 * **`known: false` is not "no leave".** It means nobody can be asked — there is no Leave module in
 * this repository — and the difference decides whether a person's record says they were absent
 * without leave or says plainly that the question is open. Collapsing the two would have the
 * product assert something about somebody that it has no way to support (ADR-0056).
 *
 * Phase 9 supplies the adapter. Nothing here implements Leave, creates a balance or holds an
 * entitlement.
 */
export interface ApprovedLeaveDay {
  readonly onDate: string;
  readonly coverage: 'full_day' | 'partial_day' | 'hourly';
  readonly minutes?: number;
  readonly leaveRequestId: string;
}

export type LeaveCoverage =
  { readonly known: false } | { readonly known: true; readonly days: readonly ApprovedLeaveDay[] };

export interface LeaveDirectoryPort {
  approvedLeaveFor(employmentId: string, from: string, to: string): Promise<LeaveCoverage>;
}

/**
 * The Leave adapter this repository actually has.
 *
 * It answers "unknown" and does so honestly. A stub that answered "no leave approved" would make
 * every unexplained absence read as absence *without leave*, which is a false statement on
 * somebody's record and exactly the fake completeness this phase refuses.
 */
export const leaveUnavailable: LeaveDirectoryPort = {
  approvedLeaveFor: () => Promise.resolve({ known: false }),
};

/** The clock, injected so recorded instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
