import type { CalibrationDecisionState, CalibrationSessionState } from '../domain/calibration.js';
import type { FeedbackState } from '../domain/feedback.js';
import type { LocalizedName } from '../domain/rating-scale.js';
import type {
  ReviewSnapshotState,
  SnapshotCalculation,
  SnapshotFramework,
  SnapshotGoal,
  SnapshotPlacement,
  SnapshotReviewer,
} from '../domain/review-snapshot.js';
import type { TalentPlacementState } from '../domain/talent-placement.js';
import type {
  CalibrationStatus,
  FeedbackKind,
  FeedbackVisibility,
  TalentBand,
} from '../domain/performance-vocabulary.js';
import type { ComponentOutcome, RatingScaleBand } from '../domain/scoring.js';
import { asNumber, orNull, type RowValues } from './row-writer.js';

/**
 * Calibration decisions, talent placements, feedback and the completion snapshot.
 *
 * **The calibration decision carries both numbers.** `original_score` is what the engine produced
 * and `calibrated_score` is what the meeting settled on; the mapper reads both, and there is no
 * path here that writes one over the other. That is the seventh approved scoring decision expressed
 * where the row meets the code.
 *
 * **The snapshot is stored as the frozen values it holds**, not as references to live rows. A
 * consumer that re-read the current rating scale would see a completed review change when somebody
 * edited configuration, which is the one thing the snapshot exists to prevent — so `rating_scale`,
 * `competency_framework`, `goals`, `component_scores` and `calculation` are each `jsonb` holding
 * what was true at completion.
 */

export interface CalibrationSessionRow {
  readonly id: string;
  readonly cycle_id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly status: string;
  readonly organization_unit_id: string | null;
  readonly scheduled_for: Date | null;
  readonly facilitator: string | null;
  readonly opened_at: Date | null;
  readonly concluded_at: Date | null;
  readonly concluded_by: string | null;
  readonly version: number;
}

export const calibrationSessionState = (row: CalibrationSessionRow): CalibrationSessionState => ({
  calibrationSessionId: row.id,
  cycleId: row.cycle_id,
  code: row.code,
  name: row.name,
  status: row.status as CalibrationStatus,
  version: asNumber(row.version),
  ...(row.organization_unit_id === null ? {} : { organizationUnitId: row.organization_unit_id }),
  ...(row.scheduled_for === null ? {} : { scheduledFor: row.scheduled_for }),
  ...(row.facilitator === null ? {} : { facilitator: row.facilitator }),
  ...(row.opened_at === null ? {} : { openedAt: row.opened_at }),
  ...(row.concluded_at === null ? {} : { concludedAt: row.concluded_at }),
  ...(row.concluded_by === null ? {} : { concludedBy: row.concluded_by }),
});

export const calibrationSessionValues = (
  state: CalibrationSessionState,
  tenantId: string,
): RowValues => ({
  id: state.calibrationSessionId,
  tenant_id: tenantId,
  cycle_id: state.cycleId,
  code: state.code,
  name: JSON.stringify(state.name),
  status: state.status,
  organization_unit_id: orNull(state.organizationUnitId),
  scheduled_for: orNull(state.scheduledFor),
  facilitator: orNull(state.facilitator),
  opened_at: orNull(state.openedAt),
  concluded_at: orNull(state.concludedAt),
  concluded_by: orNull(state.concludedBy),
});

export interface CalibrationDecisionRow {
  readonly id: string;
  readonly calibration_session_id: string;
  readonly review_id: string;
  readonly original_score: number | null;
  readonly original_rating_level_id: string | null;
  readonly calibrated_score: number;
  readonly calibrated_rating_level_id: string;
  readonly reason: string;
  readonly decided_at: Date;
  readonly decided_by: string;
  readonly version: number;
}

export const calibrationDecisionState = (
  row: CalibrationDecisionRow,
): CalibrationDecisionState => ({
  calibrationDecisionId: row.id,
  calibrationSessionId: row.calibration_session_id,
  reviewId: row.review_id,
  calibratedScore: asNumber(row.calibrated_score),
  calibratedRatingLevelId: row.calibrated_rating_level_id,
  reason: row.reason,
  decidedAt: row.decided_at,
  decidedBy: row.decided_by,
  version: asNumber(row.version),
  // Kept, never overwritten: the original is the whole point of the record.
  ...(row.original_score === null ? {} : { originalScore: asNumber(row.original_score) }),
  ...(row.original_rating_level_id === null
    ? {}
    : { originalRatingLevelId: row.original_rating_level_id }),
});

export const calibrationDecisionValues = (
  state: CalibrationDecisionState,
  tenantId: string,
): RowValues => ({
  id: state.calibrationDecisionId,
  tenant_id: tenantId,
  calibration_session_id: state.calibrationSessionId,
  review_id: state.reviewId,
  original_score: orNull(state.originalScore),
  original_rating_level_id: orNull(state.originalRatingLevelId),
  calibrated_score: state.calibratedScore,
  calibrated_rating_level_id: state.calibratedRatingLevelId,
  reason: state.reason,
  decided_at: state.decidedAt,
  decided_by: state.decidedBy,
});

