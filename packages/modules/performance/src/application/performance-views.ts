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
import type { ComponentOutcome } from '../domain/scoring.js';
import type { GoalCategoryState } from './performance-ports.js';
import type {
  AssessmentItemView,
  AssessmentView,
  CalibrationDecisionView,
  CalibrationSessionView,
  CompetencyFrameworkView,
  CompetencyView,
  ComponentScoreView,
  CycleView,
  FeedbackView,
  GoalCategoryView,
  GoalProgressView,
  GoalView,
  RatingLevelView,
  RatingScaleView,
  ReviewSnapshotView,
  ReviewTemplateView,
  ReviewView,
  ReviewerAssignmentView,
  TalentPlacementView,
} from '../contracts/views.js';

/**
 * Domain state into published views.
 *
 * One direction only. Nothing here reads a view and produces state: a view is what this module
 * promises a consumer, and a mapper that ran backwards would let a consumer's shape decide the
 * domain's.
 *
 * **Dates leave as ISO strings and scores leave as whole hundredths.** A `Date` serializes
 * differently depending on who does it, and a score that became a float on the way out would be a
 * different number from the one the engine computed — which is the whole reason nothing in this
 * module is a float.
 */

/**
 * `exactOptionalPropertyTypes` distinguishes "key absent" from "key present, value undefined", and
 * a view with an explicitly undefined field is not the same object over the wire. This drops the
 * absent ones rather than spelling out a conditional spread per field.
 */
type Defined<TShape> = { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> };

const present = <TShape extends object>(candidate: TShape): Defined<TShape> =>
  Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  ) as Defined<TShape>;

const moment = (value: Date | undefined): string | undefined => value?.toISOString();

/** A civil date, without the time nobody set. A goal is due on a day, not at an instant. */
const civil = (value: Date): string => value.toISOString().slice(0, 10);

export const ratingLevelView = (state: RatingLevelState): RatingLevelView => ({
  ratingLevelId: state.ratingLevelId,
  code: state.code,
  name: state.name,
  ordinal: state.ordinal,
  minimumScore: state.minimumScore,
  maximumScore: state.maximumScore,
});

export const ratingScaleView = (
  state: RatingScaleState,
  levels: readonly RatingLevelState[],
): RatingScaleView => ({
  ratingScaleId: state.ratingScaleId,
  code: state.code,
  name: state.name,
  minimumScore: state.minimumScore,
  maximumScore: state.maximumScore,
  effectiveFrom: civil(state.effectiveFrom),
  active: state.active,
  levels: [...levels].sort((left, right) => left.ordinal - right.ordinal).map(ratingLevelView),
  version: state.version,
  ...present({
    effectiveTo: state.effectiveTo === undefined ? undefined : civil(state.effectiveTo),
  }),
});

export const competencyView = (state: CompetencyState): CompetencyView => ({
  competencyId: state.competencyId,
  code: state.code,
  name: state.name,
  category: state.category,
  displayOrder: state.displayOrder,
  active: state.active,
  ...present({ weightBasisPoints: state.weightBasisPoints }),
});

export const frameworkView = (
  state: CompetencyFrameworkState,
  competencies: readonly CompetencyState[],
): CompetencyFrameworkView => ({
  frameworkId: state.frameworkId,
  code: state.code,
  frameworkVersion: state.frameworkVersion,
  name: state.name,
  weighted: state.weighted,
  effectiveFrom: civil(state.effectiveFrom),
  active: state.active,
  competencies: [...competencies]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map(competencyView),
  version: state.version,
  ...present({
    effectiveTo: state.effectiveTo === undefined ? undefined : civil(state.effectiveTo),
  }),
});

export const templateView = (
  state: ReviewTemplateState,
  components: readonly TemplateComponentState[],
): ReviewTemplateView => ({
  templateId: state.templateId,
  code: state.code,
  name: state.name,
  ratingScaleId: state.ratingScaleId,
  requiresSelfAssessment: state.requiresSelfAssessment,
  requiresPeerAssessment: state.requiresPeerAssessment,
  requiresCalibration: state.requiresCalibration,
  goalWeightTotalBasisPoints: state.goalWeightTotalBasisPoints,
  active: state.active,
  components: components.map((component) => ({
    component: component.component,
    weightBasisPoints: component.weightBasisPoints,
  })),
  version: state.version,
  ...present({
    competencyFrameworkId: state.competencyFrameworkId,
    minimumPeerResponses: state.minimumPeerResponses,
  }),
});

