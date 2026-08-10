import type { Metadata } from '../domain/compensation-aggregate.js';
import type { ApprovalDecisionState } from '../domain/approval.js';
import type { CompensationChangeState, StateSnapshot } from '../domain/change-log.js';
import type { ImportBatchState } from '../domain/import-batch.js';
import type {
  ChangeKind,
  CompensationSource,
  Decision,
  ImportSource,
  SubjectKind,
} from '../domain/compensation-vocabulary.js';

import { asNumber, civilDateColumn, orNull, orUndefined, type RowValues } from './row-writer.js';

/**
 * Row shapes and mappers for the three tables that are the audit: the approval decisions, the
 * append-only history and the import batches.
 *
 * Apart from `record-rows.ts` because those hold *what somebody is paid* and these hold *what
 * happened to it*, and because one mapper file for seven tables ran past its budget — the split the
 * budget exists to force.
 */

export interface DecisionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly sequence: number;
  readonly decision: string;
  readonly decided_by: string;
  readonly decided_at: Date;
  readonly requested_by: string;
  readonly comment: string | null;
  readonly reverses_decision_id: string | null;
  readonly version: number;
}

export const DECISION_COLUMNS = `d.id, d.tenant_id, d.subject_kind, d.subject_id, d.sequence,
  d.decision, d.decided_by, d.decided_at, d.requested_by, d.comment, d.reverses_decision_id,
  d.version`;

export const toDecision = (row: DecisionRow): ApprovalDecisionState => ({
  id: row.id,
  tenantId: row.tenant_id,
  subjectKind: row.subject_kind as SubjectKind,
  subjectId: row.subject_id,
  sequence: asNumber(row.sequence),
  decision: row.decision as Decision,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  requestedBy: row.requested_by,
  version: asNumber(row.version),
  ...optional('comment', orUndefined(row.comment)),
  ...optional('reversesDecisionId', orUndefined(row.reverses_decision_id)),
});

export const decisionValues = (state: ApprovalDecisionState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  subject_kind: state.subjectKind,
  subject_id: state.subjectId,
  sequence: state.sequence,
  decision: state.decision,
  decided_by: state.decidedBy,
  decided_at: state.decidedAt,
  requested_by: state.requestedBy,
  comment: orNull(state.comment),
  reverses_decision_id: orNull(state.reversesDecisionId),
});

export interface ChangeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly component_id: string | null;
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly change_kind: string;
  readonly previous_state: StateSnapshot | null;
  readonly new_state: StateSnapshot | null;
  readonly effective_from: string | null;
  readonly recorded_at: Date;
  readonly actor: string;
  readonly reason_code: string | null;
  readonly source: string;
  readonly version: number;
}

export const CHANGE_COLUMNS = `h.id, h.tenant_id, h.employment_id, h.component_id, h.subject_kind,
  h.subject_id, h.change_kind, h.previous_state, h.new_state,
  ${civilDateColumn('h.effective_from', 'effective_from')},
  h.recorded_at, h.actor, h.reason_code, h.source, h.version`;

export const toChange = (row: ChangeRow): CompensationChangeState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  subjectKind: row.subject_kind as SubjectKind,
  subjectId: row.subject_id,
  changeKind: row.change_kind as ChangeKind,
  recordedAt: row.recorded_at,
  actor: row.actor,
  source: row.source as CompensationSource,
  version: asNumber(row.version),
  ...optional('componentId', orUndefined(row.component_id)),
  ...optional('previousState', orUndefined(row.previous_state)),
  ...optional('newState', orUndefined(row.new_state)),
  ...optional('effectiveFrom', orUndefined(row.effective_from)),
  ...optional('reasonCode', orUndefined(row.reason_code)),
});

export const changeValues = (state: CompensationChangeState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  component_id: orNull(state.componentId),
  subject_kind: state.subjectKind,
  subject_id: state.subjectId,
  change_kind: state.changeKind,
  previous_state: state.previousState === undefined ? null : JSON.stringify(state.previousState),
  new_state: state.newState === undefined ? null : JSON.stringify(state.newState),
  effective_from: orNull(state.effectiveFrom),
  recorded_at: state.recordedAt,
  actor: state.actor,
  reason_code: orNull(state.reasonCode),
  source: state.source,
});

export interface ImportBatchRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly source: string;
  readonly source_label: string | null;
  readonly submitted_at: Date;
  readonly submitted_by: string;
  readonly rows_submitted: number;
  readonly rows_created: number;
  readonly rows_skipped: number;
  readonly rows_failed: number;
  readonly metadata: Metadata;
  readonly version: number;
}

export const IMPORT_COLUMNS = `b.id, b.tenant_id, b.source, b.source_label, b.submitted_at,
  b.submitted_by, b.rows_submitted, b.rows_created, b.rows_skipped, b.rows_failed,
  b.metadata, b.version`;

export const toImportBatch = (row: ImportBatchRow): ImportBatchState => ({
  id: row.id,
  tenantId: row.tenant_id,
  source: row.source as ImportSource,
  submittedAt: row.submitted_at,
  submittedBy: row.submitted_by,
  rowsSubmitted: asNumber(row.rows_submitted),
  rowsCreated: asNumber(row.rows_created),
  rowsSkipped: asNumber(row.rows_skipped),
  rowsFailed: asNumber(row.rows_failed),
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('sourceLabel', orUndefined(row.source_label)),
});

export const importBatchValues = (state: ImportBatchState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  source: state.source,
  source_label: orNull(state.sourceLabel),
  submitted_at: state.submittedAt,
  submitted_by: state.submittedBy,
  rows_submitted: state.rowsSubmitted,
  rows_created: state.rowsCreated,
  rows_skipped: state.rowsSkipped,
  rows_failed: state.rowsFailed,
  metadata: JSON.stringify(state.metadata),
});

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };
