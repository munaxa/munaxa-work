import type { BilingualText, Metadata } from '../domain/attendance-aggregate.js';
import type { CorrectionRequestState } from '../domain/correction.js';
import type { PolicyState } from '../domain/attendance-policy.js';
import type {
  CorrectionKind,
  CorrectionState,
  DefinitionStatus,
  EventKind,
  PolicySource,
  RoundingMode,
} from '../domain/attendance-vocabulary.js';
import type { ImportBatchState, SnapshotState } from '../application/attendance-ports.js';

import { asVersion, civilDateColumn, orNull, type RowValues } from './row-writer.js';

/**
 * Policies, corrections, payable snapshots and import batches.
 *
 * **The snapshot has no update mapping.** It is what Payroll read, and a correction after a freeze
 * produces the *next* sequence rather than altering the row somebody already paid from — which is
 * the only way "what was paid" and "what is now true" can both stay readable (ADR-0054).
 *
 * **A correction's `requested_by` is not in its update set.** Who asked is fixed at the request, and
 * the database refuses a decision by that person with a check constraint. A column the application
 * could rewrite would make that constraint bypassable by anybody who could call the update.
 */

export interface PolicyRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly source: string;
  readonly rounding_minutes: number | string;
  readonly rounding_mode: string;
  readonly late_tolerance_minutes: number | string;
  readonly early_departure_tolerance_minutes: number | string;
  readonly duplicate_window_seconds: number | string;
  readonly clock_skew_tolerance_seconds: number | string;
  readonly overtime_threshold_minutes: number | string;
  readonly overtime_requires_approval: boolean;
  readonly absence_blocks_approval: boolean;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly version_number: number | string;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const POLICY_COLUMNS = `p.id, p.tenant_id, p.code, p.name, p.source, p.rounding_minutes,
  p.rounding_mode, p.late_tolerance_minutes, p.early_departure_tolerance_minutes,
  p.duplicate_window_seconds, p.clock_skew_tolerance_seconds, p.overtime_threshold_minutes,
  p.overtime_requires_approval, p.absence_blocks_approval, p.status,
  ${civilDateColumn('p.effective_from', 'effective_from')},
  ${civilDateColumn('p.effective_to', 'effective_to')}, p.version_number, p.published_at,
  p.published_by, p.metadata, p.version`;

/** Every tolerance the tenant configured. None of them ships with a value (00B). */
const tolerancesOf = (
  row: PolicyRow,
): Pick<
  PolicyState,
  | 'roundingMinutes'
  | 'lateToleranceMinutes'
  | 'earlyDepartureToleranceMinutes'
  | 'duplicateWindowSeconds'
  | 'clockSkewToleranceSeconds'
  | 'overtimeThresholdMinutes'
> => ({
  roundingMinutes: asVersion(row.rounding_minutes),
  lateToleranceMinutes: asVersion(row.late_tolerance_minutes),
  earlyDepartureToleranceMinutes: asVersion(row.early_departure_tolerance_minutes),
  duplicateWindowSeconds: asVersion(row.duplicate_window_seconds),
  clockSkewToleranceSeconds: asVersion(row.clock_skew_tolerance_seconds),
  overtimeThresholdMinutes: asVersion(row.overtime_threshold_minutes),
});

export const toPolicy = (row: PolicyRow): PolicyState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  source: row.source as PolicySource,
  ...tolerancesOf(row),
  roundingMode: row.rounding_mode as RoundingMode,
  overtimeRequiresApproval: row.overtime_requires_approval,
  absenceBlocksApproval: row.absence_blocks_approval,
  status: row.status as DefinitionStatus,
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  versionNumber: asVersion(row.version_number),
  ...(row.published_at === null ? {} : { publishedAt: row.published_at }),
  ...(row.published_by === null ? {} : { publishedBy: row.published_by }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

const mutablePolicy = (state: PolicyState): RowValues => ({
  name: JSON.stringify(state.name),
  source: state.source,
  rounding_minutes: state.roundingMinutes,
  rounding_mode: state.roundingMode,
  late_tolerance_minutes: state.lateToleranceMinutes,
  early_departure_tolerance_minutes: state.earlyDepartureToleranceMinutes,
  duplicate_window_seconds: state.duplicateWindowSeconds,
  clock_skew_tolerance_seconds: state.clockSkewToleranceSeconds,
  overtime_threshold_minutes: state.overtimeThresholdMinutes,
  overtime_requires_approval: state.overtimeRequiresApproval,
  absence_blocks_approval: state.absenceBlocksApproval,
  status: state.status,
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  published_at: orNull(state.publishedAt),
  published_by: orNull(state.publishedBy),
  metadata: JSON.stringify(state.metadata),
});

export const policyInsert = (state: PolicyState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  code: state.code,
  version_number: state.versionNumber,
  ...mutablePolicy(state),
});

