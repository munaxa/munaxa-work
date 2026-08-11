import type { CycleState } from '../domain/cycle.js';
import type { GoalProgressState, GoalState } from '../domain/goal.js';
import type { LocalizedName } from '../domain/rating-scale.js';
import type { ReviewState, ReviewerAssignmentState } from '../domain/review.js';
import type {
  AssignmentStatus,
  CycleKind,
  CycleStatus,
  GoalMeasurement,
  GoalScope,
  GoalStatus,
  ReviewStatus,
  ReviewerRole,
} from '../domain/performance-vocabulary.js';
import { asBigInt, asNumber, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * Goals, cycles, reviews, assessments and the persisted scoring working.
 *
 * **Every score column here is an integer holding hundredths**, and every weight is an integer
 * holding basis points. `asNumber` on an integral column is the only conversion on the path, so
 * there is no rounding step between what the engine computed and what the database holds. The one
 * genuinely large value — a goal progress entry's `observed_value` — is a `bigint` and is parsed
 * with `BigInt` rather than `Number`, because the driver hands `bigint` back as text precisely so
 * that nothing above 2^53 is silently mangled.
 *
 * Civil dates use `to_char(...)` aliases. A goal's `due_date` read as a `Date` at the process's
 * local midnight would report a goal overdue a day early on any server west of UTC.
 */

const civil = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const civilOf = (value: Date): string => value.toISOString().slice(0, 10);

export interface GoalRow {
  readonly id: string;
  readonly goal_category_id: string | null;
  readonly parent_goal_id: string | null;
  readonly cycle_id: string | null;
  readonly scope: string;
  readonly employment_id: string | null;
  readonly organization_unit_id: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly measurement: string;
  readonly target_description: string | null;
  readonly weight_basis_points: number;
  readonly status: string;
  readonly start_date: string;
  readonly due_date: string;
  readonly progress_basis_points: number;
  readonly approved_at: Date | null;
  readonly approved_by: string | null;
  readonly closed_at: Date | null;
  readonly closed_by: string | null;
  readonly final_score: number | null;
  readonly closure_reason: string | null;
  readonly evidence_document_id: string | null;
  readonly version: number;
}

export const goalState = (row: GoalRow): GoalState => ({
  goalId: row.id,
  scope: row.scope as GoalScope,
  title: row.title,
  measurement: row.measurement as GoalMeasurement,
  weightBasisPoints: asNumber(row.weight_basis_points),
  status: row.status as GoalStatus,
  startDate: civil(row.start_date),
  dueDate: civil(row.due_date),
  progressBasisPoints: asNumber(row.progress_basis_points),
  version: asNumber(row.version),
  // `presentOf` drops nulls and nothing else, so a `final_score` of zero survives — a goal closed
  // at the bottom of the scale is a real outcome, not an absent one.
  ...presentOf({
    goalCategoryId: row.goal_category_id,
    parentGoalId: row.parent_goal_id,
    cycleId: row.cycle_id,
    employmentId: row.employment_id,
    organizationUnitId: row.organization_unit_id,
    description: row.description,
    targetDescription: row.target_description,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    finalScore: row.final_score === null ? null : asNumber(row.final_score),
    closureReason: row.closure_reason,
    evidenceDocumentId: row.evidence_document_id,
  }),
});

export const goalValues = (state: GoalState, tenantId: string): RowValues => ({
  id: state.goalId,
  tenant_id: tenantId,
  goal_category_id: orNull(state.goalCategoryId),
  parent_goal_id: orNull(state.parentGoalId),
  cycle_id: orNull(state.cycleId),
  scope: state.scope,
  employment_id: orNull(state.employmentId),
  organization_unit_id: orNull(state.organizationUnitId),
  title: state.title,
  description: orNull(state.description),
  measurement: state.measurement,
  target_description: orNull(state.targetDescription),
  weight_basis_points: state.weightBasisPoints,
  status: state.status,
  start_date: civilOf(state.startDate),
  due_date: civilOf(state.dueDate),
  progress_basis_points: state.progressBasisPoints,
  approved_at: orNull(state.approvedAt),
  approved_by: orNull(state.approvedBy),
  closed_at: orNull(state.closedAt),
  closed_by: orNull(state.closedBy),
  final_score: orNull(state.finalScore),
  closure_reason: orNull(state.closureReason),
  evidence_document_id: orNull(state.evidenceDocumentId),
  metadata: '{}',
});

export interface GoalProgressRow {
  readonly id: string;
  readonly goal_id: string;
  readonly key_result_id: string | null;
  readonly progress_basis_points: number;
  readonly observed_value: string | null;
  readonly note: string | null;
  readonly evidence_document_id: string | null;
  readonly recorded_at: Date;
  readonly recorded_by: string;
  readonly version: number;
}

export const goalProgressState = (row: GoalProgressRow): GoalProgressState => ({
  goalProgressId: row.id,
  goalId: row.goal_id,
  progressBasisPoints: asNumber(row.progress_basis_points),
  recordedAt: row.recorded_at,
  recordedBy: row.recorded_by,
  version: asNumber(row.version),
  ...(row.key_result_id === null ? {} : { keyResultId: row.key_result_id }),
  // `BigInt`, never `Number`: a measurement above 2^53 read as a double is a different number.
  ...(row.observed_value === null ? {} : { observedValue: asBigInt(row.observed_value) }),
  ...(row.note === null ? {} : { note: row.note }),
  ...(row.evidence_document_id === null ? {} : { evidenceDocumentId: row.evidence_document_id }),
});

export const goalProgressValues = (state: GoalProgressState, tenantId: string): RowValues => ({
  id: state.goalProgressId,
  tenant_id: tenantId,
  goal_id: state.goalId,
  key_result_id: orNull(state.keyResultId),
  progress_basis_points: state.progressBasisPoints,
  observed_value: state.observedValue === undefined ? null : String(state.observedValue),
  note: orNull(state.note),
  evidence_document_id: orNull(state.evidenceDocumentId),
  recorded_at: state.recordedAt,
  recorded_by: state.recordedBy,
});

export interface CycleRow {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly review_template_id: string;
  readonly kind: string;
  readonly status: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly self_assessment_due: string | null;
  readonly manager_assessment_due: string | null;
  readonly peer_assessment_due: string | null;
  readonly calibration_due: string | null;
  readonly opened_at: Date | null;
  readonly closed_at: Date | null;
  readonly closed_by: string | null;
  readonly cancelled_at: Date | null;
  readonly cancellation_reason: string | null;
  readonly version: number;
}

const civilOrAbsent = (key: string, value: string | null): Record<string, Date> =>
  value === null ? {} : { [key]: civil(value) };

export const cycleState = (row: CycleRow): CycleState => ({
  cycleId: row.id,
  code: row.code,
  name: row.name,
  reviewTemplateId: row.review_template_id,
  kind: row.kind as CycleKind,
  status: row.status as CycleStatus,
  periodStart: civil(row.period_start),
  periodEnd: civil(row.period_end),
  version: asNumber(row.version),
  ...civilOrAbsent('selfAssessmentDue', row.self_assessment_due),
  ...civilOrAbsent('managerAssessmentDue', row.manager_assessment_due),
  ...civilOrAbsent('peerAssessmentDue', row.peer_assessment_due),
  ...civilOrAbsent('calibrationDue', row.calibration_due),
  ...(row.opened_at === null ? {} : { openedAt: row.opened_at }),
  ...(row.closed_at === null ? {} : { closedAt: row.closed_at }),
  ...(row.closed_by === null ? {} : { closedBy: row.closed_by }),
  ...(row.cancelled_at === null ? {} : { cancelledAt: row.cancelled_at }),
  ...(row.cancellation_reason === null ? {} : { cancellationReason: row.cancellation_reason }),
});

export const cycleValues = (state: CycleState, tenantId: string): RowValues => ({
  id: state.cycleId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  review_template_id: state.reviewTemplateId,
  kind: state.kind,
  status: state.status,
  period_start: civilOf(state.periodStart),
  period_end: civilOf(state.periodEnd),
  self_assessment_due:
    state.selfAssessmentDue === undefined ? null : civilOf(state.selfAssessmentDue),
  manager_assessment_due:
    state.managerAssessmentDue === undefined ? null : civilOf(state.managerAssessmentDue),
  peer_assessment_due:
    state.peerAssessmentDue === undefined ? null : civilOf(state.peerAssessmentDue),
  calibration_due: state.calibrationDue === undefined ? null : civilOf(state.calibrationDue),
  opened_at: orNull(state.openedAt),
  closed_at: orNull(state.closedAt),
  closed_by: orNull(state.closedBy),
  cancelled_at: orNull(state.cancelledAt),
  cancellation_reason: orNull(state.cancellationReason),
  metadata: '{}',
});

export interface ReviewRow {
  readonly id: string;
  readonly cycle_id: string;
  readonly employment_id: string;
  readonly manager_employment_id: string | null;
  readonly rating_scale_id: string;
  readonly status: string;
  readonly calculated_score: number | null;
  readonly calculated_rating_level_id: string | null;
  readonly final_score: number | null;
  readonly final_rating_level_id: string | null;
  readonly calibrated: boolean;
  readonly scored_at: Date | null;
  readonly completed_at: Date | null;
  readonly completed_by: string | null;
  readonly archived_at: Date | null;
  readonly version: number;
}

export const reviewState = (row: ReviewRow): ReviewState => ({
  reviewId: row.id,
  cycleId: row.cycle_id,
  employmentId: row.employment_id,
  ratingScaleId: row.rating_scale_id,
  status: row.status as ReviewStatus,
  calibrated: row.calibrated,
  version: asNumber(row.version),
  ...presentOf({
    managerEmploymentId: row.manager_employment_id,
    calculatedScore: row.calculated_score === null ? null : asNumber(row.calculated_score),
    calculatedRatingLevelId: row.calculated_rating_level_id,
    finalScore: row.final_score === null ? null : asNumber(row.final_score),
    finalRatingLevelId: row.final_rating_level_id,
    scoredAt: row.scored_at,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    archivedAt: row.archived_at,
  }),
});

export const reviewValues = (state: ReviewState, tenantId: string): RowValues => ({
  id: state.reviewId,
  tenant_id: tenantId,
  cycle_id: state.cycleId,
  employment_id: state.employmentId,
  manager_employment_id: orNull(state.managerEmploymentId),
  rating_scale_id: state.ratingScaleId,
  status: state.status,
  calculated_score: orNull(state.calculatedScore),
  calculated_rating_level_id: orNull(state.calculatedRatingLevelId),
  final_score: orNull(state.finalScore),
  final_rating_level_id: orNull(state.finalRatingLevelId),
  calibrated: state.calibrated,
  scored_at: orNull(state.scoredAt),
  completed_at: orNull(state.completedAt),
  completed_by: orNull(state.completedBy),
  archived_at: orNull(state.archivedAt),
  metadata: '{}',
});

export interface ReviewerAssignmentRow {
  readonly id: string;
  readonly review_id: string;
  readonly reviewer_employment_id: string;
  readonly role: string;
  readonly status: string;
  readonly requested_at: Date;
  readonly requested_by: string;
  readonly responded_at: Date | null;
  readonly decline_reason: string | null;
  readonly version: number;
}

export const reviewerAssignmentState = (row: ReviewerAssignmentRow): ReviewerAssignmentState => ({
  reviewerAssignmentId: row.id,
  reviewId: row.review_id,
  reviewerEmploymentId: row.reviewer_employment_id,
  role: row.role as ReviewerRole,
  status: row.status as AssignmentStatus,
  requestedAt: row.requested_at,
  requestedBy: row.requested_by,
  version: asNumber(row.version),
  ...(row.responded_at === null ? {} : { respondedAt: row.responded_at }),
  ...(row.decline_reason === null ? {} : { declineReason: row.decline_reason }),
});

export const reviewerAssignmentValues = (
  state: ReviewerAssignmentState,
  tenantId: string,
): RowValues => ({
  id: state.reviewerAssignmentId,
  tenant_id: tenantId,
  review_id: state.reviewId,
  reviewer_employment_id: state.reviewerEmploymentId,
  role: state.role,
  status: state.status,
  requested_at: state.requestedAt,
  requested_by: state.requestedBy,
  responded_at: orNull(state.respondedAt),
  decline_reason: orNull(state.declineReason),
});

export const goalColumns = (alias = ''): string => {
  const at = alias === '' ? '' : `${alias}.`;

  return `${at}id, ${at}goal_category_id, ${at}parent_goal_id, ${at}cycle_id, ${at}scope,
   ${at}employment_id, ${at}organization_unit_id, ${at}title, ${at}description, ${at}measurement,
   ${at}target_description, ${at}weight_basis_points, ${at}status, ${at}progress_basis_points,
   ${at}approved_at, ${at}approved_by, ${at}closed_at, ${at}closed_by, ${at}final_score,
   ${at}closure_reason, ${at}evidence_document_id, ${at}version,
   to_char(${at}start_date, 'YYYY-MM-DD') as start_date,
   to_char(${at}due_date, 'YYYY-MM-DD') as due_date`;
};

export const GOAL_COLUMNS = goalColumns();

export const CYCLE_COLUMNS = `id, code, name, review_template_id, kind, status, opened_at, closed_at, closed_by,
   cancelled_at, cancellation_reason, version,
   to_char(period_start, 'YYYY-MM-DD') as period_start,
   to_char(period_end, 'YYYY-MM-DD') as period_end,
   to_char(self_assessment_due, 'YYYY-MM-DD') as self_assessment_due,
   to_char(manager_assessment_due, 'YYYY-MM-DD') as manager_assessment_due,
   to_char(peer_assessment_due, 'YYYY-MM-DD') as peer_assessment_due,
   to_char(calibration_due, 'YYYY-MM-DD') as calibration_due`;
