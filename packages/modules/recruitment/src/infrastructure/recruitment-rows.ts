import type { CandidateState } from '../domain/candidate.js';
import type { CandidateProfileEntryState } from '../domain/candidate-profile.js';
import type { RequisitionDecisionState, RequisitionState } from '../domain/requisition.js';
import type { VacancyState } from '../domain/vacancy.js';
import type { BilingualText, Metadata } from '../domain/recruitment-aggregate.js';
import type {
  CandidateStatus,
  ProfileEntryKind,
  RequisitionStatus,
  VacancyStatus,
} from '../domain/recruitment-vocabulary.js';

import { asVersion, civilDateColumn, type RowValues } from './row-writer.js';

/**
 * Requisitions, vacancies and candidates: their rows, and the functions that convert them to domain
 * state and back.
 *
 * Apart from the repositories because a repository is held to a tighter complexity budget than the
 * rest of the codebase — five rather than ten — and a mapping with a dozen optional columns exceeds
 * it by construction. The budget exists so that a repository which *needs* branching gets looked at,
 * and the honest answer here is that this is mapping rather than logic: no rule in this file decides
 * anything.
 *
 * Four columns are deliberately absent from every update set, and their absence is the point:
 * `requisition_number`, `candidate_number` and `application_number` are generated once and never
 * reused, and `person_id` is written exactly once — a link that could be repointed would move
 * somebody's career to another human being, silently.
 */

export interface RequisitionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly requisition_number: string;
  readonly status: string;
  readonly position_id: string;
  readonly unit_id: string;
  readonly cost_center_id: string | null;
  readonly headcount_requested: number | string;
  readonly headcount_filled: number | string;
  readonly reason_code: string;
  readonly priority_code: string | null;
  readonly target_start_date: string | null;
  readonly requested_by_employment_id: string;
  readonly hiring_manager_employment_id: string | null;
  readonly approval_id: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const REQUISITION_COLUMNS = `r.id, r.tenant_id, r.requisition_number, r.status, r.position_id, r.unit_id, r.cost_center_id, r.headcount_requested, r.headcount_filled, r.reason_code, r.priority_code, ${civilDateColumn('r.target_start_date', 'target_start_date')}, r.requested_by_employment_id, r.hiring_manager_employment_id, r.approval_id, r.metadata, r.version`;

