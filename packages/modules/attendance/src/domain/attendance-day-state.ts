import type { Metadata } from './attendance-aggregate.js';
import type {
  DayKind,
  DayState,
  ExceptionKind,
  ExceptionSeverity,
  ExceptionState,
  LeaveState,
} from './attendance-vocabulary.js';

/**
 * The calculated working day, apart from the aggregate that guards it.
 *
 * Separate for the reason Employment, Recruitment and Onboarding separated theirs: the calculation
 * is a pure function over this shape and the day's events, and a file that both declared the state
 * and imported the functions reading it would be a cycle.
 *
 * **What is not here is the design.** No employment status, no employee number, no contracted
 * hours, no manager, no person, no unit, no rate and no amount. Those are Employment's,
 * Organization's, People's and Payroll's, read as at a date through their published services and
 * never copied (ADR-0051, ADR-0054).
 *
 * **What is here twice is also the design.** `scheduleId` *and* `scheduleVersion`, `policyId` *and*
 * `policyVersion`: a day records which *version* of each input produced it, so a schedule edited in
 * June cannot change what March meant and a recalculation of March can prove it used March's rules.
 */
export interface AttendanceDayState {
  readonly id: string;
  readonly tenantId: string;
  /** Employment's, by identifier and by foreign key. Never a person. */
  readonly employmentId: string;
  readonly attendanceDate: string;
  /** Resolved at calculation and stored, because a schedule's zone can be corrected later. */
  readonly zone: string;
  readonly scheduleId?: string;
  readonly scheduleVersion?: number;
  readonly shiftId?: string;
  readonly rosterEntryId?: string;
  readonly policyId?: string;
  readonly policyVersion?: number;
  readonly dayKind: DayKind;
  readonly expectedStartAt?: Date;
  readonly expectedEndAt?: Date;
  readonly expectedMinutes: number;
  readonly expectedBreakMinutes: number;
  readonly firstInAt?: Date;
  readonly lastOutAt?: Date;
  readonly workedMinutes: number;
  readonly breakMinutesTaken: number;
  readonly paidBreakMinutes: number;
  readonly regularCandidateMinutes: number;
  readonly overtimeCandidateMinutes: number;
  readonly unpaidMinutes: number;
  readonly absenceMinutes: number;
  /** `unknown` is a real answer and is not `none` (ADR-0056). */
  readonly leaveState: LeaveState;
  readonly leaveMinutes: number;
  readonly state: DayState;
  readonly approvedAt?: Date;
  readonly approvedBy?: string;
  readonly lockedAt?: Date;
  /** Reserved for Workflow (Phase 16). Null while Attendance records the decision directly. */
  readonly approvalReference?: string;
  readonly calculationVersion: number;
  readonly inputsDigest: string;
  readonly calculatedAt?: Date;
  /**
   * When an input last moved.
   *
   * Written in the same transaction as the change that moved it, which is what makes recalculation
   * findable by asking rather than by being told. Event delivery here is at-most-once with no
   * outbox, so a day that waited to be notified would wait for ever (ADR-0053).
   */
  readonly inputsChangedAt?: Date;
  readonly metadata: Metadata;
  readonly version: number;
}

/** One deviation on one day. A child of the day, resolved with it rather than beside it. */
export interface DayExceptionState {
  readonly id: string;
  readonly tenantId: string;
  readonly attendanceDayId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly kind: ExceptionKind;
  readonly severity: ExceptionSeverity;
  readonly state: ExceptionState;
  readonly detail?: string;
  readonly minutes?: number;
  readonly resolutionReasonCode?: string;
  readonly resolvedAt?: Date;
  readonly resolvedBy?: string;
  readonly version: number;
}

/** A blocking exception is the only thing severity mechanically does: it prevents sign-off. */
export const isBlocking = (exception: DayExceptionState): boolean =>
  exception.severity === 'blocking' && exception.state === 'open';
