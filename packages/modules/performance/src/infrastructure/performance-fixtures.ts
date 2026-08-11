import { uuidV7 } from '@work/kernel';

import type { AssessmentItemState, AssessmentState } from '../domain/assessment.js';
import type { CalibrationDecisionState, CalibrationSessionState } from '../domain/calibration.js';
import type { CompetencyFrameworkState, CompetencyState } from '../domain/competency-framework.js';
import type { CycleState } from '../domain/cycle.js';
import type { FeedbackState } from '../domain/feedback.js';
import type { GoalProgressState, GoalState } from '../domain/goal.js';
import type { RatingLevelState, RatingScaleState } from '../domain/rating-scale.js';
import type { ReviewSnapshotState } from '../domain/review-snapshot.js';
import type { ReviewTemplateState, TemplateComponentState } from '../domain/review-template.js';
import type { ReviewState, ReviewerAssignmentState } from '../domain/review.js';
import type { TalentPlacementState } from '../domain/talent-placement.js';
import type { ComponentScoreRecord } from '../application/performance-ports.js';

/**
 * Deterministic states for the integration suites.
 *
 * **Every one of these is a shape the domain would have produced.** They are not raw rows: a
 * fixture that inserted a rating scale whose bands did not tile, or a review completed with no
 * score, would be testing the repository against data no command could create — and every
 * assertion built on it would be about a state the product cannot reach.
 *
 * The two places a suite *does* go around the domain are the direct-SQL immutability probes, which
 * exist precisely to prove the database refuses what the application already refuses. Those are
 * written as SQL in the test, not here, so nobody mistakes them for a supported path.
 */

export const NAME = { en: 'Annual', ar: 'سنوي' };

export const MANAGER_EMPLOYMENT = '01930000-0000-7000-8000-00000000f001';
export const EMPLOYEE_EMPLOYMENT = '01930000-0000-7000-8000-00000000f002';
export const PEER_EMPLOYMENT = '01930000-0000-7000-8000-00000000f003';
export const UNIT = '01930000-0000-7000-8000-00000000f0d1';

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

export interface ScaleWithLevels {
  readonly scale: RatingScaleState;
  readonly levels: readonly RatingLevelState[];
}

/** A 1–5 scale in hundredths, its four bands tiling 100…500 exactly. */
export const aRatingScale = (code = 'annual-1-5'): ScaleWithLevels => {
  const ratingScaleId = uuidV7();
  const bands = [
    { code: 'needs-improvement', ordinal: 1, minimumScore: 100, maximumScore: 199 },
    { code: 'developing', ordinal: 2, minimumScore: 200, maximumScore: 299 },
    { code: 'meets', ordinal: 3, minimumScore: 300, maximumScore: 399 },
    { code: 'exceeds', ordinal: 4, minimumScore: 400, maximumScore: 500 },
  ];

  return {
    scale: {
      ratingScaleId,
      code,
      name: NAME,
      minimumScore: 100,
      maximumScore: 500,
      effectiveFrom: day('2026-01-01'),
      active: true,
      version: 1,
    },
    levels: bands.map((band) => ({
      ratingLevelId: uuidV7(),
      ratingScaleId,
      code: band.code,
      name: NAME,
      ordinal: band.ordinal,
      minimumScore: band.minimumScore,
      maximumScore: band.maximumScore,
      version: 1,
    })),
  };
};

export const aFramework = (weighted = false): CompetencyFrameworkState => ({
  frameworkId: uuidV7(),
  code: 'core',
  frameworkVersion: 1,
  name: NAME,
  weighted,
  effectiveFrom: day('2026-01-01'),
  active: true,
  version: 1,
});

export const aCompetency = (
  frameworkId: string,
  code: string,
  weightBasisPoints?: number,
): CompetencyState => ({
  competencyId: uuidV7(),
  frameworkId,
  code,
  name: NAME,
  category: 'core',
  displayOrder: 1,
  active: true,
  version: 1,
  ...(weightBasisPoints === undefined ? {} : { weightBasisPoints }),
});

export interface TemplateWithComponents {
  readonly template: ReviewTemplateState;
  readonly components: readonly TemplateComponentState[];
}

