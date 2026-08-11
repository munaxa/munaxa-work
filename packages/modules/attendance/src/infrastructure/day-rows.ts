import { definedOnly, type Metadata } from '../domain/attendance-aggregate.js';
import type { AttendanceDayState, DayExceptionState } from '../domain/attendance-day-state.js';
import type {
  DayKind,
  DayState,
  ExceptionKind,
  ExceptionSeverity,
  ExceptionState,
  LeaveState,
} from '../domain/attendance-vocabulary.js';

import { asVersion, civilDateColumn, orNull, orUndefined, type RowValues } from './row-writer.js';

/**
 * The derived day and its exceptions, as rows.
 *
 * **`employment_id` and `attendance_date` are absent from the update set.** They are the identity
 * the partial unique index is built on, and a column that could be repointed would move somebody's
 * worked hours onto another person or another date, silently. They are written once, at insert.
 *
 * **The inputs are stored, not referenced.** `schedule_version`, `policy_version`, `shift_id`,
 * `calculation_version` and `inputs_digest` are written on every calculation, which is what makes a
 * recalculation of March reproduce March after somebody edits a schedule in June — and what makes a
 * changed input detectable with no event delivered (ADR-0053).
 */

export interface AttendanceDayRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly attendance_date: string;
  readonly zone: string;
  readonly schedule_id: string | null;
  readonly schedule_version: number | string | null;
  readonly shift_id: string | null;
  readonly roster_entry_id: string | null;
  readonly policy_id: string | null;
  readonly policy_version: number | string | null;
  readonly day_kind: string;
  readonly expected_start_at: Date | null;
  readonly expected_end_at: Date | null;
  readonly expected_minutes: number | string;
  readonly expected_break_minutes: number | string;
  readonly first_in_at: Date | null;
  readonly last_out_at: Date | null;
  readonly worked_minutes: number | string;
  readonly break_minutes_taken: number | string;
  readonly paid_break_minutes: number | string;
  readonly regular_candidate_minutes: number | string;
  readonly overtime_candidate_minutes: number | string;
  readonly unpaid_minutes: number | string;
  readonly absence_minutes: number | string;
  readonly leave_state: string;
  readonly leave_minutes: number | string;
  readonly state: string;
  readonly approved_at: Date | null;
  readonly approved_by: string | null;
  readonly locked_at: Date | null;
  readonly approval_reference: string | null;
  readonly calculation_version: number | string;
  readonly inputs_digest: string;
  readonly calculated_at: Date | null;
  readonly inputs_changed_at: Date | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const DAY_COLUMNS = `d.id, d.tenant_id, d.employment_id,
  ${civilDateColumn('d.attendance_date', 'attendance_date')}, d.zone, d.schedule_id,
  d.schedule_version, d.shift_id, d.roster_entry_id, d.policy_id, d.policy_version, d.day_kind,
  d.expected_start_at, d.expected_end_at, d.expected_minutes, d.expected_break_minutes,
  d.first_in_at, d.last_out_at, d.worked_minutes, d.break_minutes_taken, d.paid_break_minutes,
  d.regular_candidate_minutes, d.overtime_candidate_minutes, d.unpaid_minutes, d.absence_minutes,
  d.leave_state, d.leave_minutes, d.state, d.approved_at, d.approved_by, d.locked_at,
  d.approval_reference, d.calculation_version, d.inputs_digest, d.calculated_at,
  d.inputs_changed_at, d.metadata, d.version`;

/** Which definitions and which versions of them produced this day. */
const inputsOf = (
  row: AttendanceDayRow,
): Partial<
  Pick<
    AttendanceDayState,
    'scheduleId' | 'scheduleVersion' | 'shiftId' | 'rosterEntryId' | 'policyId' | 'policyVersion'
  >
> =>
  definedOnly({
    scheduleId: orUndefined(row.schedule_id),
    scheduleVersion: row.schedule_version === null ? undefined : asVersion(row.schedule_version),
    shiftId: orUndefined(row.shift_id),
    rosterEntryId: orUndefined(row.roster_entry_id),
    policyId: orUndefined(row.policy_id),
    policyVersion: row.policy_version === null ? undefined : asVersion(row.policy_version),
  });

/** The instants: what was expected, what happened, and what has been decided about it since. */
const instantsOf = (
  row: AttendanceDayRow,
): Partial<
  Pick<
    AttendanceDayState,
    | 'expectedStartAt'
    | 'expectedEndAt'
    | 'firstInAt'
    | 'lastOutAt'
    | 'approvedAt'
    | 'approvedBy'
    | 'lockedAt'
    | 'approvalReference'
    | 'calculatedAt'
    | 'inputsChangedAt'
  >
> =>
  definedOnly({
    expectedStartAt: orUndefined(row.expected_start_at),
    expectedEndAt: orUndefined(row.expected_end_at),
    firstInAt: orUndefined(row.first_in_at),
    lastOutAt: orUndefined(row.last_out_at),
    approvedAt: orUndefined(row.approved_at),
    approvedBy: orUndefined(row.approved_by),
    lockedAt: orUndefined(row.locked_at),
    approvalReference: orUndefined(row.approval_reference),
    calculatedAt: orUndefined(row.calculated_at),
    inputsChangedAt: orUndefined(row.inputs_changed_at),
  });

/** The minutes, in the buckets Payroll reads. Not one of them is money (ADR-0054). */
const minutesOf = (
  row: AttendanceDayRow,
): Pick<
  AttendanceDayState,
  | 'expectedMinutes'
  | 'expectedBreakMinutes'
  | 'workedMinutes'
  | 'breakMinutesTaken'
  | 'paidBreakMinutes'
  | 'regularCandidateMinutes'
  | 'overtimeCandidateMinutes'
  | 'unpaidMinutes'
  | 'absenceMinutes'
  | 'leaveMinutes'