export const policyUpdate = (state: PolicyState): RowValues => mutablePolicy(state);

export interface CorrectionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly attendance_date: string;
  readonly kind: string;
  readonly target_event_id: string | null;
  readonly proposed_kind: string | null;
  readonly proposed_occurred_at: Date | null;
  readonly proposed_minutes: number | string | null;
  readonly reason_code: string;
  readonly justification: string;
  readonly state: string;
  readonly requested_by: string;
  readonly requested_at: Date;
  readonly decided_by: string | null;
  readonly decided_at: Date | null;
  readonly decision_note: string | null;
  readonly resulting_event_id: string | null;
  readonly approval_reference: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const CORRECTION_COLUMNS = `n.id, n.tenant_id, n.employment_id,
  ${civilDateColumn('n.attendance_date', 'attendance_date')}, n.kind, n.target_event_id,
  n.proposed_kind, n.proposed_occurred_at, n.proposed_minutes, n.reason_code, n.justification,
  n.state, n.requested_by, n.requested_at, n.decided_by, n.decided_at, n.decision_note,
  n.resulting_event_id, n.approval_reference, n.metadata, n.version`;

const proposalOf = (
  row: CorrectionRow,
): Partial<
  Pick<
    CorrectionRequestState,
    'targetEventId' | 'proposedKind' | 'proposedOccurredAt' | 'proposedMinutes'
  >
> => ({
  ...(row.target_event_id === null ? {} : { targetEventId: row.target_event_id }),
  ...(row.proposed_kind === null ? {} : { proposedKind: row.proposed_kind as EventKind }),
  ...(row.proposed_occurred_at === null ? {} : { proposedOccurredAt: row.proposed_occurred_at }),
  ...(row.proposed_minutes === null ? {} : { proposedMinutes: asVersion(row.proposed_minutes) }),
});

const decisionOf = (
  row: CorrectionRow,
): Partial<
  Pick<
    CorrectionRequestState,
    'decidedBy' | 'decidedAt' | 'decisionNote' | 'resultingEventId' | 'approvalReference'
  >
> => ({
  ...(row.decided_by === null ? {} : { decidedBy: row.decided_by }),
  ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
  ...(row.decision_note === null ? {} : { decisionNote: row.decision_note }),
  ...(row.resulting_event_id === null ? {} : { resultingEventId: row.resulting_event_id }),
  ...(row.approval_reference === null ? {} : { approvalReference: row.approval_reference }),
});

export const toCorrection = (row: CorrectionRow): CorrectionRequestState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  attendanceDate: row.attendance_date,
  kind: row.kind as CorrectionKind,
  ...proposalOf(row),
  reasonCode: row.reason_code,
  justification: row.justification,
  state: row.state as CorrectionState,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  ...decisionOf(row),
  metadata: row.metadata,
  version: asVersion(row.version),
});

export const correctionInsert = (state: CorrectionRequestState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  attendance_date: state.attendanceDate,
  kind: state.kind,
  target_event_id: orNull(state.targetEventId),
  proposed_kind: orNull(state.proposedKind),
  proposed_occurred_at: orNull(state.proposedOccurredAt),
  proposed_minutes: orNull(state.proposedMinutes),
  reason_code: state.reasonCode,
  justification: state.justification,
  state: state.state,
  requested_by: state.requestedBy,
  requested_at: state.requestedAt,
  decided_by: orNull(state.decidedBy),
  decided_at: orNull(state.decidedAt),
  decision_note: orNull(state.decisionNote),
  resulting_event_id: orNull(state.resultingEventId),
  approval_reference: orNull(state.approvalReference),
  metadata: JSON.stringify(state.metadata),
});

/** What a decision may change, and nothing about what was asked for or by whom. */
export const correctionUpdate = (state: CorrectionRequestState): RowValues => ({
  state: state.state,
  decided_by: orNull(state.decidedBy),
  decided_at: orNull(state.decidedAt),
  decision_note: orNull(state.decisionNote),
  resulting_event_id: orNull(state.resultingEventId),
  approval_reference: orNull(state.approvalReference),
  metadata: JSON.stringify(state.metadata),
});

export interface SnapshotRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly sequence: number | string;
  readonly frozen_at: Date;
  readonly frozen_by: string;
  readonly worked_minutes: number | string;
  readonly regular_candidate_minutes: number | string;
  readonly overtime_candidate_minutes: number | string;
  readonly unpaid_minutes: number | string;
  readonly absence_minutes: number | string;
  readonly leave_minutes: number | string;
  readonly leave_state: string;
  readonly days_total: number | string;
  readonly days_approved: number | string;
  readonly days_unapproved: number | string;
  readonly blocking_exceptions: number | string;
  readonly calculation_version: number | string;
  readonly inputs_digest: string;
  readonly version: number | string;
}

