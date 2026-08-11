import type { Metadata } from '../domain/leave-aggregate.js';
import type { BalanceState } from '../domain/balance.js';
import type { AdjustmentState, EntitlementState } from '../domain/entitlement.js';
import type { LedgerEntryState } from '../domain/ledger.js';
import type { AccrualRunState, LeaveYearState } from '../domain/runs.js';
import type { EntitlementSource, LedgerKind, LedgerSource } from '../domain/leave-vocabulary.js';

import { asNumber, asVersion, civilDateColumn, orNull, type RowValues } from './row-writer.js';

/**
 * Row shapes and mappers for the accounting tables.
 *
 * Every minute figure goes through `asNumber`. The driver can return an integer column as a string,
 * and a balance summed from strings is `"480-960"` rather than -480 — a wrong number that looks
 * like arithmetic. This is the one conversion in the module that is worth being pedantic about.
 */

export interface EntitlementRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly leave_type_id: string;
  readonly leave_policy_id: string;
  readonly leave_year_start: string;
  readonly leave_year_end: string;
  readonly granted_minutes: number;
  readonly source: string;
  readonly source_id: string | null;
  readonly reason_code: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const ENTITLEMENT_COLUMNS = `e.id, e.tenant_id, e.employment_id, e.leave_type_id,
  e.leave_policy_id, ${civilDateColumn('e.leave_year_start', 'leave_year_start')},
  ${civilDateColumn('e.leave_year_end', 'leave_year_end')}, e.granted_minutes, e.source,
  e.source_id, e.reason_code, e.metadata, e.version`;

export const toEntitlement = (row: EntitlementRow): EntitlementState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  leaveTypeId: row.leave_type_id,
  leavePolicyId: row.leave_policy_id,
  leaveYearStart: row.leave_year_start,
  leaveYearEnd: row.leave_year_end,
  grantedMinutes: asNumber(row.granted_minutes),
  source: row.source as EntitlementSource,
  metadata: row.metadata,
  version: asVersion(row.version),
  ...(row.source_id === null ? {} : { sourceId: row.source_id }),
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
});

export const entitlementValues = (state: EntitlementState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  leave_type_id: state.leaveTypeId,
  leave_policy_id: state.leavePolicyId,
  leave_year_start: state.leaveYearStart,
  leave_year_end: state.leaveYearEnd,
  granted_minutes: state.grantedMinutes,
  source: state.source,
  source_id: orNull(state.sourceId),
  reason_code: orNull(state.reasonCode),
  metadata: JSON.stringify(state.metadata),
});

export interface LedgerRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly leave_type_id: string;
  readonly leave_year_start: string;
  readonly kind: string;
  readonly minutes: number;
  readonly effective_on: string;
  readonly recorded_at: Date;
  readonly source_kind: string;
  readonly source_id: string;
  readonly reverses_entry_id: string | null;
  readonly leave_policy_id: string | null;
  readonly reason_code: string | null;
  readonly note: string | null;
  readonly balance_before_minutes: number;
  readonly balance_after_minutes: number;
  readonly metadata: Metadata;
  readonly version: number;
}

export const LEDGER_COLUMNS = `l.id, l.tenant_id, l.employment_id, l.leave_type_id,
  ${civilDateColumn('l.leave_year_start', 'leave_year_start')}, l.kind, l.minutes,
  ${civilDateColumn('l.effective_on', 'effective_on')}, l.recorded_at, l.source_kind, l.source_id,
  l.reverses_entry_id, l.leave_policy_id, l.reason_code, l.note, l.balance_before_minutes,
  l.balance_after_minutes, l.metadata, l.version`;

export const toLedgerEntry = (row: LedgerRow): LedgerEntryState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  leaveTypeId: row.leave_type_id,
  leaveYearStart: row.leave_year_start,
  kind: row.kind as LedgerKind,
  minutes: asNumber(row.minutes),
  effectiveOn: row.effective_on,
  recordedAt: row.recorded_at,
  sourceKind: row.source_kind as LedgerSource,
  sourceId: row.source_id,
  balanceBeforeMinutes: asNumber(row.balance_before_minutes),
  balanceAfterMinutes: asNumber(row.balance_after_minutes),
  metadata: row.metadata,
  version: asVersion(row.version),
  ...(row.reverses_entry_id === null ? {} : { reversesEntryId: row.reverses_entry_id }),
  ...(row.leave_policy_id === null ? {} : { leavePolicyId: row.leave_policy_id }),
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
  ...(row.note === null ? {} : { note: row.note }),
});