> => ({
  expectedMinutes: asVersion(row.expected_minutes),
  expectedBreakMinutes: asVersion(row.expected_break_minutes),
  workedMinutes: asVersion(row.worked_minutes),
  breakMinutesTaken: asVersion(row.break_minutes_taken),
  paidBreakMinutes: asVersion(row.paid_break_minutes),
  regularCandidateMinutes: asVersion(row.regular_candidate_minutes),
  overtimeCandidateMinutes: asVersion(row.overtime_candidate_minutes),
  unpaidMinutes: asVersion(row.unpaid_minutes),
  absenceMinutes: asVersion(row.absence_minutes),
  leaveMinutes: asVersion(row.leave_minutes),
});

export const toDay = (row: AttendanceDayRow): AttendanceDayState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  attendanceDate: row.attendance_date,
  zone: row.zone,
  ...inputsOf(row),
  dayKind: row.day_kind as DayKind,
  ...minutesOf(row),
  ...instantsOf(row),
  leaveState: row.leave_state as LeaveState,
  state: row.state as DayState,
  calculationVersion: asVersion(row.calculation_version),
  inputsDigest: row.inputs_digest,
  metadata: row.metadata,
  version: asVersion(row.version),
});

const mutableDay = (state: AttendanceDayState): RowValues => ({
  zone: state.zone,
  schedule_id: orNull(state.scheduleId),
  schedule_version: orNull(state.scheduleVersion),
  shift_id: orNull(state.shiftId),
  roster_entry_id: orNull(state.rosterEntryId),
  policy_id: orNull(state.policyId),
  policy_version: orNull(state.policyVersion),
  day_kind: state.dayKind,
  expected_start_at: orNull(state.expectedStartAt),
  expected_end_at: orNull(state.expectedEndAt),
  expected_minutes: state.expectedMinutes,
  expected_break_minutes: state.expectedBreakMinutes,
  first_in_at: orNull(state.firstInAt),
  last_out_at: orNull(state.lastOutAt),
  worked_minutes: state.workedMinutes,
  break_minutes_taken: state.breakMinutesTaken,
  paid_break_minutes: state.paidBreakMinutes,
  regular_candidate_minutes: state.regularCandidateMinutes,
  overtime_candidate_minutes: state.overtimeCandidateMinutes,
  unpaid_minutes: state.unpaidMinutes,
  absence_minutes: state.absenceMinutes,
  leave_state: state.leaveState,
  leave_minutes: state.leaveMinutes,
  state: state.state,
  approved_at: orNull(state.approvedAt),
  approved_by: orNull(state.approvedBy),
  locked_at: orNull(state.lockedAt),
  approval_reference: orNull(state.approvalReference),
  calculation_version: state.calculationVersion,
  inputs_digest: state.inputsDigest,
  calculated_at: orNull(state.calculatedAt),
  // Written explicitly rather than omitted: clearing the stale mark is what takes a recalculated
  // day out of the reconciliation queue, and an update that left the column alone would leave it
  // there for ever.
  inputs_changed_at: orNull(state.inputsChangedAt),
  metadata: JSON.stringify(state.metadata),
});

export const dayInsert = (state: AttendanceDayState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  attendance_date: state.attendanceDate,
  ...mutableDay(state),
});

export const dayUpdate = (state: AttendanceDayState): RowValues => mutableDay(state);

export interface ExceptionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly attendance_day_id: string;
  readonly employment_id: string;
  readonly attendance_date: string;
  readonly kind: string;
  readonly severity: string;
  readonly state: string;
  readonly detail: string | null;
  readonly minutes: number | string | null;
  readonly resolution_reason_code: string | null;
  readonly resolved_at: Date | null;
  readonly resolved_by: string | null;
  readonly version: number | string;
}

export const EXCEPTION_COLUMNS = `x.id, x.tenant_id, x.attendance_day_id, x.employment_id,
  ${civilDateColumn('x.attendance_date', 'attendance_date')}, x.kind, x.severity, x.state, x.detail,
  x.minutes, x.resolution_reason_code, x.resolved_at, x.resolved_by, x.version`;

export const toException = (row: ExceptionRow): DayExceptionState => ({
  id: row.id,
  tenantId: row.tenant_id,
  attendanceDayId: row.attendance_day_id,
  employmentId: row.employment_id,
  attendanceDate: row.attendance_date,
  kind: row.kind as ExceptionKind,
  severity: row.severity as ExceptionSeverity,
  state: row.state as ExceptionState,
  ...(row.detail === null ? {} : { detail: row.detail }),
  ...(row.minutes === null ? {} : { minutes: asVersion(row.minutes) }),
  ...(row.resolution_reason_code === null
    ? {}
    : { resolutionReasonCode: row.resolution_reason_code }),
  ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
  ...(row.resolved_by === null ? {} : { resolvedBy: row.resolved_by }),
  version: asVersion(row.version),
});

const mutableException = (state: DayExceptionState): RowValues => ({
  severity: state.severity,
  state: state.state,
  detail: orNull(state.detail),
  minutes: orNull(state.minutes),
  resolution_reason_code: orNull(state.resolutionReasonCode),
  resolved_at: orNull(state.resolvedAt),
  resolved_by: orNull(state.resolvedBy),
});

export const exceptionInsert = (state: DayExceptionState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  attendance_day_id: state.attendanceDayId,
  employment_id: state.employmentId,
  attendance_date: state.attendanceDate,
  kind: state.kind,
  ...mutableException(state),
});

export const exceptionUpdate = (state: DayExceptionState): RowValues => mutableException(state);
