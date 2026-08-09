import type { ApplicationState } from '../domain/application.js';
import type { ApplicationEventState } from '../domain/application-event.js';
import type { InterviewFeedbackState, InterviewState } from '../domain/interview.js';
import type { OfferState } from '../domain/offer.js';
import type { Metadata } from '../domain/recruitment-aggregate.js';
import type {
  ApplicationStatus,
  HireState,
  InterviewStatus,
  OfferStatus,
  Recommendation,
  ScreeningOutcome,
} from '../domain/recruitment-vocabulary.js';

import { asVersion, civilDateColumn, type RowValues } from './row-writer.js';

/**
 * Applications, their history, interviews, feedback and offers: rows and mappings.
 *
 * Apart from the repositories for the reason the other mapping file gives — a repository is held to
 * a complexity budget of five, and a mapping with fifteen optional columns exceeds it by
 * construction while deciding nothing.
 */

export interface ApplicationRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly application_number: string;
  readonly candidate_id: string;
  readonly vacancy_id: string;
  readonly status: string;
  readonly stage_code: string | null;
  readonly source_code: string;
  readonly applied_on: string;
  readonly screening_outcome: string | null;
  readonly screening_note: string | null;
  readonly rejection_reason_code: string | null;
  readonly hire_state: string | null;
  readonly hire_failure_reason: string | null;
  readonly employment_id: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const APPLICATION_COLUMNS = `a.id, a.tenant_id, a.application_number, a.candidate_id, a.vacancy_id, a.status, a.stage_code, a.source_code, ${civilDateColumn('a.applied_on', 'applied_on')}, a.screening_outcome, a.screening_note, a.rejection_reason_code, a.hire_state, a.hire_failure_reason, a.employment_id, a.metadata, a.version`;

