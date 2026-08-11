import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import type { ComponentOutcome, RatingScaleBand } from './scoring.js';
import type { ReviewState, ReviewerAssignmentState } from './review.js';
import type { CompetencyState } from './competency-framework.js';
import type { GoalState } from './goal.js';

/**
 * What a completed review must survive.
 *
 * A manager change, a department move, a competency redefinition, a rating-scale change, a goal
 * redefinition and a position change: each of them is an ordinary thing that happens after a review
 * is finished, and each of them would otherwise change what the review appears to have said. The
 * snapshot is taken once, at completion, and is immutable afterwards in the domain, the application
 * and at the table (ADR-0064, §15).
 *
 * **It holds the inputs to a decision, not a copy of the database.** No person's name is in it —
 * a screen that wants a name asks People, which owns it and knows whether the caller may see it.
 * No pay figure is in it, because a performance review must not display one and a snapshot that
 * held one would be a salary record with a different name on the table. Phase 11's discipline,
 * applied unchanged.
 */

export interface SnapshotReviewer {
  readonly reviewerEmploymentId: string;
  readonly role: string;
  readonly responded: boolean;
}

export interface SnapshotPlacement {
  readonly organizationUnitId?: string;
  readonly positionId?: string;
  readonly legalEntityId?: string;
}

export interface SnapshotGoal {
  readonly goalId: string;
  readonly title: string;
  readonly weightBasisPoints: number;
  readonly status: string;
  readonly finalScore?: number;
}

export interface SnapshotCompetency {
  readonly competencyId: string;
  readonly code: string;
  readonly category: string;
  readonly weightBasisPoints?: number;
}

export interface SnapshotFramework {
  readonly frameworkId: string;
  readonly code: string;
  readonly frameworkVersion: number;
  readonly weighted: boolean;
  readonly competencies: readonly SnapshotCompetency[];
}

export interface SnapshotCalculation {
  readonly calculatedScore: number;
  readonly calculatedRatingLevelId: string;
  readonly finalScore: number;
  readonly finalRatingLevelId: string;
  readonly calibrated: boolean;
}

export interface ReviewSnapshotState {
  readonly reviewSnapshotId: string;
  readonly reviewId: string;
  readonly managerEmploymentId?: string;
  readonly reviewers: readonly SnapshotReviewer[];
  readonly placement: SnapshotPlacement;
  readonly ratingScale: RatingScaleBand;
  readonly competencyFramework?: SnapshotFramework;
  readonly goals: readonly SnapshotGoal[];
  readonly componentScores: readonly ComponentOutcome[];
  readonly calculation: SnapshotCalculation;
  readonly takenAt: Date;
  readonly takenBy: string;
  readonly version: number;
}

export interface TakeSnapshotRequest {
  readonly reviewSnapshotId: string;
  /** The manager at completion, which a transfer afterwards does not change (D-13). */
  readonly managerEmploymentId?: string;
  readonly reviewers: readonly ReviewerAssignmentState[];
  readonly placement: SnapshotPlacement;
  readonly ratingScale: RatingScaleBand;
  readonly framework?: {
    readonly frameworkId: string;
    readonly code: string;
    readonly frameworkVersion: number;
    readonly weighted: boolean;
    readonly competencies: readonly CompetencyState[];
  };
  readonly goals: readonly GoalState[];
  readonly componentScores: readonly ComponentOutcome[];
  readonly takenAt: Date;
  readonly takenBy: string;
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const takeSnapshot = (
  review: ReviewState,
  request: TakeSnapshotRequest,
): PerformanceResult<ReviewSnapshotState> => {
  if (
    review.calculatedScore === undefined ||
    review.calculatedRatingLevelId === undefined ||
    review.finalScore === undefined ||
    review.finalRatingLevelId === undefined
  ) {
    return refuse('review-not-yet-scored');
  }
  if (request.componentScores.length === 0) return refuse('snapshot-has-no-components');

  return accept({
    reviewSnapshotId: request.reviewSnapshotId,
    reviewId: review.reviewId,
    reviewers: request.reviewers.map((reviewer) => ({
      reviewerEmploymentId: reviewer.reviewerEmploymentId,
      role: reviewer.role,
      responded: reviewer.status === 'submitted',
    })),
    placement: request.placement,
    ratingScale: request.ratingScale,
    goals: request.goals.map(goalOf),
    componentScores: request.componentScores,
    calculation: {
      calculatedScore: review.calculatedScore,
      calculatedRatingLevelId: review.calculatedRatingLevelId,
      finalScore: review.finalScore,
      finalRatingLevelId: review.finalRatingLevelId,
      calibrated: review.calibrated,
    },
    takenAt: request.takenAt,
    takenBy: request.takenBy,
    version: 1,
    ...optional('managerEmploymentId', request.managerEmploymentId),
    ...optional('competencyFramework', frameworkOf(request)),
  });
};

/** A goal's definition and weight, and nothing about who owns it — the review already says that. */
const goalOf = (goal: GoalState): SnapshotGoal => ({
  goalId: goal.goalId,
  title: goal.title,
  weightBasisPoints: goal.weightBasisPoints,
  status: goal.status,
  ...optional('finalScore', goal.finalScore),
});

const frameworkOf = (request: TakeSnapshotRequest): SnapshotFramework | undefined => {
  if (request.framework === undefined) return undefined;

  return {
    frameworkId: request.framework.frameworkId,
    code: request.framework.code,
    frameworkVersion: request.framework.frameworkVersion,
    weighted: request.framework.weighted,
    competencies: request.framework.competencies.map((competency) => ({
      competencyId: competency.competencyId,
      code: competency.code,
      category: competency.category,
      ...optional('weightBasisPoints', competency.weightBasisPoints),
    })),
  };
};

/**
 * What a snapshot must never contain, asserted rather than described.
 *
 * The test suite calls this against a real snapshot: a rule about what is *absent* is the one kind
 * of rule a reader cannot check by looking, because the offending field simply is not there yet on
 * the day they look. It is here, in the domain, so that adding a name or a salary to the snapshot
 * fails a test rather than passing review.
 */
export const FORBIDDEN_SNAPSHOT_KEYS: readonly string[] = [
  'name',
  'fullName',
  'givenName',
  'familyName',
  'email',
  'salary',
  'pay',
  'amount',
  'baseSalary',
  'nationalId',
  'identifier',
];

export const carriesForbiddenData = (snapshot: ReviewSnapshotState): readonly string[] => {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_SNAPSHOT_KEYS.includes(key)) found.add(key);
      walk(nested);
    }
  };

  walk(snapshot);
  return [...found];
};