export const toRequisition = (row: RequisitionRow): RequisitionState => ({
  id: row.id,
  tenantId: row.tenant_id,
  requisitionNumber: row.requisition_number,
  status: row.status as RequisitionStatus,
  positionId: row.position_id,
  unitId: row.unit_id,
  ...(row.cost_center_id === null ? {} : { costCenterId: row.cost_center_id }),
  headcountRequested: Number(row.headcount_requested),
  headcountFilled: Number(row.headcount_filled),
  reasonCode: row.reason_code,
  ...(row.priority_code === null ? {} : { priorityCode: row.priority_code }),
  ...(row.target_start_date === null ? {} : { targetStartDate: row.target_start_date }),
  requestedByEmploymentId: row.requested_by_employment_id,
  ...(row.hiring_manager_employment_id === null
    ? {}
    : { hiringManagerEmploymentId: row.hiring_manager_employment_id }),
  ...(row.approval_id === null ? {} : { approvalId: row.approval_id }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

const mutableRequisition = (state: RequisitionState): RowValues => ({
  status: state.status,
  position_id: state.positionId,
  unit_id: state.unitId,
  cost_center_id: state.costCenterId ?? null,
  headcount_requested: state.headcountRequested,
  headcount_filled: state.headcountFilled,
  reason_code: state.reasonCode,
  priority_code: state.priorityCode ?? null,
  target_start_date: state.targetStartDate ?? null,
  hiring_manager_employment_id: state.hiringManagerEmploymentId ?? null,
  approval_id: state.approvalId ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const requisitionInsert = (state: RequisitionState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  requisition_number: state.requisitionNumber,
  requested_by_employment_id: state.requestedByEmploymentId,
  ...mutableRequisition(state),
});

export const requisitionUpdate = (state: RequisitionState): RowValues => mutableRequisition(state);

export interface DecisionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly requisition_id: string;
  readonly decision: string;
  readonly reason_code: string | null;
  readonly note: string | null;
  readonly decided_by: string;
  readonly decided_at: Date;
  readonly reverses_id: string | null;
  readonly version: number | string;
}

export const DECISION_COLUMNS =
  'id, tenant_id, requisition_id, decision, reason_code, note, decided_by, decided_at, reverses_id, version';

export const toDecision = (row: DecisionRow): RequisitionDecisionState => ({
  id: row.id,
  tenantId: row.tenant_id,
  requisitionId: row.requisition_id,
  decision: row.decision as RequisitionDecisionState['decision'],
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
  ...(row.note === null ? {} : { note: row.note }),
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  ...(row.reverses_id === null ? {} : { reversesId: row.reverses_id }),
  version: asVersion(row.version),
});

/** A decision is appended and never amended, so there is no update mapping to write. */
export const decisionInsert = (state: RequisitionDecisionState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  requisition_id: state.requisitionId,
  decision: state.decision,
  reason_code: state.reasonCode ?? null,
  note: state.note ?? null,
  decided_by: state.decidedBy,
  decided_at: state.decidedAt,
  reverses_id: state.reversesId ?? null,
});

export interface VacancyRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly requisition_id: string;
  readonly title: BilingualText;
  readonly description: BilingualText | null;
  readonly status: string;
  readonly channels: readonly string[];
  readonly opened_on: string | null;
  readonly closes_on: string | null;
  readonly closed_reason_code: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const VACANCY_COLUMNS = `v.id, v.tenant_id, v.requisition_id, v.title, v.description, v.status, v.channels, ${civilDateColumn('v.opened_on', 'opened_on')}, ${civilDateColumn('v.closes_on', 'closes_on')}, v.closed_reason_code, v.metadata, v.version`;

export const toVacancy = (row: VacancyRow): VacancyState => ({
  id: row.id,
  tenantId: row.tenant_id,
  requisitionId: row.requisition_id,
  title: row.title,
  ...(row.description === null ? {} : { description: row.description }),
  status: row.status as VacancyStatus,
  channels: row.channels,
  ...(row.opened_on === null ? {} : { openedOn: row.opened_on }),
  ...(row.closes_on === null ? {} : { closesOn: row.closes_on }),
  ...(row.closed_reason_code === null ? {} : { closedReasonCode: row.closed_reason_code }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

const mutableVacancy = (state: VacancyState): RowValues => ({
  title: JSON.stringify(state.title),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  status: state.status,
  channels: [...state.channels],
  opened_on: state.openedOn ?? null,
  closes_on: state.closesOn ?? null,
  closed_reason_code: state.closedReasonCode ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const vacancyInsert = (state: VacancyState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  requisition_id: state.requisitionId,
  ...mutableVacancy(state),
});

export const vacancyUpdate = (state: VacancyState): RowValues => mutableVacancy(state);

export interface CandidateRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly candidate_number: string;
  readonly status: string;
  readonly display_name: BilingualText;
  readonly email: string;
  readonly phone: string | null;
  readonly display_email: string;
  readonly source_code: string;
  readonly person_id: string | null;
  readonly anonymized_at: Date | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const CANDIDATE_COLUMNS =
  'c.id, c.tenant_id, c.candidate_number, c.status, c.display_name, c.email, c.phone, c.display_email, c.source_code, c.person_id, c.anonymized_at, c.metadata, c.version';

export const toCandidate = (row: CandidateRow): CandidateState => ({
  id: row.id,
  tenantId: row.tenant_id,
  candidateNumber: row.candidate_number,
  status: row.status as CandidateStatus,
  displayName: row.display_name,
  email: row.email,
  ...(row.phone === null ? {} : { phone: row.phone }),
  displayEmail: row.display_email,
  sourceCode: row.source_code,
  ...(row.person_id === null ? {} : { personId: row.person_id }),
  ...(row.anonymized_at === null ? {} : { anonymizedAt: row.anonymized_at }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

/**
 * `person_id` is in the update set, and it is the only write-once column that is.
 *
 * The link is made after the candidate exists, so it has to be updatable; what stops it being
 * *repointed* is the aggregate refusing a second, different person and the unique index refusing two
 * candidates for one person. Enforcing it by omitting the column here would make the link
 * unwritable, not immutable.
 */
const mutableCandidate = (state: CandidateState): RowValues => ({
  status: state.status,
  display_name: JSON.stringify(state.displayName),
  email: state.email,
  phone: state.phone ?? null,
  display_email: state.displayEmail,
  source_code: state.sourceCode,
  person_id: state.personId ?? null,
  anonymized_at: state.anonymizedAt ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const candidateInsert = (state: CandidateState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  candidate_number: state.candidateNumber,
  ...mutableCandidate(state),
});

export const candidateUpdate = (state: CandidateState): RowValues => mutableCandidate(state);

export interface ProfileEntryRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly candidate_id: string;
  readonly kind: string;
  readonly code: string | null;
  readonly title: BilingualText;
  readonly organization_name: BilingualText | null;
  readonly from_date: string | null;
  readonly to_date: string | null;
  readonly level_code: string | null;
  readonly document_reference: string | null;
  readonly withdrawn_at: Date | null;
  readonly version: number | string;
}

export const PROFILE_COLUMNS = `p.id, p.tenant_id, p.candidate_id, p.kind, p.code, p.title, p.organization_name, ${civilDateColumn('p.from_date', 'from_date')}, ${civilDateColumn('p.to_date', 'to_date')}, p.level_code, p.document_reference, p.withdrawn_at, p.version`;

export const toProfileEntry = (row: ProfileEntryRow): CandidateProfileEntryState => ({
  id: row.id,
  tenantId: row.tenant_id,
  candidateId: row.candidate_id,
  kind: row.kind as ProfileEntryKind,
  ...(row.code === null ? {} : { code: row.code }),
  title: row.title,
  ...(row.organization_name === null ? {} : { organizationName: row.organization_name }),
  ...(row.from_date === null ? {} : { fromDate: row.from_date }),
  ...(row.to_date === null ? {} : { toDate: row.to_date }),
  ...(row.level_code === null ? {} : { levelCode: row.level_code }),
  ...(row.document_reference === null ? {} : { documentReference: row.document_reference }),
  ...(row.withdrawn_at === null ? {} : { withdrawnAt: row.withdrawn_at }),
  version: asVersion(row.version),
});

const mutableProfileEntry = (state: CandidateProfileEntryState): RowValues => ({
  kind: state.kind,
  code: state.code ?? null,
  title: JSON.stringify(state.title),
  organization_name:
    state.organizationName === undefined ? null : JSON.stringify(state.organizationName),
  from_date: state.fromDate ?? null,
  to_date: state.toDate ?? null,
  level_code: state.levelCode ?? null,
  document_reference: state.documentReference ?? null,
  withdrawn_at: state.withdrawnAt ?? null,
});

export const profileEntryInsert = (state: CandidateProfileEntryState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  candidate_id: state.candidateId,
  ...mutableProfileEntry(state),
});

export const profileEntryUpdate = (state: CandidateProfileEntryState): RowValues =>
  mutableProfileEntry(state);