export const toApplication = (row: ApplicationRow): ApplicationState => ({
  id: row.id,
  tenantId: row.tenant_id,
  applicationNumber: row.application_number,
  candidateId: row.candidate_id,
  vacancyId: row.vacancy_id,
  status: row.status as ApplicationStatus,
  ...(row.stage_code === null ? {} : { stageCode: row.stage_code }),
  sourceCode: row.source_code,
  appliedOn: row.applied_on,
  ...(row.screening_outcome === null
    ? {}
    : { screeningOutcome: row.screening_outcome as ScreeningOutcome }),
  ...(row.screening_note === null ? {} : { screeningNote: row.screening_note }),
  ...(row.rejection_reason_code === null ? {} : { rejectionReasonCode: row.rejection_reason_code }),
  ...(row.hire_state === null ? {} : { hireState: row.hire_state as HireState }),
  ...(row.hire_failure_reason === null ? {} : { hireFailureReason: row.hire_failure_reason }),
  ...(row.employment_id === null ? {} : { employmentId: row.employment_id }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

/**
 * `employment_id` is in the update set because the hire writes it after the application exists.
 *
 * What makes it write-once is the aggregate refusing a second, different employment and the partial
 * unique index refusing two applications for one — not the absence of the column here, which would
 * make it unwritable rather than immutable.
 */
const mutableApplication = (state: ApplicationState): RowValues => ({
  status: state.status,
  stage_code: state.stageCode ?? null,
  source_code: state.sourceCode,
  applied_on: state.appliedOn,
  screening_outcome: state.screeningOutcome ?? null,
  screening_note: state.screeningNote ?? null,
  rejection_reason_code: state.rejectionReasonCode ?? null,
  hire_state: state.hireState ?? null,
  hire_failure_reason: state.hireFailureReason ?? null,
  employment_id: state.employmentId ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const applicationInsert = (state: ApplicationState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  application_number: state.applicationNumber,
  candidate_id: state.candidateId,
  vacancy_id: state.vacancyId,
  ...mutableApplication(state),
});

export const applicationUpdate = (state: ApplicationState): RowValues => mutableApplication(state);

export interface ApplicationEventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly application_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly stage_code: string | null;
  readonly reason_code: string | null;
  readonly note: string | null;
  readonly occurred_at: Date;
  readonly recorded_by: string;
  readonly version: number | string;
}

export const APPLICATION_EVENT_COLUMNS =
  'id, tenant_id, application_id, from_status, to_status, stage_code, reason_code, note, occurred_at, recorded_by, version';

export const toApplicationEvent = (row: ApplicationEventRow): ApplicationEventState => ({
  id: row.id,
  tenantId: row.tenant_id,
  applicationId: row.application_id,
  ...(row.from_status === null ? {} : { fromStatus: row.from_status as ApplicationStatus }),
  toStatus: row.to_status as ApplicationStatus,
  ...(row.stage_code === null ? {} : { stageCode: row.stage_code }),
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
  ...(row.note === null ? {} : { note: row.note }),
  occurredAt: row.occurred_at,
  recordedBy: row.recorded_by,
  version: asVersion(row.version),
});

/** Appended, never amended: there is no update mapping, so no code path can rewrite a history. */
export const applicationEventInsert = (state: ApplicationEventState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  application_id: state.applicationId,
  from_status: state.fromStatus ?? null,
  to_status: state.toStatus,
  stage_code: state.stageCode ?? null,
  reason_code: state.reasonCode ?? null,
  note: state.note ?? null,
  occurred_at: state.occurredAt,
  recorded_by: state.recordedBy,
});

export interface InterviewRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly application_id: string;
  readonly round_number: number | string;
  readonly stage_code: string | null;
  readonly mode_code: string;
  readonly status: string;
  readonly scheduled_from: Date | null;
  readonly scheduled_to: Date | null;
  readonly location_text: string | null;
  readonly meeting_reference: string | null;
  readonly interviewer_employment_ids: readonly string[];
  readonly cancelled_reason_code: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const INTERVIEW_COLUMNS =
  'i.id, i.tenant_id, i.application_id, i.round_number, i.stage_code, i.mode_code, i.status, i.scheduled_from, i.scheduled_to, i.location_text, i.meeting_reference, i.interviewer_employment_ids, i.cancelled_reason_code, i.metadata, i.version';

export const toInterview = (row: InterviewRow): InterviewState => ({
  id: row.id,
  tenantId: row.tenant_id,
  applicationId: row.application_id,
  roundNumber: Number(row.round_number),
  ...(row.stage_code === null ? {} : { stageCode: row.stage_code }),
  modeCode: row.mode_code,
  status: row.status as InterviewStatus,
  ...(row.scheduled_from === null ? {} : { scheduledFrom: row.scheduled_from }),
  ...(row.scheduled_to === null ? {} : { scheduledTo: row.scheduled_to }),
  ...(row.location_text === null ? {} : { locationText: row.location_text }),
  ...(row.meeting_reference === null ? {} : { meetingReference: row.meeting_reference }),
  interviewerEmploymentIds: row.interviewer_employment_ids,
  ...(row.cancelled_reason_code === null ? {} : { cancelledReasonCode: row.cancelled_reason_code }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

const mutableInterview = (state: InterviewState): RowValues => ({
  stage_code: state.stageCode ?? null,
  mode_code: state.modeCode,
  status: state.status,
  scheduled_from: state.scheduledFrom ?? null,
  scheduled_to: state.scheduledTo ?? null,
  location_text: state.locationText ?? null,
  meeting_reference: state.meetingReference ?? null,
  interviewer_employment_ids: [...state.interviewerEmploymentIds],
  cancelled_reason_code: state.cancelledReasonCode ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const interviewInsert = (state: InterviewState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  application_id: state.applicationId,
  round_number: state.roundNumber,
  ...mutableInterview(state),
});

export const interviewUpdate = (state: InterviewState): RowValues => mutableInterview(state);

export interface FeedbackRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly interview_id: string;
  readonly interviewer_employment_id: string;
  readonly score: number | string | null;
  readonly recommendation: string;
  readonly strengths: string | null;
  readonly concerns: string | null;
  readonly submitted_at: Date;
  readonly version: number | string;
}

export const FEEDBACK_COLUMNS =
  'id, tenant_id, interview_id, interviewer_employment_id, score, recommendation, strengths, concerns, submitted_at, version';

export const toFeedback = (row: FeedbackRow): InterviewFeedbackState => ({
  id: row.id,
  tenantId: row.tenant_id,
  interviewId: row.interview_id,
  interviewerEmploymentId: row.interviewer_employment_id,
  ...(row.score === null ? {} : { score: Number(row.score) }),
  recommendation: row.recommendation as Recommendation,
  ...(row.strengths === null ? {} : { strengths: row.strengths }),
  ...(row.concerns === null ? {} : { concerns: row.concerns }),
  submittedAt: row.submitted_at,
  version: asVersion(row.version),
});

/** Written once and never edited, so there is no update mapping for a recruiter to reach. */
export const feedbackInsert = (state: InterviewFeedbackState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  interview_id: state.interviewId,
  interviewer_employment_id: state.interviewerEmploymentId,
  score: state.score ?? null,
  recommendation: state.recommendation,
  strengths: state.strengths ?? null,
  concerns: state.concerns ?? null,
  submitted_at: state.submittedAt,
});

export interface OfferRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly application_id: string;
  readonly offer_number: string;
  readonly offer_version: number | string;
  readonly status: string;
  readonly proposed_start_date: string;
  readonly expires_on: string | null;
  readonly proposed_position_id: string | null;
  readonly proposed_unit_id: string | null;
  readonly proposed_employment_type_code: string | null;
  readonly proposed_compensation: Metadata;
  readonly currency_code: string | null;
  readonly decision_note: string | null;
  readonly issued_at: Date | null;
  readonly decided_at: Date | null;
  readonly decided_by: string | null;
  readonly document_reference: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const OFFER_COLUMNS = `o.id, o.tenant_id, o.application_id, o.offer_number, o.offer_version, o.status, ${civilDateColumn('o.proposed_start_date', 'proposed_start_date')}, ${civilDateColumn('o.expires_on', 'expires_on')}, o.proposed_position_id, o.proposed_unit_id, o.proposed_employment_type_code, o.proposed_compensation, o.currency_code, o.decision_note, o.issued_at, o.decided_at, o.decided_by, o.document_reference, o.metadata, o.version`;

export const toOffer = (row: OfferRow): OfferState => ({
  id: row.id,
  tenantId: row.tenant_id,
  applicationId: row.application_id,
  offerNumber: row.offer_number,
  offerVersion: Number(row.offer_version),
  status: row.status as OfferStatus,
  proposedStartDate: row.proposed_start_date,
  proposedCompensation: row.proposed_compensation,
  ...proposedTermsOf(row),
  ...decisionOf(row),
  metadata: row.metadata,
  version: asVersion(row.version),
});

/** The nullable halves, split so the mapping stays inside a repository-adjacent budget. */
const proposedTermsOf = (row: OfferRow): Partial<OfferState> => ({
  ...(row.expires_on === null ? {} : { expiresOn: row.expires_on }),
  ...(row.proposed_position_id === null ? {} : { proposedPositionId: row.proposed_position_id }),
  ...(row.proposed_unit_id === null ? {} : { proposedUnitId: row.proposed_unit_id }),
  ...(row.proposed_employment_type_code === null
    ? {}
    : { proposedEmploymentTypeCode: row.proposed_employment_type_code }),
  ...(row.currency_code === null ? {} : { currencyCode: row.currency_code }),
  ...(row.document_reference === null ? {} : { documentReference: row.document_reference }),
});

const decisionOf = (row: OfferRow): Partial<OfferState> => ({
  ...(row.decision_note === null ? {} : { decisionNote: row.decision_note }),
  ...(row.issued_at === null ? {} : { issuedAt: row.issued_at }),
  ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
  ...(row.decided_by === null ? {} : { decidedBy: row.decided_by }),
});

/**
 * The terms are **not** in the update set.
 *
 * An offer is versioned rather than edited: renegotiating produces version 2 and version 1 survives.
 * What may change on a row is its status and the decision recorded against it, which is why the
 * proposed start date, the compensation and the position are absent here (A-5).
 */
const mutableOffer = (state: OfferState): RowValues => ({
  status: state.status,
  decision_note: state.decisionNote ?? null,
  issued_at: state.issuedAt ?? null,
  decided_at: state.decidedAt ?? null,
  decided_by: state.decidedBy ?? null,
  document_reference: state.documentReference ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const offerInsert = (state: OfferState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  application_id: state.applicationId,
  offer_number: state.offerNumber,
  offer_version: state.offerVersion,
  proposed_start_date: state.proposedStartDate,
  expires_on: state.expiresOn ?? null,
  proposed_position_id: state.proposedPositionId ?? null,
  proposed_unit_id: state.proposedUnitId ?? null,
  proposed_employment_type_code: state.proposedEmploymentTypeCode ?? null,
  proposed_compensation: JSON.stringify(state.proposedCompensation),
  currency_code: state.currencyCode ?? null,
  ...mutableOffer(state),
});

export const offerUpdate = (state: OfferState): RowValues => mutableOffer(state);
