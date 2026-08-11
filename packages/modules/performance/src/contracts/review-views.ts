import type { BasisPoints, LocalizedTextView, ScoreHundredths } from './primitives.js';

/**
 * What a review publishes: the panel, the assessments, the working, the calibration decision and
 * the completion snapshot.
 *
 * Two shapes here carry rules rather than data. `CalibrationDecisionView` publishes the **original**
 * score alongside the calibrated one, because a consumer that saw only the effective number could
 * not tell a rating that was confirmed from one that was moved. And `PeerAggregateView` says
 * `available: false` when a template's minimum has not been met — that withholds a number, and it
 * is emphatically not anonymity.
 */

export interface ReviewerAssignmentView {
  readonly reviewerAssignmentId: string;
  readonly reviewerEmploymentId: string;
  readonly role: string;
  readonly status: string;
  readonly requestedAt: string;
  readonly respondedAt?: string;
}

export interface AssessmentItemView {
  readonly assessmentItemId: string;
  readonly itemKind: string;
  readonly goalId?: string;
  readonly competencyId?: string;
  readonly score?: ScoreHundredths;
  readonly weightBasisPoints?: BasisPoints;
  readonly comment?: string;
  readonly excluded: boolean;
  /** Why this line left the denominator. Never inferred by a consumer from a missing score. */
  readonly exclusionReason?: string;
}

export interface AssessmentView {
  readonly assessmentId: string;
  readonly assessmentKind: string;
  readonly assessorEmploymentId: string;
  readonly status: string;
  readonly goalScore?: ScoreHundredths;
  readonly competencyScore?: ScoreHundredths;
  readonly overallScore?: ScoreHundredths;
  readonly overallComment?: string;
  readonly strengths?: string;
  readonly developmentAreas?: string;
  readonly submittedAt?: string;
  readonly items: readonly AssessmentItemView[];
}

export interface ComponentScoreView {
  readonly component: string;
  readonly weightBasisPoints: BasisPoints;
  readonly included: boolean;
  readonly score?: ScoreHundredths;
  readonly exclusionReason?: string;
  readonly denominatorBasisPoints: BasisPoints;
  readonly contributedScore?: ScoreHundredths;
  readonly excludedItems: readonly { readonly reference: string; readonly reason: string }[];
}

/**
 * A calibration decision, with both numbers.
 *
 * The original is published alongside the calibrated one on purpose. A consumer that saw only the
 * effective score could not tell a rating that was examined and confirmed from one that was moved,
 * and the difference is exactly what the person it belongs to would want to know.
 */
export interface CalibrationDecisionView {
  readonly calibrationDecisionId: string;
  readonly calibrationSessionId: string;
  readonly originalScore?: ScoreHundredths;
  readonly originalRatingLevelId?: string;
  readonly calibratedScore: ScoreHundredths;
  readonly calibratedRatingLevelId: string;
  readonly reason: string;
  readonly decidedAt: string;
  readonly decidedBy: string;
}

/**
 * The multi-rater aggregate, or the honest statement that it is being withheld.
 *
 * `available: false` means fewer responses arrived than the template requires, so no scores are
 * carried. It does **not** mean the responses were anonymous — they were not, they are attributed
 * rows in this module's tables, and no view in this file claims otherwise.
 */
export interface PeerAggregateView {
  readonly available: boolean;
  readonly responseCount: number;
  readonly minimumResponses?: number;
  readonly averageScore?: ScoreHundredths;
}

export interface ReviewView {
  readonly reviewId: string;
  readonly cycleId: string;
  readonly employmentId: string;
  readonly managerEmploymentId?: string;
  readonly ratingScaleId: string;
  readonly status: string;
  readonly calculatedScore?: ScoreHundredths;
  readonly calculatedRatingLevelId?: string;
  readonly finalScore?: ScoreHundredths;
  readonly finalRatingLevelId?: string;
  readonly calibrated: boolean;
  readonly scoredAt?: string;
  readonly completedAt?: string;
  readonly completedBy?: string;
  readonly archivedAt?: string;
  readonly version: number;
}

