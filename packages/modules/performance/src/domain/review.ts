import {
  ASSIGNMENT_TRANSITIONS,
  MULTI_RATER_ROLES,
  REVIEW_TRANSITIONS,
  isReviewerRole,
  permits,
  type AssignmentStatus,
  type ReviewStatus,
  type ReviewerRole,
} from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import { withinScale, type RatingScaleBand, type ScoreOutcome } from './scoring.js';

/**
 * One employment's review within a cycle, and the reviewers asked to assess it.
 *
 * **Enrolment and review are the same thing.** A participant who has no review is not a
 * participant, so there is no separate enrolment record to fall out of step with this one.
 *
 * **The calculated score is never overwritten.** `calculatedScore` is what the scoring engine
 * produced; `finalScore` is what the review is rated at. They are equal unless a calibration
 * session decided otherwise, and in that case the calibration decision holds both values with the
 * actor, the moment and the reason. That is the seventh approved scoring decision, and this
 * aggregate is where it is made structurally impossible to break: there is no operation on this
 * file that writes `calculatedScore` twice.
 *
 * **Completion is a named human's act** (AD-004, and `system:auto-approval` refused here as in five
 * modules before this one), and a completed review is immutable in the domain, in the application
 * and at the table.
 *
 * **360° is a set of reviewer roles rather than a parallel system** (D-2). A peer, a direct report
 * and a skip-level manager are three roles on one review. Every assignment records who was asked,
 * by name, and nothing here claims a response is anonymous — hiding an author from a screen is a
 * presentation choice, and this module makes no guarantee it cannot keep (D-12).
 */

const AUTO_APPROVAL = 'system:auto-approval';

export interface ReviewState {
  readonly reviewId: string;
  readonly cycleId: string;
  readonly employmentId: string;
  readonly managerEmploymentId?: string;
  readonly ratingScaleId: string;
  readonly status: ReviewStatus;
  readonly calculatedScore?: number;
  readonly calculatedRatingLevelId?: string;
  readonly finalScore?: number;
  readonly finalRatingLevelId?: string;
  readonly calibrated: boolean;
  readonly scoredAt?: Date;
  readonly completedAt?: Date;
  readonly completedBy?: string;
  readonly archivedAt?: Date;
  readonly version: number;
}

export interface ReviewerAssignmentState {
  readonly reviewerAssignmentId: string;
  readonly reviewId: string;
  readonly reviewerEmploymentId: string;
  readonly role: ReviewerRole;
  readonly status: AssignmentStatus;
  readonly requestedAt: Date;
  readonly requestedBy: string;
  readonly respondedAt?: Date;
  readonly declineReason?: string;
  readonly version: number;
}