export const aTemplate = (
  ratingScaleId: string,
  frameworkId?: string,
  overrides: Partial<ReviewTemplateState> = {},
): TemplateWithComponents => {
  const templateId = uuidV7();

  return {
    template: {
      templateId,
      code: 'annual',
      name: NAME,
      ratingScaleId,
      requiresSelfAssessment: true,
      requiresPeerAssessment: false,
      requiresCalibration: false,
      goalWeightTotalBasisPoints: 10_000,
      active: true,
      version: 1,
      ...(frameworkId === undefined ? {} : { competencyFrameworkId: frameworkId }),
      ...overrides,
    },
    components: [
      {
        templateComponentId: uuidV7(),
        templateId,
        component: 'goals',
        weightBasisPoints: 6000,
        version: 1,
      },
      {
        templateComponentId: uuidV7(),
        templateId,
        component: 'competencies',
        weightBasisPoints: 4000,
        version: 1,
      },
    ],
  };
};

export const aCycle = (reviewTemplateId: string, code = 'annual-2026'): CycleState => ({
  cycleId: uuidV7(),
  code,
  name: NAME,
  reviewTemplateId,
  kind: 'annual',
  status: 'open',
  periodStart: day('2026-01-01'),
  periodEnd: day('2026-12-31'),
  selfAssessmentDue: day('2027-01-15'),
  version: 1,
});

export const aReview = (
  cycleId: string,
  ratingScaleId: string,
  employmentId = EMPLOYEE_EMPLOYMENT,
): ReviewState => ({
  reviewId: uuidV7(),
  cycleId,
  employmentId,
  managerEmploymentId: MANAGER_EMPLOYMENT,
  ratingScaleId,
  status: 'pending',
  calibrated: false,
  version: 1,
});

export const aGoal = (
  cycleId: string,
  weightBasisPoints = 10_000,
  employmentId = EMPLOYEE_EMPLOYMENT,
): GoalState => ({
  goalId: uuidV7(),
  scope: 'individual',
  employmentId,
  cycleId,
  title: 'Reduce onboarding time to ten days',
  measurement: 'numeric',
  weightBasisPoints,
  status: 'active',
  startDate: day('2026-01-01'),
  dueDate: day('2026-12-31'),
  progressBasisPoints: 0,
  version: 1,
});

/**
 * A progress entry carrying a deliberately enormous observed value.
 *
 * `9_007_199_254_740_993n` is 2^53 + 1 — the smallest integer a JavaScript double cannot represent.
 * A path that parsed it with `Number` would hand back 2^53, and the round-trip assertion would fail.
 */
export const aProgressEntry = (goalId: string, observedValue?: bigint): GoalProgressState => ({
  goalProgressId: uuidV7(),
  goalId,
  progressBasisPoints: 5000,
  recordedAt: new Date('2026-06-01T09:00:00Z'),
  recordedBy: 'user:manager',
  version: 1,
  ...(observedValue === undefined ? {} : { observedValue }),
});

export const aReviewerAssignment = (
  reviewId: string,
  reviewerEmploymentId = PEER_EMPLOYMENT,
  role: 'peer' | 'manager' | 'self' = 'peer',
): ReviewerAssignmentState => ({
  reviewerAssignmentId: uuidV7(),
  reviewId,
  reviewerEmploymentId,
  role,
  status: 'pending',
  requestedAt: new Date('2027-01-01T09:00:00Z'),
  requestedBy: 'user:hr',
  version: 1,
});

export const anAssessment = (
  reviewId: string,
  assessorEmploymentId = MANAGER_EMPLOYMENT,
  assessmentKind: 'manager' | 'self' | 'peer' = 'manager',
): AssessmentState => ({
  assessmentId: uuidV7(),
  reviewId,
  assessorEmploymentId,
  assessmentKind,
  status: 'draft',
  version: 1,
});

export const aGoalItem = (
  assessmentId: string,
  goalId: string,
  score: number,
): AssessmentItemState => ({
  assessmentItemId: uuidV7(),
  assessmentId,
  itemKind: 'goal',
  goalId,
  score,
  weightBasisPoints: 10_000,
  excluded: false,
  version: 1,
});