/** One review with everything a review screen needs, and nothing a payroll screen would. */
export interface ReviewDetailView {
  readonly review: ReviewView;
  readonly reviewers: readonly ReviewerAssignmentView[];
  readonly assessments: readonly AssessmentView[];
  readonly componentScores: readonly ComponentScoreView[];
  readonly calibration?: CalibrationDecisionView;
  readonly peerAggregate: PeerAggregateView;
  /** Present once the review is completed. What the rating can still be explained from. */
  readonly snapshot?: ReviewSnapshotView;
}

export interface CalibrationSessionView {
  readonly calibrationSessionId: string;
  readonly cycleId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly status: string;
  readonly organizationUnitId?: string;
  readonly scheduledFor?: string;
  readonly facilitator?: string;
  readonly concludedAt?: string;
  readonly concludedBy?: string;
  readonly decisionCount: number;
  readonly version: number;
}

export interface TalentPlacementView {
  readonly talentPlacementId: string;
  readonly cycleId: string;
  readonly reviewId: string;
  readonly employmentId: string;
  readonly performanceBand: number;
  readonly potentialBand: number;
  readonly boxCode: string;
  readonly rationale?: string;
  readonly placedAt: string;
  readonly placedBy: string;
}

export interface FeedbackView {
  readonly feedbackId: string;
  readonly subjectEmploymentId: string;
  readonly authorEmploymentId: string;
  readonly kind: string;
  readonly visibility: string;
  readonly body: string;
  readonly relatedGoalId?: string;
  readonly relatedReviewId?: string;
  readonly givenAt: string;
}

/**
 * What a completed review can still be explained from, years later.
 *
 * Published as opaque structured values rather than as live references: a consumer that re-read the
 * current rating scale would see a review change when somebody edited configuration, which is the
 * one thing the snapshot exists to prevent.
 */
export interface ReviewSnapshotView {
  readonly reviewId: string;
  readonly managerEmploymentId?: string;
  readonly reviewers: readonly {
    readonly reviewerEmploymentId: string;
    readonly role: string;
    readonly responded: boolean;
  }[];
  readonly placement: {
    readonly organizationUnitId?: string;
    readonly positionId?: string;
    readonly legalEntityId?: string;
  };
  readonly ratingScale: {
    readonly minimumScore: ScoreHundredths;
    readonly maximumScore: ScoreHundredths;
    readonly levels: readonly {
      readonly ratingLevelId: string;
      readonly ordinal: number;
      readonly minimumScore: ScoreHundredths;
      readonly maximumScore: ScoreHundredths;
    }[];
  };
  readonly competencyFramework?: {
    readonly frameworkId: string;
    readonly code: string;
    readonly frameworkVersion: number;
    readonly weighted: boolean;
    readonly competencies: readonly {
      readonly competencyId: string;
      readonly code: string;
      readonly category: string;
      readonly weightBasisPoints?: BasisPoints;
    }[];
  };
  readonly goals: readonly {
    readonly goalId: string;
    readonly title: string;
    readonly weightBasisPoints: BasisPoints;
    readonly status: string;
    readonly finalScore?: ScoreHundredths;
  }[];
  readonly componentScores: readonly ComponentScoreView[];
  readonly calculation: {
    readonly calculatedScore: ScoreHundredths;
    readonly calculatedRatingLevelId: string;
    readonly finalScore: ScoreHundredths;
    readonly finalRatingLevelId: string;
    readonly calibrated: boolean;
  };
  readonly takenAt: string;
  readonly takenBy: string;
}

/**
 * What reconciliation found. **It reports; it repairs nothing.**
 *
 * Every finding here is a question somebody has to answer, not a state the system will correct on
 * its own — there is no scheduler to correct anything, and a report that silently fixed what it
 * found would hide the fact that it kept finding it.
 */
export interface ReconciliationFindingView {
  readonly kind: string;
  readonly subjectId: string;
  readonly detail: Readonly<Record<string, string>>;
}

export interface PerformanceSummaryView {
  readonly cycleId: string;
  readonly participants: number;
  readonly completed: number;
  readonly calibrated: number;
  readonly averageFinalScore?: ScoreHundredths;
  readonly byRatingLevel: readonly {
    readonly ratingLevelId: string;
    readonly count: number;
  }[];
}
