import { definedOnly } from '../domain/attendance-aggregate.js';
import type { AttendanceDayState, DayExceptionState } from '../domain/attendance-day-state.js';
import type { CorrectionRequestState } from '../domain/correction.js';
import type { RosterEntryState } from '../domain/roster-entry.js';
import type { ScheduleState } from '../domain/schedule.js';
import type { ShiftState } from '../domain/shift.js';
import type { TimeEventState } from '../domain/time-event.js';
import type {
  AttendanceDayView,
  AttendanceExceptionView,
  CorrectionView,
  ImportBatchView,
  PayableSnapshotView,
  RosterEntryView,
  ScheduleView,
  ShiftView,
  TimeEventView,
} from '../contracts/views.js';

import type { ImportBatchState, SnapshotState } from './attendance-ports.js';

/**
 * State to contract, in one place.
 *
 * Written here rather than in each query so a field cannot be published from one read and withheld
 * from another — which is how a location coordinate ends up on a screen nobody scoped it for.
 *
 * **`timeEventView` is the one to read carefully.** It is the only view carrying a device
 * identifier or a coordinate, it is reachable only behind `attendance.event.read`, and the day view
 * beside it deliberately carries neither.
 */

export const timeEventView = (state: TimeEventState): TimeEventView => ({
  eventId: state.id,
  employmentId: state.employmentId,
  kind: state.kind,
  source: state.source,
  occurredAt: state.occurredAt,
  reportedAt: state.reportedAt,
  receivedAt: state.receivedAt,
  clockSkewSeconds: state.clockSkewSeconds,
  capturedOffline: state.capturedOffline,
  zone: state.zone,
  attendanceDate: state.attendanceDate,
  ...(state.supersedesEventId === undefined ? {} : { supersedesEventId: state.supersedesEventId }),
  ...(state.deviceReference === undefined ? {} : { deviceReference: state.deviceReference }),
  ...(state.latitude === undefined ? {} : { latitude: state.latitude }),
  ...(state.longitude === undefined ? {} : { longitude: state.longitude }),
  ...(state.locationAccuracyMetres === undefined
    ? {}
    : { locationAccuracyMetres: state.locationAccuracyMetres }),
  ...(state.note === undefined ? {} : { note: state.note }),
});

const optionalInstants = (
  state: AttendanceDayState,
): Partial<
  Pick<
    AttendanceDayView,
    | 'expectedStartAt'
    | 'expectedEndAt'
    | 'firstInAt'
    | 'lastOutAt'
    | 'approvedAt'
    | 'approvedBy'
    | 'lockedAt'
    | 'calculatedAt'
    | 'inputsChangedAt'
    | 'approvalReference'
  >
> =>
  definedOnly({
    expectedStartAt: state.expectedStartAt,
    expectedEndAt: state.expectedEndAt,
    firstInAt: state.firstInAt,
    lastOutAt: state.lastOutAt,
    approvedAt: state.approvedAt,
    approvedBy: state.approvedBy,
    lockedAt: state.lockedAt,
    calculatedAt: state.calculatedAt,
    inputsChangedAt: state.inputsChangedAt,
    approvalReference: state.approvalReference,
  });

export const attendanceDayView = (state: AttendanceDayState): AttendanceDayView => ({
  attendanceDayId: state.id,
  employmentId: state.employmentId,
  attendanceDate: state.attendanceDate,
  zone: state.zone,
  dayKind: state.dayKind,
  state: state.state,
  expectedMinutes: state.expectedMinutes,
  workedMinutes: state.workedMinutes,
  breakMinutesTaken: state.breakMinutesTaken,
  paidBreakMinutes: state.paidBreakMinutes,
  regularCandidateMinutes: state.regularCandidateMinutes,
  overtimeCandidateMinutes: state.overtimeCandidateMinutes,
  unpaidMinutes: state.unpaidMinutes,
  absenceMinutes: state.absenceMinutes,
  leaveState: state.leaveState,
  leaveMinutes: state.leaveMinutes,
  calculationVersion: state.calculationVersion,
  inputsDigest: state.inputsDigest,
  ...optionalInstants(state),
  version: state.version,
});

