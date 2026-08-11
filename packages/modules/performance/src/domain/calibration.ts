import {
  CALIBRATION_TRANSITIONS,
  isEntityCode,
  permits,
  type CalibrationStatus,
} from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import { withinScale, type RatingScaleBand } from './scoring.js';
import type { LocalizedName } from './rating-scale.js';
import type { ReviewState } from './review.js';

/**
 * A calibration session, and what it decided about one review.
 *
 * **This is the seventh approved scoring decision, and it is the whole of it.** A manual override
 * is a calibration, never an edit. The original calculated score and rating are kept alongside the
 * calibrated ones, with the actor, the moment and the reason. The calibrated value becomes
 * effective on the review; the original remains as immutable history, and the decision row itself
 * is refused any later change by the domain, the application and a database trigger.
 *
 * **A reason is not optional.** A rating changed in a meeting with nothing recorded about why is a
 * rating nobody can defend to the person it belongs to, and the conversation it is meant to support
 * is the one it makes impossible.
 *
 * **Nobody calibrates their own review.** The check cannot live in a check constraint — it needs the
 * subject's employment, which is on another row — so it lives here, and the security suite asserts
 * it at the HTTP edge as well.
 */

const AUTO_APPROVAL = 'system:auto-approval';

export interface CalibrationSessionState {
  readonly calibrationSessionId: string;
  readonly cycleId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly status: CalibrationStatus;
  readonly organizationUnitId?: string;
  readonly scheduledFor?: Date;
  readonly facilitator?: string;
  readonly openedAt?: Date;
  readonly concludedAt?: Date;
  readonly concludedBy?: string;
  readonly version: number;
}

export interface CalibrationDecisionState {
  readonly calibrationDecisionId: string;
  readonly calibrationSessionId: string;
  readonly reviewId: string;
  readonly originalScore?: number;
  readonly originalRatingLevelId?: string;
  readonly calibratedScore: number;
  readonly calibratedRatingLevelId: string;
  readonly reason: string;
  readonly decidedAt: Date;
  readonly decidedBy: string;
  readonly version: number;
}

export interface OpenCalibrationRequest {
  readonly calibrationSessionId: string;
  readonly cycleId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly organizationUnitId?: string;
  readonly scheduledFor?: Date;
  readonly facilitator?: string;
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const scheduleCalibration = (
  request: OpenCalibrationRequest,
): PerformanceResult<CalibrationSessionState> => {
  if (!isEntityCode(request.code)) {
    return refuse('calibration-code-invalid', { code: request.code });
  }

  return accept({
    calibrationSessionId: request.calibrationSessionId,
    cycleId: request.cycleId,
    code: request.code,
    name: request.name,
    status: 'scheduled',
    version: 1,
    ...optional('organizationUnitId', request.organizationUnitId),
    ...optional('scheduledFor', request.scheduledFor),
    ...optional('facilitator', request.facilitator),
  });
};

export const moveCalibration = (
  state: CalibrationSessionState,
  to: CalibrationStatus,
  at: Date,
): PerformanceResult<CalibrationSessionState> => {
  if (!permits(CALIBRATION_TRANSITIONS, state.status, to)) {
    return refuse('calibration-transition-refused', { from: state.status, to });
  }
  if (to === 'in_session') return accept({ ...state, status: to, openedAt: at });

  return accept({ ...state, status: to });
};

export const concludeCalibration = (
  state: CalibrationSessionState,
  concludedBy: string,
  at: Date,
): PerformanceResult<CalibrationSessionState> => {
  if (concludedBy === AUTO_APPROVAL) return refuse('calibration-conclusion-not-human');

  const moved = moveCalibration(state, 'concluded', at);

  if (!moved.ok) return moved;

  return accept({ ...moved.value, concludedAt: at, concludedBy });
};

export interface RecordDecisionRequest {
  readonly calibrationDecisionId: string;
  readonly calibratedScore: number;
  readonly calibratedRatingLevelId: string;
  readonly reason: string;
  readonly decidedAt: Date;
  readonly decidedBy: string;
  /** The employment of the person deciding, so a self-calibration can be refused. */
  readonly decidedByEmploymentId?: string;
}

/**
 * Recording what a session decided about one review.
 *
 * The original is copied onto the decision rather than referenced, for the same reason Payroll
 * snapshots its inputs: what the engine calculated must still read the same after anything else
 * changes, and a pointer to a mutable row is not a record of a past value.
 */
export const recordCalibrationDecision = (
  session: CalibrationSessionState,
  review: ReviewState,
  scale: RatingScaleBand,
  request: RecordDecisionRequest,
): PerformanceResult<CalibrationDecisionState> => {
  const checked = validateDecision(session, review, scale, request);

  if (!checked.ok) return checked;

  return accept({
    calibrationDecisionId: request.calibrationDecisionId,
    calibrationSessionId: session.calibrationSessionId,
    reviewId: review.reviewId,
    calibratedScore: request.calibratedScore,
    calibratedRatingLevelId: request.calibratedRatingLevelId,
    reason: request.reason.trim(),
    decidedAt: request.decidedAt,
    decidedBy: request.decidedBy,
    version: 1,
    ...optional('originalScore', review.calculatedScore),
    ...optional('originalRatingLevelId', review.calculatedRatingLevelId),
  });
};

const validateDecision = (
  session: CalibrationSessionState,
  review: ReviewState,
  scale: RatingScaleBand,
  request: RecordDecisionRequest,
): PerformanceResult<true> => {
  if (session.status !== 'in_session') return refuse('calibration-not-in-session');
  if (session.cycleId !== review.cycleId) return refuse('calibration-review-not-in-cycle');
  if (review.completedAt !== undefined) return refuse('review-already-completed');
  if (review.calculatedScore === undefined) return refuse('review-not-yet-scored');
  if (request.decidedBy === AUTO_APPROVAL) return refuse('calibration-decision-not-human');
  if (request.decidedByEmploymentId === review.employmentId) {
    return refuse('calibration-self-refused');
  }
  if (request.reason.trim().length === 0) return refuse('calibration-decision-needs-reason');
  if (!Number.isInteger(request.calibratedScore)) return refuse('calibration-score-not-whole');
  // A session may move a rating; it may not move it off the scale. The invariant fails rather than
  // clamping, because a clamped rating would be presented as the meeting's decision.
  if (!withinScale(scale, request.calibratedScore)) {
    return refuse('calibration-score-out-of-range', {
      score: String(request.calibratedScore),
      minimum: String(scale.minimumScore),
      maximum: String(scale.maximumScore),
    });
  }

  return accept(true);
};

/**
 * Whether a decision changed anything.
 *
 * A session that confirms the calculated score is a real outcome and is recorded like any other —
 * the record of a rating that was examined and left alone is worth as much as the record of one
 * that moved.
 */
export const changedTheRating = (decision: CalibrationDecisionState): boolean =>
  decision.originalScore !== decision.calibratedScore ||
  decision.originalRatingLevelId !== decision.calibratedRatingLevelId;
