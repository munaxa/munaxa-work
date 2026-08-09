import type { BilingualText, Metadata } from '../domain/attendance-aggregate.js';
import type {
  ScheduleAssignmentState,
  ScheduleDayState,
  ScheduleState,
} from '../domain/schedule.js';
import type { SegmentState, ShiftState } from '../domain/shift.js';
import type { RosterEntryState } from '../domain/roster-entry.js';
import type {
  DefinitionStatus,
  RosterKind,
  SegmentKind,
  ShiftKind,
} from '../domain/attendance-vocabulary.js';

import { asVersion, civilDateColumn, orNull, type RowValues } from './row-writer.js';

/**
 * Shifts, their segments, schedules, the cycle, assignments and roster entries — the definitions
 * somebody is measured against.
 *
 * **`code` and `version_number` are absent from every update set here.** Together they are the
 * identity a published definition is known by and the unique index is built on; a day records which
 * version it used, and a version number that could be repointed would make that record a lie. A new
 * version is a new row.
 */

export interface ShiftRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly kind: string;
  readonly start_local: string;
  readonly end_local: string;
  readonly crosses_midnight: boolean;
  readonly flex_window_minutes: number | string | null;
  readonly core_start_local: string | null;
  readonly core_end_local: string | null;
  readonly grace_in_minutes: number | string;
  readonly grace_out_minutes: number | string;
  readonly expected_minutes: number | string;
  readonly status: string;
  readonly version_number: number | string;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const SHIFT_COLUMNS = `s.id, s.tenant_id, s.code, s.name, s.kind, s.start_local, s.end_local,
  s.crosses_midnight, s.flex_window_minutes, s.core_start_local, s.core_end_local,
  s.grace_in_minutes, s.grace_out_minutes, s.expected_minutes, s.status, s.version_number,
  s.published_at, s.published_by, s.metadata, s.version`;

const flexOf = (
  row: ShiftRow,
): Partial<Pick<ShiftState, 'flexWindowMinutes' | 'coreStartLocal' | 'coreEndLocal'>> => ({
  ...(row.flex_window_minutes === null
    ? {}
    : { flexWindowMinutes: asVersion(row.flex_window_minutes) }),
  ...(row.core_start_local === null ? {} : { coreStartLocal: row.core_start_local }),
  ...(row.core_end_local === null ? {} : { coreEndLocal: row.core_end_local }),
});

export const toShift = (row: ShiftRow): ShiftState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  kind: row.kind as ShiftKind,
  startLocal: row.start_local,
  endLocal: row.end_local,
  crossesMidnight: row.crosses_midnight,
  ...flexOf(row),
  graceInMinutes: asVersion(row.grace_in_minutes),
  graceOutMinutes: asVersion(row.grace_out_minutes),
  expectedMinutes: asVersion(row.expected_minutes),
  status: row.status as DefinitionStatus,
  versionNumber: asVersion(row.version_number),
  ...(row.published_at === null ? {} : { publishedAt: row.published_at }),
  ...(row.published_by === null ? {} : { publishedBy: row.published_by }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

const mutableShift = (state: ShiftState): RowValues => ({
  name: JSON.stringify(state.name),
  kind: state.kind,
  start_local: state.startLocal,
  end_local: state.endLocal,
  crosses_midnight: state.crossesMidnight,
  flex_window_minutes: orNull(state.flexWindowMinutes),
  core_start_local: orNull(state.coreStartLocal),
  core_end_local: orNull(state.coreEndLocal),
  grace_in_minutes: state.graceInMinutes,
  grace_out_minutes: state.graceOutMinutes,
  expected_minutes: state.expectedMinutes,
  status: state.status,
  published_at: orNull(state.publishedAt),
  published_by: orNull(state.publishedBy),
  metadata: JSON.stringify(state.metadata),
});

export const shiftInsert = (state: ShiftState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  code: state.code,
  version_number: state.versionNumber,
  ...mutableShift(state),
});

export const shiftUpdate = (state: ShiftState): RowValues => mutableShift(state);

export interface SegmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly shift_id: string;
  readonly sequence: number | string;
  readonly kind: string;
  readonly start_local: string;
  readonly end_local: string;
  readonly paid: boolean;
  readonly version: number | string;
}

export const SEGMENT_COLUMNS =
  'g.id, g.tenant_id, g.shift_id, g.sequence, g.kind, g.start_local, g.end_local, g.paid, g.version';

export const toSegment = (row: SegmentRow): SegmentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  shiftId: row.shift_id,
  sequence: asVersion(row.sequence),
  kind: row.kind as SegmentKind,
  startLocal: row.start_local,
  endLocal: row.end_local,
  paid: row.paid,
  version: asVersion(row.version),
});

/** Segments belong to a draft shift and are frozen with it, so there is no update mapping. */
export const segmentInsert = (state: SegmentState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  shift_id: state.shiftId,
  sequence: state.sequence,
  kind: state.kind,
  start_local: state.startLocal,
  end_local: state.endLocal,
  paid: state.paid,
});