export const SNAPSHOT_COLUMNS = `t.id, t.tenant_id, t.employment_id,
  ${civilDateColumn('t.period_start', 'period_start')},
  ${civilDateColumn('t.period_end', 'period_end')}, t.sequence, t.frozen_at, t.frozen_by,
  t.worked_minutes, t.regular_candidate_minutes, t.overtime_candidate_minutes, t.unpaid_minutes,
  t.absence_minutes, t.leave_minutes, t.leave_state, t.days_total, t.days_approved,
  t.days_unapproved, t.blocking_exceptions, t.calculation_version, t.inputs_digest, t.version`;

/** The counts a consumer needs in order to decide visibly rather than be handed a partial month. */
const completenessOf = (
  row: SnapshotRow,
): Pick<SnapshotState, 'daysTotal' | 'daysApproved' | 'daysUnapproved' | 'blockingExceptions'> => ({
  daysTotal: asVersion(row.days_total),
  daysApproved: asVersion(row.days_approved),
  daysUnapproved: asVersion(row.days_unapproved),
  blockingExceptions: asVersion(row.blocking_exceptions),
});

export const toSnapshot = (row: SnapshotRow): SnapshotState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  sequence: asVersion(row.sequence),
  frozenAt: row.frozen_at,
  frozenBy: row.frozen_by,
  workedMinutes: asVersion(row.worked_minutes),
  regularCandidateMinutes: asVersion(row.regular_candidate_minutes),
  overtimeCandidateMinutes: asVersion(row.overtime_candidate_minutes),
  unpaidMinutes: asVersion(row.unpaid_minutes),
  absenceMinutes: asVersion(row.absence_minutes),
  leaveMinutes: asVersion(row.leave_minutes),
  leaveState: row.leave_state,
  ...completenessOf(row),
  calculationVersion: asVersion(row.calculation_version),
  inputsDigest: row.inputs_digest,
  version: asVersion(row.version),
});

export const snapshotInsert = (state: SnapshotState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  period_start: state.periodStart,
  period_end: state.periodEnd,
  sequence: state.sequence,
  frozen_at: state.frozenAt,
  frozen_by: state.frozenBy,
  worked_minutes: state.workedMinutes,
  regular_candidate_minutes: state.regularCandidateMinutes,
  overtime_candidate_minutes: state.overtimeCandidateMinutes,
  unpaid_minutes: state.unpaidMinutes,
  absence_minutes: state.absenceMinutes,
  leave_minutes: state.leaveMinutes,
  leave_state: state.leaveState,
  days_total: state.daysTotal,
  days_approved: state.daysApproved,
  days_unapproved: state.daysUnapproved,
  blocking_exceptions: state.blockingExceptions,
  calculation_version: state.calculationVersion,
  inputs_digest: state.inputsDigest,
});

export interface ImportBatchRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly source: string;
  readonly source_label: string | null;
  readonly submitted_at: Date;
  readonly submitted_by: string;
  readonly rows_submitted: number | string;
  readonly rows_created: number | string;
  readonly rows_skipped: number | string;
  readonly rows_failed: number | string;
  readonly version: number | string;
}

export const IMPORT_COLUMNS = `b.id, b.tenant_id, b.source, b.source_label, b.submitted_at,
  b.submitted_by, b.rows_submitted, b.rows_created, b.rows_skipped, b.rows_failed, b.version`;

export const toImportBatch = (row: ImportBatchRow): ImportBatchState => ({
  id: row.id,
  tenantId: row.tenant_id,
  source: row.source,
  ...(row.source_label === null ? {} : { sourceLabel: row.source_label }),
  submittedAt: row.submitted_at,
  submittedBy: row.submitted_by,
  rowsSubmitted: asVersion(row.rows_submitted),
  rowsCreated: asVersion(row.rows_created),
  rowsSkipped: asVersion(row.rows_skipped),
  rowsFailed: asVersion(row.rows_failed),
  version: asVersion(row.version),
});

const mutableBatch = (state: ImportBatchState): RowValues => ({
  rows_submitted: state.rowsSubmitted,
  rows_created: state.rowsCreated,
  rows_skipped: state.rowsSkipped,
  rows_failed: state.rowsFailed,
});

export const importBatchInsert = (state: ImportBatchState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  source: state.source,
  source_label: orNull(state.sourceLabel),
  submitted_at: state.submittedAt,
  submitted_by: state.submittedBy,
  ...mutableBatch(state),
});

export const importBatchUpdate = (state: ImportBatchState): RowValues => mutableBatch(state);
