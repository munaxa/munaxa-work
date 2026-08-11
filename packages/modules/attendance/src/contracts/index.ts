/**
 * The public contract of Attendance.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories,
 * its tables and its aggregates are private and stay private.
 *
 * Four absences carry more weight than anything present.
 *
 * **No employment fact.** No employee number, no employment status, no contracted hours, no manager
 * and no person. A consumer asking whether somebody is employed is asking Employment, as at a date
 * (ADR-0051).
 *
 * **No money.** Not a rate, not a multiplier, not an amount. `overtimeCandidateMinutes` is a
 * candidate and the word is load-bearing: what worked time is worth is Compensation's and
 * Payroll's (ADR-0054).
 *
 * **No work location.** There is no site, no geofence and no verdict. Punch coordinates on
 * `TimeEventView` are evidence a tenant chose to capture, not an authoritative place of work and
 * not a track (ADR-0055).
 *
 * **No leave.** `leaveState` carries `unknown` where Leave cannot be asked, and `unknown` is not
 * `none`. A consumer that reads the two the same way will assert that somebody was absent without
 * leave when nobody could check (ADR-0056).
 *
 * Contracts are versioned. A breaking change to anything exported here requires an ADR.
 */

export type {
  CorrectionKind,
  CorrectionState,
  DayKind,
  DayState,
  DefinitionStatus,
  EventKind,
  EventSource,
  ExceptionKind,
  ExceptionSeverity,
  ExceptionState,
  LeaveState,
  PolicySource,
  RosterKind,
  RoundingMode,
  SegmentKind,
  ShiftKind,
} from '../domain/attendance-vocabulary.js';

/**
 * The state sets themselves, not just their types.
 *
 * A consumer narrowing an untyped string — a request parameter, a row — needs the set, and the
 * alternative is every consumer writing its own copy of the list.
 */
export {
  CORRECTION_KINDS,
  CORRECTION_STATES,
  DAY_KINDS,
  DAY_STATES,
  DAY_TRANSITIONS,
  DEFINITION_STATUSES,
  EVENT_KINDS,
  EVENT_SOURCES,
  EXCEPTION_KINDS,
  EXCEPTION_SEVERITIES,
  EXCEPTION_STATES,
  LEAVE_STATES,
  POLICY_SOURCES,
  ROSTER_KINDS,
  ROUNDING_MODES,
  SEGMENT_KINDS,
  SHIFT_KINDS,
  isExpectedToWork,
  isOpeningEvent,
} from '../domain/attendance-vocabulary.js';

export type {
  AttendanceDashboardView,
  AttendanceDaySnapshot,
  AttendanceDayView,
  AttendanceExceptionView,
  CorrectionView,
  ImportBatchView,
  PayableSnapshotView,
  RosterEntryView,
  ScheduleView,
  ShiftView,
  TimeEventView,
} from './views.js';