export const anExcludedItem = (assessmentId: string, goalId: string): AssessmentItemState => ({
  assessmentItemId: uuidV7(),
  assessmentId,
  itemKind: 'goal',
  goalId,
  excluded: true,
  exclusionReason: 'cancelled',
  version: 1,
});

export const aComponentScore = (
  reviewId: string,
  component: 'goals' | 'competencies',
  score: number,
): ComponentScoreRecord => ({
  reviewId,
  component,
  weightBasisPoints: component === 'goals' ? 6000 : 4000,
  included: true,
  score,
  denominatorBasisPoints: 10_000,
  contributedScore: score,
  calculatedAt: new Date('2027-01-10T09:00:00Z'),
  excludedItems: [{ reference: 'goal-b', reason: 'cancelled' }],
});

export const aCalibrationSession = (cycleId: string): CalibrationSessionState => ({
  calibrationSessionId: uuidV7(),
  cycleId,
  code: 'engineering',
  name: NAME,
  status: 'in_session',
  version: 1,
});

export const aCalibrationDecision = (
  calibrationSessionId: string,
  reviewId: string,
  calibratedRatingLevelId: string,
): CalibrationDecisionState => ({
  calibrationDecisionId: uuidV7(),
  calibrationSessionId,
  reviewId,
  originalScore: 370,
  calibratedScore: 410,
  calibratedRatingLevelId,
  reason: 'Moderated against the peer group',
  decidedAt: new Date('2027-01-15T09:00:00Z'),
  decidedBy: 'user:director',
  version: 1,
});

export const aPlacement = (
  cycleId: string,
  reviewId: string,
  employmentId = EMPLOYEE_EMPLOYMENT,
): TalentPlacementState => ({
  talentPlacementId: uuidV7(),
  cycleId,
  reviewId,
  employmentId,
  performanceBand: 3,
  potentialBand: 2,
  boxCode: 'p3x2',
  placedAt: new Date('2027-02-01T09:00:00Z'),
  placedBy: 'user:hr',
  version: 1,
});

export const someFeedback = (
  subjectEmploymentId = EMPLOYEE_EMPLOYMENT,
  authorEmploymentId = MANAGER_EMPLOYMENT,
): FeedbackState => ({
  feedbackId: uuidV7(),
  subjectEmploymentId,
  authorEmploymentId,
  kind: 'praise',
  visibility: 'manager',
  body: 'Carried the migration through a difficult week.',
  givenAt: new Date('2026-06-01T09:00:00Z'),
  version: 1,
});

export const aSnapshot = (
  review: ReviewState,
  scale: ScaleWithLevels,
  components: readonly ComponentScoreRecord[],
): ReviewSnapshotState => ({
  reviewSnapshotId: uuidV7(),
  reviewId: review.reviewId,
  managerEmploymentId: MANAGER_EMPLOYMENT,
  reviewers: [{ reviewerEmploymentId: PEER_EMPLOYMENT, role: 'peer', responded: true }],
  placement: { organizationUnitId: UNIT },
  ratingScale: {
    minimumScore: scale.scale.minimumScore,
    maximumScore: scale.scale.maximumScore,
    levels: scale.levels.map((level) => ({
      ratingLevelId: level.ratingLevelId,
      ordinal: level.ordinal,
      minimumScore: level.minimumScore,
      maximumScore: level.maximumScore,
    })),
  },
  goals: [
    {
      goalId: uuidV7(),
      title: 'Reduce onboarding time',
      weightBasisPoints: 10_000,
      status: 'achieved',
      finalScore: 400,
    },
  ],
  componentScores: components,
  calculation: {
    calculatedScore: review.calculatedScore ?? 0,
    calculatedRatingLevelId: review.calculatedRatingLevelId ?? '',
    finalScore: review.finalScore ?? 0,
    finalRatingLevelId: review.finalRatingLevelId ?? '',
    calibrated: review.calibrated,
  },
  takenAt: new Date('2027-01-20T09:00:00Z'),
  takenBy: 'user:hr',
  version: 1,
});