export interface EnrolReviewRequest {
  readonly reviewId: string;
  readonly cycleId: string;
  readonly employmentId: string;
  readonly managerEmploymentId?: string;
  readonly ratingScaleId: string;
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const enrolReview = (request: EnrolReviewRequest): PerformanceResult<ReviewState> => {
  if (request.managerEmploymentId === request.employmentId) {
    // Somebody cannot be their own manager for the purpose of a review, and a reporting line that
    // says so is a data defect this module must not build a self-assessed rating on top of.
    return refuse('review-manager-is-subject');
  }

  return accept({
    reviewId: request.reviewId,
    cycleId: request.cycleId,
    employmentId: request.employmentId,
    ratingScaleId: request.ratingScaleId,
    status: 'pending',
    calibrated: false,
    version: 1,
    ...optional('managerEmploymentId', request.managerEmploymentId),
  });
};

export const moveReview = (
  state: ReviewState,
  to: ReviewStatus,
): PerformanceResult<ReviewState> => {
  if (!permits(REVIEW_TRANSITIONS, state.status, to)) {
    return refuse('review-transition-refused', { from: state.status, to });
  }

  return accept({ ...state, status: to });
};

/**
 * Asking somebody to assess this review.
 *
 * The subject cannot be their own peer, and a manager cannot be assigned as a peer of the person
 * they manage: both would put an opinion into a multi-rater aggregate that the aggregate is meant
 * to be independent of. Only the `self` role may name the subject.
 */
export const assignReviewer = (
  review: ReviewState,
  reviewerAssignmentId: string,
  request: {
    readonly reviewerEmploymentId: string;
    readonly role: string;
    readonly requestedAt: Date;
    readonly requestedBy: string;
  },
): PerformanceResult<ReviewerAssignmentState> => {
  if (!isReviewerRole(request.role)) return refuse('reviewer-role-unknown', { role: request.role });
  if (review.status === 'completed' || review.status === 'archived') {
    return refuse('review-already-completed');
  }

  const isSubject = request.reviewerEmploymentId === review.employmentId;

  if (request.role === 'self' && !isSubject) return refuse('reviewer-self-must-be-subject');
  if (request.role !== 'self' && isSubject) return refuse('reviewer-subject-not-independent');
  if (request.role === 'peer' && request.reviewerEmploymentId === review.managerEmploymentId) {
    return refuse('reviewer-manager-not-peer');
  }

  return accept({
    reviewerAssignmentId,
    reviewId: review.reviewId,
    reviewerEmploymentId: request.reviewerEmploymentId,
    role: request.role,
    status: 'pending',
    requestedAt: request.requestedAt,
    requestedBy: request.requestedBy,
    version: 1,
  });
};

export const moveAssignment = (
  state: ReviewerAssignmentState,
  to: AssignmentStatus,
  at: Date,
  declineReason?: string,
): PerformanceResult<ReviewerAssignmentState> => {
  if (!permits(ASSIGNMENT_TRANSITIONS, state.status, to)) {
    return refuse('reviewer-assignment-transition-refused', { from: state.status, to });
  }
  if (to === 'declined' && (declineReason ?? '').trim().length === 0) {
    return refuse('reviewer-decline-needs-reason');
  }

  return accept({
    ...state,
    status: to,
    respondedAt: at,
    ...optional('declineReason', declineReason?.trim()),
  });
};

/**
 * Whether a multi-rater aggregate may be shown at all.
 *
 * Below the template's minimum, one person's opinion would be presented as the group's. **This is a
 * display rule and not anonymity**: the responses still record their authors, row-level security
 * still sees them, and the audit columns still name them. Withholding an aggregate is the only
 * protection this architecture can actually provide, and calling it anything more would be a claim
 * it cannot keep (D-12).
 */
export const multiRaterAggregateAvailable = (
  responses: readonly { readonly role: ReviewerRole; readonly status: AssignmentStatus }[],
  minimumResponses: number | undefined,
): boolean => {
  if (minimumResponses === undefined) return true;

  const submitted = responses.filter(
    (response) => response.status === 'submitted' && MULTI_RATER_ROLES.includes(response.role),
  );

  return submitted.length >= minimumResponses;
};

/**
 * Recording what the scoring engine produced.
 *
 * The final score starts equal to the calculated one. A calibration decision may move it later; it
 * may never move the calculated score, which is why that is written exactly once and this operation
 * refuses to run twice.
 */
export const recordScore = (
  state: ReviewState,
  outcome: ScoreOutcome,
  at: Date,
): PerformanceResult<ReviewState> => {
  if (state.completedAt !== undefined) return refuse('review-already-completed');
  if (state.calibrated) return refuse('review-already-calibrated');

  return accept({
    ...state,
    calculatedScore: outcome.score,
    calculatedRatingLevelId: outcome.ratingLevelId,
    finalScore: outcome.score,
    finalRatingLevelId: outcome.ratingLevelId,
    scoredAt: at,
  });
};

/**
 * Applying a calibration session's decision.
 *
 * The calibrated value becomes effective and the calculated one is left exactly where it is. The
 * decision itself — original, calibrated, actor, moment, reason — is a separate immutable row, and
 * this operation is refused unless it accompanies one.
 */
export const applyCalibration = (
  state: ReviewState,
  scale: RatingScaleBand,
  decided: { readonly score: number; readonly ratingLevelId: string },
): PerformanceResult<ReviewState> => {
  if (state.completedAt !== undefined) return refuse('review-already-completed');
  if (state.calculatedScore === undefined) return refuse('review-not-yet-scored');
  if (!Number.isInteger(decided.score)) return refuse('review-score-not-whole');
  // The out-of-range invariant, at the one place a score arrives from a human rather than from the
  // engine's arithmetic. It fails; it is never clamped into the scale.
  if (!withinScale(scale, decided.score)) {
    return refuse('review-calibrated-score-out-of-range', { score: String(decided.score) });
  }

  return accept({
    ...state,
    finalScore: decided.score,
    finalRatingLevelId: decided.ratingLevelId,
    calibrated: true,
  });
};

export interface CompleteReviewRequest {
  readonly completedBy: string;
  readonly completedAt: Date;
  readonly calibrationRequired: boolean;
}

/**
 * Completing a review. After this the row is immutable, in three places.
 *
 * A template that requires calibration gets it: completing an uncalibrated review under such a
 * template is refused here, and the reconciliation query looks for any that slipped through by
 * another path.
 */
export const completeReview = (
  state: ReviewState,
  request: CompleteReviewRequest,
): PerformanceResult<ReviewState> => {
  if (request.completedBy === AUTO_APPROVAL) return refuse('review-completion-not-human');
  if (state.finalScore === undefined || state.finalRatingLevelId === undefined) {
    return refuse('review-not-yet-scored');
  }
  if (request.calibrationRequired && !state.calibrated)
    return refuse('review-calibration-required');

  const moved = moveReview(state, 'completed');

  if (!moved.ok) return moved;

  return accept({
    ...moved.value,
    completedAt: request.completedAt,
    completedBy: request.completedBy,
  });
};

export const archiveReview = (state: ReviewState, at: Date): PerformanceResult<ReviewState> => {
  const moved = moveReview(state, 'archived');

  if (!moved.ok) return moved;

  return accept({ ...moved.value, archivedAt: at });
};