export interface TalentPlacementRow {
  readonly id: string;
  readonly cycle_id: string;
  readonly review_id: string;
  readonly employment_id: string;
  readonly performance_band: number;
  readonly potential_band: number;
  readonly box_code: string;
  readonly rationale: string | null;
  readonly placed_at: Date;
  readonly placed_by: string;
  readonly version: number;
}

export const talentPlacementState = (row: TalentPlacementRow): TalentPlacementState => ({
  talentPlacementId: row.id,
  cycleId: row.cycle_id,
  reviewId: row.review_id,
  employmentId: row.employment_id,
  performanceBand: asNumber(row.performance_band) as TalentBand,
  potentialBand: asNumber(row.potential_band) as TalentBand,
  boxCode: row.box_code,
  placedAt: row.placed_at,
  placedBy: row.placed_by,
  version: asNumber(row.version),
  ...(row.rationale === null ? {} : { rationale: row.rationale }),
});

export const talentPlacementValues = (
  state: TalentPlacementState,
  tenantId: string,
): RowValues => ({
  id: state.talentPlacementId,
  tenant_id: tenantId,
  cycle_id: state.cycleId,
  review_id: state.reviewId,
  employment_id: state.employmentId,
  performance_band: state.performanceBand,
  potential_band: state.potentialBand,
  box_code: state.boxCode,
  rationale: orNull(state.rationale),
  placed_at: state.placedAt,
  placed_by: state.placedBy,
});

export interface FeedbackRow {
  readonly id: string;
  readonly subject_employment_id: string;
  readonly author_employment_id: string;
  readonly kind: string;
  readonly visibility: string;
  readonly body: string;
  readonly related_goal_id: string | null;
  readonly related_review_id: string | null;
  readonly requested_by: string | null;
  readonly given_at: Date;
  readonly version: number;
}

export const feedbackState = (row: FeedbackRow): FeedbackState => ({
  feedbackId: row.id,
  subjectEmploymentId: row.subject_employment_id,
  authorEmploymentId: row.author_employment_id,
  kind: row.kind as FeedbackKind,
  visibility: row.visibility as FeedbackVisibility,
  body: row.body,
  givenAt: row.given_at,
  version: asNumber(row.version),
  ...(row.related_goal_id === null ? {} : { relatedGoalId: row.related_goal_id }),
  ...(row.related_review_id === null ? {} : { relatedReviewId: row.related_review_id }),
  ...(row.requested_by === null ? {} : { requestedBy: row.requested_by }),
});

export const feedbackValues = (state: FeedbackState, tenantId: string): RowValues => ({
  id: state.feedbackId,
  tenant_id: tenantId,
  subject_employment_id: state.subjectEmploymentId,
  author_employment_id: state.authorEmploymentId,
  kind: state.kind,
  visibility: state.visibility,
  body: state.body,
  related_goal_id: orNull(state.relatedGoalId),
  related_review_id: orNull(state.relatedReviewId),
  requested_by: orNull(state.requestedBy),
  given_at: state.givenAt,
});

export interface SnapshotRow {
  readonly id: string;
  readonly review_id: string;
  readonly manager_employment_id: string | null;
  readonly reviewers: readonly SnapshotReviewer[];
  readonly placement: SnapshotPlacement;
  readonly rating_scale: RatingScaleBand;
  readonly competency_framework: SnapshotFramework | null;
  readonly goals: readonly SnapshotGoal[];
  readonly component_scores: readonly ComponentOutcome[];
  readonly calculation: SnapshotCalculation;
  readonly taken_at: Date;
  readonly taken_by: string;
  readonly version: number;
}

export const snapshotState = (row: SnapshotRow): ReviewSnapshotState => ({
  reviewSnapshotId: row.id,
  reviewId: row.review_id,
  reviewers: row.reviewers,
  placement: row.placement,
  ratingScale: row.rating_scale,
  goals: row.goals,
  componentScores: row.component_scores,
  calculation: row.calculation,
  takenAt: row.taken_at,
  takenBy: row.taken_by,
  version: asNumber(row.version),
  ...(row.manager_employment_id === null ? {} : { managerEmploymentId: row.manager_employment_id }),
  ...(row.competency_framework === null ? {} : { competencyFramework: row.competency_framework }),
});

export const snapshotValues = (state: ReviewSnapshotState, tenantId: string): RowValues => ({
  id: state.reviewSnapshotId,
  tenant_id: tenantId,
  review_id: state.reviewId,
  manager_employment_id: orNull(state.managerEmploymentId),
  reviewers: JSON.stringify(state.reviewers),
  placement: JSON.stringify(state.placement),
  rating_scale: JSON.stringify(state.ratingScale),
  competency_framework:
    state.competencyFramework === undefined ? null : JSON.stringify(state.competencyFramework),
  goals: JSON.stringify(state.goals),
  component_scores: JSON.stringify(state.componentScores),
  calculation: JSON.stringify(state.calculation),
  taken_at: state.takenAt,
  taken_by: state.takenBy,
});