export const goalCategoryView = (state: GoalCategoryState): GoalCategoryView => ({
  goalCategoryId: state.goalCategoryId,
  code: state.code,
  name: state.name,
  active: state.active,
  version: state.version,
});

export const goalProgressView = (state: GoalProgressState): GoalProgressView => ({
  goalProgressId: state.goalProgressId,
  progressBasisPoints: state.progressBasisPoints,
  recordedAt: state.recordedAt.toISOString(),
  recordedBy: state.recordedBy,
  ...present({ note: state.note, evidenceDocumentId: state.evidenceDocumentId }),
});

export const goalView = (
  state: GoalState,
  progress: readonly GoalProgressState[] = [],
): GoalView => ({
  goalId: state.goalId,
  scope: state.scope,
  title: state.title,
  measurement: state.measurement,
  weightBasisPoints: state.weightBasisPoints,
  status: state.status,
  startDate: civil(state.startDate),
  dueDate: civil(state.dueDate),
  progressBasisPoints: state.progressBasisPoints,
  progress: progress.map(goalProgressView),
  version: state.version,
  ...present({
    employmentId: state.employmentId,
    organizationUnitId: state.organizationUnitId,
    cycleId: state.cycleId,
    parentGoalId: state.parentGoalId,
    goalCategoryId: state.goalCategoryId,
    description: state.description,
    targetDescription: state.targetDescription,
    approvedAt: moment(state.approvedAt),
    approvedBy: state.approvedBy,
    closedAt: moment(state.closedAt),
    finalScore: state.finalScore,
    closureReason: state.closureReason,
    evidenceDocumentId: state.evidenceDocumentId,
  }),
});

export const cycleView = (state: CycleState, participantCount: number): CycleView => ({
  cycleId: state.cycleId,
  code: state.code,
  name: state.name,
  reviewTemplateId: state.reviewTemplateId,
  kind: state.kind,
  status: state.status,
  periodStart: civil(state.periodStart),
  periodEnd: civil(state.periodEnd),
  participantCount,
  version: state.version,
  ...present({
    selfAssessmentDue:
      state.selfAssessmentDue === undefined ? undefined : civil(state.selfAssessmentDue),
    managerAssessmentDue:
      state.managerAssessmentDue === undefined ? undefined : civil(state.managerAssessmentDue),
    peerAssessmentDue:
      state.peerAssessmentDue === undefined ? undefined : civil(state.peerAssessmentDue),
    calibrationDue: state.calibrationDue === undefined ? undefined : civil(state.calibrationDue),
    openedAt: moment(state.openedAt),
    closedAt: moment(state.closedAt),
    closedBy: state.closedBy,
  }),
});

export const reviewView = (state: ReviewState): ReviewView => ({
  reviewId: state.reviewId,
  cycleId: state.cycleId,
  employmentId: state.employmentId,
  ratingScaleId: state.ratingScaleId,
  status: state.status,
  calibrated: state.calibrated,
  version: state.version,
  ...present({
    managerEmploymentId: state.managerEmploymentId,
    calculatedScore: state.calculatedScore,
    calculatedRatingLevelId: state.calculatedRatingLevelId,
    finalScore: state.finalScore,
    finalRatingLevelId: state.finalRatingLevelId,
    scoredAt: moment(state.scoredAt),
    completedAt: moment(state.completedAt),
    completedBy: state.completedBy,
    archivedAt: moment(state.archivedAt),
  }),
});

export const reviewerView = (state: ReviewerAssignmentState): ReviewerAssignmentView => ({
  reviewerAssignmentId: state.reviewerAssignmentId,
  reviewerEmploymentId: state.reviewerEmploymentId,
  role: state.role,
  status: state.status,
  requestedAt: state.requestedAt.toISOString(),
  ...present({ respondedAt: moment(state.respondedAt) }),
});

export const assessmentItemView = (state: AssessmentItemState): AssessmentItemView => ({
  assessmentItemId: state.assessmentItemId,
  itemKind: state.itemKind,
  excluded: state.excluded,
  ...present({
    goalId: state.goalId,
    competencyId: state.competencyId,
    score: state.score,
    weightBasisPoints: state.weightBasisPoints,
    comment: state.comment,
    exclusionReason: state.exclusionReason,
  }),
});

