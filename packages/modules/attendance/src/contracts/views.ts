import type { BilingualText } from '../domain/attendance-aggregate.js';
import type {
  CorrectionKind,
  CorrectionState,
  DayKind,
  DayState,
  EventKind,
  EventSource,
  ExceptionKind,
  ExceptionSeverity,
  ExceptionState,
  LeaveState,
  ShiftKind,
} from '../domain/attendance-vocabulary.js';

/**
 * What Attendance publishes. Nothing here exposes a table, a repository or an aggregate.
 *
 * Two absences are the design rather than an oversight.
 *
 * **No employment fact.** No employee number, no employment status, no contracted hours, no manager
 * and no person. A consumer asking whether somebody is employed is asking Employment, as at a date
 * (ADR-0051).
 *
 * **No money.** Not a rate, not a multiplier, not an amount. `overtimeCandidateMinutes` is a
 * candidate, and the word is load-bearing: what worked time is worth is Compensation's and
 * Payroll's (ADR-0054).
 */

export interface TimeEventView {
  readonly eventId: string;
  readonly employmentId: string;
  readonly kind: EventKind;
  readonly source: EventSource;
  readonly occurredAt: Date;
  /** Kept apart from `occurredAt` even when equal. A client's claim is not a fact. */
  readonly reportedAt: Date;
  readonly receivedAt: Date;
  readonly clockSkewSeconds: number;
  readonly capturedOffline: boolean;
  readonly zone: string;
  readonly attendanceDate: string;
  readonly supersedesEventId?: string;
  readonly deviceReference?: string;
  /**
   * Punch location evidence, present only where a tenant enabled capture and only to a caller
   * holding `attendance.event.read`. It is not an authoritative work location, there is no geofence
   * verdict beside it, and no sequence of these exists anywhere (ADR-0055).
   */
  readonly latitude?: number;
  readonly longitude?: number;
  readonly locationAccuracyMetres?: number;
  readonly note?: string;
}

export interface AttendanceDayView {
  readonly attendanceDayId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly zone: string;
  readonly dayKind: DayKind;
  readonly state: DayState;
  readonly expectedStartAt?: Date;
  readonly expectedEndAt?: Date;
  readonly expectedMinutes: number;
  readonly firstInAt?: Date;
  readonly lastOutAt?: Date;
  readonly workedMinutes: number;
  readonly breakMinutesTaken: number;
  readonly paidBreakMinutes: number;
  readonly regularCandidateMinutes: number;
  readonly overtimeCandidateMinutes: number;
  readonly unpaidMinutes: number;
  readonly absenceMinutes: number;
  /** `unknown` means Leave cannot yet be asked. It is not `none` (ADR-0056). */
  readonly leaveState: LeaveState;
  readonly leaveMinutes: number;
  readonly approvedAt?: Date;
  readonly approvedBy?: string;
  readonly lockedAt?: Date;
  /** Reserved for Workflow (Phase 16). Null today; a consumer must not read null as "not approved". */
  readonly approvalReference?: string;
  /** Which algorithm and which inputs produced this. What makes a disputed figure explainable. */
  readonly calculationVersion: number;
  readonly inputsDigest: string;
  readonly calculatedAt?: Date;
  /** Set when an input moved after the last calculation. A figure to recalculate, not to pay. */
  readonly inputsChangedAt?: Date;
  readonly version: number;
}

export interface AttendanceExceptionView {
  readonly exceptionId: string;
  readonly attendanceDayId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly kind: ExceptionKind;
  readonly severity: ExceptionSeverity;
  readonly state: ExceptionState;
  readonly minutes?: number;
  readonly resolutionReasonCode?: string;
  readonly resolvedAt?: Date;
  readonly resolvedBy?: string;
  readonly version: number;
}

export interface AttendanceDaySnapshot {
  readonly day: AttendanceDayView;
  readonly events: readonly TimeEventView[];
  readonly exceptions: readonly AttendanceExceptionView[];
}

export interface ShiftView {
  readonly shiftId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly kind: ShiftKind;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly crossesMidnight: boolean;
  readonly expectedMinutes: number;
  readonly graceInMinutes: number;
  readonly graceOutMinutes: number;
  readonly status: string;
  readonly versionNumber: number;
  readonly publishedBy?: string;
  readonly version: number;
}

export interface ScheduleView {
  readonly scheduleId: string;
  readonly code: string;
  readonly name: BilingualText;
  /** The IANA zone its wall-clock times mean. Required, and the reason no location model is needed. */
  readonly zone: string;
  readonly cycleLengthDays: number;
  readonly cycleAnchorDate: string;
  readonly status: string;
  readonly versionNumber: number;
  readonly version: number;
}

export interface RosterEntryView {
  readonly rosterEntryId: string;
  readonly employmentId: string;
  readonly onDate: string;
  readonly kind: string;
  readonly shiftId?: string;
  readonly reasonCode?: string;
  readonly version: number;
}

export interface CorrectionView {
  readonly correctionId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly kind: CorrectionKind;
  readonly state: CorrectionState;
  readonly targetEventId?: string;
  readonly proposedOccurredAt?: Date;
  readonly reasonCode: string;
  readonly justification: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly decidedBy?: string;
  readonly decidedAt?: Date;
  readonly resultingEventId?: string;
  readonly version: number;
}

/**
 * What Payroll reads, and the only shape it should.
 *
 * Frozen at creation and sequenced: a correction after a freeze produces the next sequence rather
 * than altering this one, so what was paid and what is now true are both still readable.
 *
 * `daysUnapproved` and `blockingExceptions` are on the contract rather than filtered out, so a
 * consumer decides visibly instead of being handed a silently incomplete month.
 */
export interface PayableSnapshotView {
  readonly snapshotId: string;
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
}

export interface ImportBatchView {
  readonly batchId: string;
  readonly source: string;
  readonly sourceLabel?: string;
  readonly submittedAt: Date;
  readonly submittedBy: string;
  readonly rowsSubmitted: number;
  readonly rowsCreated: number;
  readonly rowsSkipped: number;
  readonly rowsFailed: number;
}

/** Counts for the daily screen, computed by the database rather than by loading rows. */
export interface AttendanceDashboardView {
  readonly onDate: string;
  readonly expected: number;
  readonly present: number;
  readonly absencePendingExplanation: number;
  readonly late: number;
  readonly openExceptions: number;
  readonly awaitingRecalculation: number;
}
