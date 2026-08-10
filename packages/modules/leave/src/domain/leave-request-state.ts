import type { Metadata } from './leave-aggregate.js';
import type {
  DayPortion,
  Decision,
  DurationBasis,
  RequestEventKind,
  RequestState,
} from './leave-vocabulary.js';

/**
 * The persisted shapes of a leave request and its three children, kept apart from the aggregate
 * that manipulates them.
 *
 * Separated for the reason Attendance separates `attendance-day-state.ts`: the row mappers, the
 * views and the in-memory stores all need the shape and none of them needs the behaviour, and a
 * file that carried both would be imported by everything.
 */

export interface LeaveRequestState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  /** The policy **version** that governed it, recorded so a later version cannot rewrite history. */
  readonly leavePolicyId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly totalMinutes: number;
  readonly durationBasis: DurationBasis;
  readonly state: RequestState;
  readonly reasonCode?: string;
  readonly justification?: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly submittedAt?: Date;
  /**
   * What they had when they asked.
   *
   * Recorded on the request because the specification requires it and because "what did they have
   * when they asked" is the first question in every dispute about a refused request.
   */
  readonly balanceAtRequestMinutes: number;
  readonly approvalsRequired: number;
  readonly approvedAt?: Date;
  readonly rejectedAt?: Date;
  readonly cancelledAt?: Date;
  readonly cancelledBy?: string;
  readonly cancellationReasonCode?: string;
  readonly withdrawnAt?: Date;
  readonly contactDuringAbsence?: string;
  readonly addressDuringAbsence?: string;
  /**
   * Who covers the work. **Not** who covers the authority — that is `delegationId`, and the two
   * being different things is why there are two columns.
   */
  readonly replacementEmploymentId?: string;
  /** A reference to Identity's delegation. Leave stores it and never creates one. */
  readonly delegationId?: string;
  /** A reference. Leave stores no bytes; no DocumentPort adapter exists (§35.7). */
  readonly attachmentReference?: string;
  readonly supersedesRequestId?: string;
  /** Reserved for Phase 16, present and null — as Recruitment's and Attendance's are. */
  readonly approvalId?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

/**
 * One civil date of a request.
 *
 * This child is what makes duration unambiguous, and it is **exactly what the published
 * `approved-leave-for` read returns** — so Attendance and Leave cannot disagree about which dates
 * are covered. A request is not "three days"; it is three rows whose minutes sum.
 *
 * A date on which nothing was expected has **no row**. That is how a weekend inside a request
 * becomes visible as an absence rather than as an unexplained shortfall, and it is why a screen can
 * say which dates were excluded and why.
 */
export interface RequestDayState {
  readonly id: string;
  readonly tenantId: string;
  readonly leaveRequestId: string;
  readonly employmentId: string;
  readonly onDate: string;
  readonly portion: DayPortion;
  readonly minutes: number;
  /** Wall clock, for the hourly portion only. Meaningless without `zone`. */
  readonly startLocal?: string;
  readonly endLocal?: string;
  /** The IANA zone the wall clock is meant in — Attendance's schedule zone, never a guess. */
  readonly zone: string;
  /** What the working-day basis said was expected on this date. The denominator for a half day. */
  readonly expectedMinutes: number;
  readonly version: number;
}

/**
 * A named human's decision.
 *
 * `requestedBy` is **copied onto this row**, deliberately rather than carelessly: a check
 * constraint cannot reach another table, so `check (decided_by <> requested_by)` is only
 * enforceable in the database if both values are on the same row. It is written once, at insert,
 * from the request — never supplied by a caller (§12.2).
 *
 * Decisions are **inserted and read**. A decision that was wrong is reversed by a new row naming
 * the one it reverses, because "they approved it and then unapproved it" and "they never approved
 * it" are different facts.
 */
export interface RequestDecisionState {
  readonly id: string;
  readonly tenantId: string;
  readonly leaveRequestId: string;
  readonly sequence: number;
  readonly decision: Decision;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly requestedBy: string;
  readonly comment?: string;
  readonly reversesDecisionId?: string;
  readonly version: number;
}

/**
 * What happened to a request, as history rather than as something inferred from audit columns.
 *
 * Kept because "what state was this request in on the fourteenth" has to be answerable to somebody
 * who was not subscribed to anything, and because event delivery here is at-most-once with no
 * outbox — a history reconstructed from events would have holes exactly where somebody is looking
 * (§35.1).
 */
export interface RequestEventState {
  readonly id: string;
  readonly tenantId: string;
  readonly leaveRequestId: string;
  readonly kind: RequestEventKind;
  readonly fromState?: RequestState;
  readonly toState?: RequestState;
  readonly detail?: string;
  readonly occurredAt: Date;
  readonly recordedBy: string;
  readonly version: number;
}