export const ledgerValues = (state: LedgerEntryState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  leave_type_id: state.leaveTypeId,
  leave_year_start: state.leaveYearStart,
  kind: state.kind,
  minutes: state.minutes,
  effective_on: state.effectiveOn,
  recorded_at: state.recordedAt,
  source_kind: state.sourceKind,
  source_id: state.sourceId,
  reverses_entry_id: orNull(state.reversesEntryId),
  leave_policy_id: orNull(state.leavePolicyId),
  reason_code: orNull(state.reasonCode),
  note: orNull(state.note),
  balance_before_minutes: state.balanceBeforeMinutes,
  balance_after_minutes: state.balanceAfterMinutes,
  metadata: JSON.stringify(state.metadata),
});

export interface BalanceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly leave_type_id: string;
  readonly leave_year_start: string;
  readonly leave_year_end: string;
  readonly opening_minutes: number;
  readonly accrued_minutes: number;
  readonly carried_in_minutes: number;
  readonly consumed_minutes: number;
  readonly adjusted_minutes: number;
  readonly expired_minutes: number;
  readonly carried_out_minutes: number;
  readonly available_minutes: number;
  readonly entries_digest: string;
  readonly entry_count: number;
  readonly calculated_at: Date | null;
  readonly inputs_changed_at: Date | null;
  readonly closed_at: Date | null;
  readonly version: number;
}

export const BALANCE_COLUMNS = `b.id, b.tenant_id, b.employment_id, b.leave_type_id,
  ${civilDateColumn('b.leave_year_start', 'leave_year_start')},
  ${civilDateColumn('b.leave_year_end', 'leave_year_end')}, b.opening_minutes, b.accrued_minutes,
  b.carried_in_minutes, b.consumed_minutes, b.adjusted_minutes, b.expired_minutes,
  b.carried_out_minutes, b.available_minutes, b.entries_digest, b.entry_count, b.calculated_at,
  b.inputs_changed_at, b.closed_at, b.version`;

export const toBalance = (row: BalanceRow): BalanceState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  leaveTypeId: row.leave_type_id,
  leaveYearStart: row.leave_year_start,
  leaveYearEnd: row.leave_year_end,
  openingMinutes: asNumber(row.opening_minutes),
  accruedMinutes: asNumber(row.accrued_minutes),
  carriedInMinutes: asNumber(row.carried_in_minutes),
  consumedMinutes: asNumber(row.consumed_minutes),
  adjustedMinutes: asNumber(row.adjusted_minutes),
  expiredMinutes: asNumber(row.expired_minutes),
  carriedOutMinutes: asNumber(row.carried_out_minutes),
  availableMinutes: asNumber(row.available_minutes),
  entriesDigest: row.entries_digest,
  entryCount: asNumber(row.entry_count),
  version: asVersion(row.version),
  ...(row.calculated_at === null ? {} : { calculatedAt: row.calculated_at }),
  ...(row.inputs_changed_at === null ? {} : { inputsChangedAt: row.inputs_changed_at }),
  ...(row.closed_at === null ? {} : { closedAt: row.closed_at }),
});

export const balanceValues = (state: BalanceState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  leave_type_id: state.leaveTypeId,
  leave_year_start: state.leaveYearStart,
  leave_year_end: state.leaveYearEnd,
  opening_minutes: state.openingMinutes,
  accrued_minutes: state.accruedMinutes,
  carried_in_minutes: state.carriedInMinutes,
  consumed_minutes: state.consumedMinutes,
  adjusted_minutes: state.adjustedMinutes,
  expired_minutes: state.expiredMinutes,
  carried_out_minutes: state.carriedOutMinutes,
  available_minutes: state.availableMinutes,
  entries_digest: state.entriesDigest,
  entry_count: state.entryCount,
  calculated_at: orNull(state.calculatedAt),
  inputs_changed_at: orNull(state.inputsChangedAt),
  closed_at: orNull(state.closedAt),
});

export interface AdjustmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly leave_type_id: string;
  readonly leave_year_start: string;
  readonly minutes: number;
  readonly effective_on: string;
  readonly reason_code: string;
  readonly note: string;
  readonly adjusted_by: string;
  readonly adjusted_at: Date;
  readonly metadata: Metadata;
  readonly version: number;
}

export const ADJUSTMENT_COLUMNS = `j.id, j.tenant_id, j.employment_id, j.leave_type_id,
  ${civilDateColumn('j.leave_year_start', 'leave_year_start')}, j.minutes,
  ${civilDateColumn('j.effective_on', 'effective_on')}, j.reason_code, j.note, j.adjusted_by,
  j.adjusted_at, j.metadata, j.version`;