export const exceptionView = (state: DayExceptionState): AttendanceExceptionView => ({
  exceptionId: state.id,
  attendanceDayId: state.attendanceDayId,
  employmentId: state.employmentId,
  attendanceDate: state.attendanceDate,
  kind: state.kind,
  severity: state.severity,
  state: state.state,
  ...(state.minutes === undefined ? {} : { minutes: state.minutes }),
  ...(state.resolutionReasonCode === undefined
    ? {}
    : { resolutionReasonCode: state.resolutionReasonCode }),
  ...(state.resolvedAt === undefined ? {} : { resolvedAt: state.resolvedAt }),
  ...(state.resolvedBy === undefined ? {} : { resolvedBy: state.resolvedBy }),
  version: state.version,
});

export const shiftView = (state: ShiftState): ShiftView => ({
  shiftId: state.id,
  code: state.code,
  name: state.name,
  kind: state.kind,
  startLocal: state.startLocal,
  endLocal: state.endLocal,
  crossesMidnight: state.crossesMidnight,
  expectedMinutes: state.expectedMinutes,
  graceInMinutes: state.graceInMinutes,
  graceOutMinutes: state.graceOutMinutes,
  status: state.status,
  versionNumber: state.versionNumber,
  ...(state.publishedBy === undefined ? {} : { publishedBy: state.publishedBy }),
  version: state.version,
});

export const scheduleView = (state: ScheduleState): ScheduleView => ({
  scheduleId: state.id,
  code: state.code,
  name: state.name,
  zone: state.zone,
  cycleLengthDays: state.cycleLengthDays,
  cycleAnchorDate: state.cycleAnchorDate,
  status: state.status,
  versionNumber: state.versionNumber,
  version: state.version,
});

export const rosterEntryView = (state: RosterEntryState): RosterEntryView => ({
  rosterEntryId: state.id,
  employmentId: state.employmentId,
  onDate: state.onDate,
  kind: state.kind,
  ...(state.shiftId === undefined ? {} : { shiftId: state.shiftId }),
  ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
  version: state.version,
});

export const correctionView = (state: CorrectionRequestState): CorrectionView => ({
  correctionId: state.id,
  employmentId: state.employmentId,
  attendanceDate: state.attendanceDate,
  kind: state.kind,
  state: state.state,
  reasonCode: state.reasonCode,
  justification: state.justification,
  requestedBy: state.requestedBy,
  requestedAt: state.requestedAt,
  ...(state.targetEventId === undefined ? {} : { targetEventId: state.targetEventId }),
  ...(state.proposedOccurredAt === undefined
    ? {}
    : { proposedOccurredAt: state.proposedOccurredAt }),
  ...(state.decidedBy === undefined ? {} : { decidedBy: state.decidedBy }),
  ...(state.decidedAt === undefined ? {} : { decidedAt: state.decidedAt }),
  ...(state.resultingEventId === undefined ? {} : { resultingEventId: state.resultingEventId }),
  version: state.version,
});

export const snapshotView = (state: SnapshotState): PayableSnapshotView => ({
  snapshotId: state.id,
  employmentId: state.employmentId,
  periodStart: state.periodStart,
  periodEnd: state.periodEnd,
  sequence: state.sequence,
  frozenAt: state.frozenAt,
  frozenBy: state.frozenBy,
  workedMinutes: state.workedMinutes,
  regularCandidateMinutes: state.regularCandidateMinutes,
  overtimeCandidateMinutes: state.overtimeCandidateMinutes,
  unpaidMinutes: state.unpaidMinutes,
  absenceMinutes: state.absenceMinutes,
  leaveMinutes: state.leaveMinutes,
  leaveState: state.leaveState,
  daysTotal: state.daysTotal,
  daysApproved: state.daysApproved,
  daysUnapproved: state.daysUnapproved,
  blockingExceptions: state.blockingExceptions,
  calculationVersion: state.calculationVersion,
  inputsDigest: state.inputsDigest,
});

export const importBatchView = (state: ImportBatchState): ImportBatchView => ({
  batchId: state.id,
  source: state.source,
  submittedAt: state.submittedAt,
  submittedBy: state.submittedBy,
  rowsSubmitted: state.rowsSubmitted,
  rowsCreated: state.rowsCreated,
  rowsSkipped: state.rowsSkipped,
  rowsFailed: state.rowsFailed,
  ...(state.sourceLabel === undefined ? {} : { sourceLabel: state.sourceLabel }),
});