export const assessmentView = (
  state: AssessmentState,
  items: readonly AssessmentItemState[],
): AssessmentView => ({
  assessmentId: state.assessmentId,
  assessmentKind: state.assessmentKind,
  assessorEmploymentId: state.assessorEmploymentId,
  status: state.status,
  items: items.map(assessmentItemView),
  ...present({
    goalScore: state.goalScore,
    competencyScore: state.competencyScore,
    overallScore: state.overallScore,
    overallComment: state.overallComment,
    strengths: state.strengths,
    developmentAreas: state.developmentAreas,
    submittedAt: moment(state.submittedAt),
  }),
});

export const componentScoreView = (outcome: ComponentOutcome): ComponentScoreView => ({
  component: outcome.component,
  weightBasisPoints: outcome.weightBasisPoints,
  included: outcome.included,
  denominatorBasisPoints: outcome.denominatorBasisPoints,
  excludedItems: outcome.excludedItems.map((item) => ({
    reference: item.reference,
    reason: item.reason,
  })),
  ...present({
    score: outcome.score,
    exclusionReason: outcome.exclusionReason,
    contributedScore: outcome.contributedScore,
  }),
});

export const calibrationDecisionView = (
  state: CalibrationDecisionState,
): CalibrationDecisionView => ({
  calibrationDecisionId: state.calibrationDecisionId,
  calibrationSessionId: state.calibrationSessionId,
  calibratedScore: state.calibratedScore,
  calibratedRatingLevelId: state.calibratedRatingLevelId,
  reason: state.reason,
  decidedAt: state.decidedAt.toISOString(),
  decidedBy: state.decidedBy,
  ...present({
    originalScore: state.originalScore,
    originalRatingLevelId: state.originalRatingLevelId,
  }),
});

export const calibrationSessionView = (
  state: CalibrationSessionState,
  decisionCount: number,
): CalibrationSessionView => ({
  calibrationSessionId: state.calibrationSessionId,
  cycleId: state.cycleId,
  code: state.code,
  name: state.name,
  status: state.status,
  decisionCount,
  version: state.version,
  ...present({
    organizationUnitId: state.organizationUnitId,
    scheduledFor: moment(state.scheduledFor),
    facilitator: state.facilitator,
    concludedAt: moment(state.concludedAt),
    concludedBy: state.concludedBy,
  }),
});

export const placementView = (state: TalentPlacementState): TalentPlacementView => ({
  talentPlacementId: state.talentPlacementId,
  cycleId: state.cycleId,
  reviewId: state.reviewId,
  employmentId: state.employmentId,
  performanceBand: state.performanceBand,
  potentialBand: state.potentialBand,
  boxCode: state.boxCode,
  placedAt: state.placedAt.toISOString(),
  placedBy: state.placedBy,
  ...present({ rationale: state.rationale }),
});

export const feedbackView = (state: FeedbackState): FeedbackView => ({
  feedbackId: state.feedbackId,
  subjectEmploymentId: state.subjectEmploymentId,
  authorEmploymentId: state.authorEmploymentId,
  kind: state.kind,
  visibility: state.visibility,
  body: state.body,
  givenAt: state.givenAt.toISOString(),
  ...present({ relatedGoalId: state.relatedGoalId, relatedReviewId: state.relatedReviewId }),
});

/**
 * The snapshot, published as the frozen values it holds rather than as references to live ones.
 *
 * A consumer that re-read the current rating scale would see a completed review change when
 * somebody edited configuration, which is the one thing the snapshot exists to prevent.
 */
export const snapshotView = (state: ReviewSnapshotState): ReviewSnapshotView => ({
  reviewId: state.reviewId,
  reviewers: state.reviewers,
  placement: state.placement,
  ratingScale: {
    minimumScore: state.ratingScale.minimumScore,
    maximumScore: state.ratingScale.maximumScore,
    levels: state.ratingScale.levels.map((level) => ({
      ratingLevelId: level.ratingLevelId,
      ordinal: level.ordinal,
      minimumScore: level.minimumScore,
      maximumScore: level.maximumScore,
    })),
  },
  goals: state.goals,
  componentScores: state.componentScores.map(componentScoreView),
  calculation: state.calculation,
  takenAt: state.takenAt.toISOString(),
  takenBy: state.takenBy,
  ...present({
    managerEmploymentId: state.managerEmploymentId,
    competencyFramework: state.competencyFramework,
  }),
});