export interface ScheduleRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly zone: string;
  readonly cycle_length_days: number | string;
  readonly cycle_anchor_date: string;
  readonly status: string;
  readonly version_number: number | string;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const SCHEDULE_COLUMNS = `c.id, c.tenant_id, c.code, c.name, c.zone, c.cycle_length_days,
  ${civilDateColumn('c.cycle_anchor_date', 'cycle_anchor_date')}, c.status, c.version_number,
  c.published_at, c.published_by, c.metadata, c.version`;

export const toSchedule = (row: ScheduleRow): ScheduleState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  // Required, and the reason this module needs no work-location model: a schedule's wall-clock
  // times are meaningless without the zone they are meant in (ADR-0055).
  zone: row.zone,
  cycleLengthDays: asVersion(row.cycle_length_days),
  cycleAnchorDate: row.cycle_anchor_date,
  status: row.status as DefinitionStatus,
  versionNumber: asVersion(row.version_number),
  ...(row.published_at === null ? {} : { publishedAt: row.published_at }),
  ...(row.published_by === null ? {} : { publishedBy: row.published_by }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

const mutableSchedule = (state: ScheduleState): RowValues => ({
  name: JSON.stringify(state.name),
  zone: state.zone,
  cycle_length_days: state.cycleLengthDays,
  cycle_anchor_date: state.cycleAnchorDate,
  status: state.status,
  published_at: orNull(state.publishedAt),
  published_by: orNull(state.publishedBy),
  metadata: JSON.stringify(state.metadata),
});

export const scheduleInsert = (state: ScheduleState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  code: state.code,
  version_number: state.versionNumber,
  ...mutableSchedule(state),
});

export const scheduleUpdate = (state: ScheduleState): RowValues => mutableSchedule(state);

export interface ScheduleDayRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly schedule_id: string;
  readonly cycle_position: number | string;
  readonly shift_id: string;
  readonly version: number | string;
}

export const SCHEDULE_DAY_COLUMNS =
  'y.id, y.tenant_id, y.schedule_id, y.cycle_position, y.shift_id, y.version';

export const toScheduleDay = (row: ScheduleDayRow): ScheduleDayState => ({
  id: row.id,
  tenantId: row.tenant_id,
  scheduleId: row.schedule_id,
  cyclePosition: asVersion(row.cycle_position),
  shiftId: row.shift_id,
  version: asVersion(row.version),
});

export const scheduleDayInsert = (state: ScheduleDayState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  schedule_id: state.scheduleId,
  cycle_position: state.cyclePosition,
  shift_id: state.shiftId,
});

export interface AssignmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly schedule_id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly reason_code: string | null;
  readonly version: number | string;
}

export const ASSIGNMENT_COLUMNS = `a.id, a.tenant_id, a.employment_id, a.schedule_id,
  ${civilDateColumn('a.effective_from', 'effective_from')},
  ${civilDateColumn('a.effective_to', 'effective_to')}, a.reason_code, a.version`;

export const toAssignment = (row: AssignmentRow): ScheduleAssignmentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  scheduleId: row.schedule_id,
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
  version: asVersion(row.version),
});

/**
 * Only the end of the period is mutable.
 *
 * `employment_id`, `schedule_id` and `effective_from` are written once: moving the start of an
 * assignment would change what somebody was measured against on a day that has already been
 * calculated and possibly paid.
 */
export const assignmentInsert = (state: ScheduleAssignmentState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  schedule_id: state.scheduleId,
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  reason_code: orNull(state.reasonCode),
});

export const assignmentUpdate = (state: ScheduleAssignmentState): RowValues => ({
  effective_to: orNull(state.effectiveTo),
  reason_code: orNull(state.reasonCode),
});

export interface RosterEntryRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly on_date: string;
  readonly kind: string;
  readonly shift_id: string | null;
  readonly reason_code: string | null;
  readonly note: string | null;
  readonly swap_of_entry_id: string | null;
  readonly version: number | string;
}

export const ROSTER_COLUMNS = `r.id, r.tenant_id, r.employment_id,
  ${civilDateColumn('r.on_date', 'on_date')}, r.kind, r.shift_id, r.reason_code, r.note,
  r.swap_of_entry_id, r.version`;

export const toRosterEntry = (row: RosterEntryRow): RosterEntryState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  onDate: row.on_date,
  kind: row.kind as RosterKind,
  ...(row.shift_id === null ? {} : { shiftId: row.shift_id }),
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
  ...(row.note === null ? {} : { note: row.note }),
  ...(row.swap_of_entry_id === null ? {} : { swapOfEntryId: row.swap_of_entry_id }),
  version: asVersion(row.version),
});

/** Replacing an entry is a soft delete and a new row, so there is no update mapping. */
export const rosterInsert = (state: RosterEntryState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  on_date: state.onDate,
  kind: state.kind,
  shift_id: orNull(state.shiftId),
  reason_code: orNull(state.reasonCode),
  note: orNull(state.note),
  swap_of_entry_id: orNull(state.swapOfEntryId),
});