export const toAdjustment = (row: AdjustmentRow): AdjustmentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  leaveTypeId: row.leave_type_id,
  leaveYearStart: row.leave_year_start,
  minutes: asNumber(row.minutes),
  effectiveOn: row.effective_on,
  reasonCode: row.reason_code,
  note: row.note,
  adjustedBy: row.adjusted_by,
  adjustedAt: row.adjusted_at,
  metadata: row.metadata,
  version: asVersion(row.version),
});

export const adjustmentValues = (state: AdjustmentState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  leave_type_id: state.leaveTypeId,
  leave_year_start: state.leaveYearStart,
  minutes: state.minutes,
  effective_on: state.effectiveOn,
  reason_code: state.reasonCode,
  note: state.note,
  adjusted_by: state.adjustedBy,
  adjusted_at: state.adjustedAt,
  metadata: JSON.stringify(state.metadata),
});

export interface AccrualRunRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly leave_policy_id: string;
  readonly leave_type_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly run_by: string;
  readonly run_at: Date;
  readonly employments_examined: number;
  readonly entries_written: number;
  readonly entries_skipped: number;
  readonly refusals: number;
  readonly metadata: Metadata;
  readonly version: number;
}

export const RUN_COLUMNS = `r.id, r.tenant_id, r.leave_policy_id, r.leave_type_id,
  ${civilDateColumn('r.period_start', 'period_start')},
  ${civilDateColumn('r.period_end', 'period_end')}, r.run_by, r.run_at, r.employments_examined,
  r.entries_written, r.entries_skipped, r.refusals, r.metadata, r.version`;

export const toRun = (row: AccrualRunRow): AccrualRunState => ({
  id: row.id,
  tenantId: row.tenant_id,
  leavePolicyId: row.leave_policy_id,
  leaveTypeId: row.leave_type_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  runBy: row.run_by,
  runAt: row.run_at,
  employmentsExamined: asNumber(row.employments_examined),
  entriesWritten: asNumber(row.entries_written),
  entriesSkipped: asNumber(row.entries_skipped),
  refusals: asNumber(row.refusals),
  metadata: row.metadata,
  version: asVersion(row.version),
});

export const runValues = (state: AccrualRunState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  leave_policy_id: state.leavePolicyId,
  leave_type_id: state.leaveTypeId,
  period_start: state.periodStart,
  period_end: state.periodEnd,
  run_by: state.runBy,
  run_at: state.runAt,
  employments_examined: state.employmentsExamined,
  entries_written: state.entriesWritten,
  entries_skipped: state.entriesSkipped,
  refusals: state.refusals,
  metadata: JSON.stringify(state.metadata),
});

export interface LeaveYearRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly leave_policy_id: string;
  readonly leave_type_id: string;
  readonly leave_year_start: string;
  readonly leave_year_end: string;
  readonly closed_at: Date;
  readonly closed_by: string;
  readonly employments_closed: number;
  readonly carried_out_minutes: number;
  readonly carried_in_minutes: number;
  readonly expired_minutes: number;
  readonly metadata: Metadata;
  readonly version: number;
}

export const LEAVE_YEAR_COLUMNS = `y.id, y.tenant_id, y.leave_policy_id, y.leave_type_id,
  ${civilDateColumn('y.leave_year_start', 'leave_year_start')},
  ${civilDateColumn('y.leave_year_end', 'leave_year_end')}, y.closed_at, y.closed_by,
  y.employments_closed, y.carried_out_minutes, y.carried_in_minutes, y.expired_minutes,
  y.metadata, y.version`;

export const toLeaveYear = (row: LeaveYearRow): LeaveYearState => ({
  id: row.id,
  tenantId: row.tenant_id,
  leavePolicyId: row.leave_policy_id,
  leaveTypeId: row.leave_type_id,
  leaveYearStart: row.leave_year_start,
  leaveYearEnd: row.leave_year_end,
  closedAt: row.closed_at,
  closedBy: row.closed_by,
  employmentsClosed: asNumber(row.employments_closed),
  carriedOutMinutes: asNumber(row.carried_out_minutes),
  carriedInMinutes: asNumber(row.carried_in_minutes),
  expiredMinutes: asNumber(row.expired_minutes),
  metadata: row.metadata,
  version: asVersion(row.version),
});

export const leaveYearValues = (state: LeaveYearState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  leave_policy_id: state.leavePolicyId,
  leave_type_id: state.leaveTypeId,
  leave_year_start: state.leaveYearStart,
  leave_year_end: state.leaveYearEnd,
  closed_at: state.closedAt,
  closed_by: state.closedBy,
  employments_closed: state.employmentsClosed,
  carried_out_minutes: state.carriedOutMinutes,
  carried_in_minutes: state.carriedInMinutes,
  expired_minutes: state.expiredMinutes,
  metadata: JSON.stringify(state.metadata),
});
