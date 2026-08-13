import { categoryCountsOf, isOverdue } from '../domain/development.js';
import { standingOf } from '../domain/mobility.js';
import { isInForce } from '../domain/path.js';
import { reviewIsDue } from '../domain/succession.js';
import { definedOf } from '../domain/defined.js';
import type { DevelopmentItemState, DevelopmentPlanState } from '../domain/development.js';
import type { MobilityRecommendationState } from '../domain/mobility.js';
import type { CareerPathState, CareerStageState } from '../domain/path.js';
import type { CareerPlanState } from '../domain/plan.js';
import type { PoolMembershipState, TalentPoolState } from '../domain/pool.js';
import type { ReadinessAssessmentState, ReadinessLevelState } from '../domain/readiness.js';
import type { SuccessionPlanState, SuccessorState } from '../domain/succession.js';
import type {
  CareerPathView,
  CareerPlanView,
  CareerStageView,
  DevelopmentItemView,
  DevelopmentMixView,
  DevelopmentPlanView,
  MobilityRecommendationView,
  PoolMembershipView,
  ReadinessAssessmentView,
  ReadinessLevelView,
  SuccessionPlanView,
  SuccessorView,
  TalentPoolView,
} from '../contracts/views.js';

/**
 * Domain state into published views.
 *
 * One direction only. Nothing here reads a view and produces state: a view is what this module
 * promises a consumer, and a mapper that ran backwards would let a consumer's shape decide the
 * domain's.
 *
 * **Four derived fields are computed here and stored nowhere.** `inForce` on a path, `reviewDue` on
 * a succession plan, `overdue` on a development item and `standing` on a mobility recommendation are
 * all functions of a stored date and the day the caller asked about. No column holds any of them, so
 * nothing has to move one overnight, and the answer is correct at every instant rather than as of
 * the last sweep that ran — which matters because there is no sweep (D-13).
 *
 * **Nothing here computes a readiness, a balance or a score.** `developmentMixView` returns three
 * counts and the constant `NOT VERIFIED`, because the 70-20-10 model has a weighting and no
 * validation rule (D-12). A verdict field that quietly said "balanced" would be this product
 * deciding on a rule nobody wrote.
 *
 * **Nothing here reaches into another module.** No criticality on a succession plan, no potential
 * band beside a nomination, no course title on a development item — a consumer that wants one asks
 * the module that owns it.
 */

export const careerPathView = (
  state: CareerPathState,
  stageCount: number,
  asOf: string,
): CareerPathView => ({
  pathId: state.pathId,
  code: state.code,
  name: state.name,
  kind: state.kind,
  status: state.status,
  effectiveFrom: state.effectiveFrom,
  inForce: isInForce(state, asOf),
  stageCount,
  version: state.version,
  ...definedOf({ description: state.description, effectiveTo: state.effectiveTo }),
});

export const careerStageView = (state: CareerStageState): CareerStageView => ({
  stageId: state.stageId,
  pathId: state.pathId,
  sequence: state.sequence,
  name: state.name,
  ...definedOf({ targetPositionId: state.targetPositionId }),
});

export const careerPlanView = (state: CareerPlanState): CareerPlanView => ({
  careerPlanId: state.careerPlanId,
  employmentId: state.employmentId,
  status: state.status,
  startedOn: state.startedOn,
  version: state.version,
  ...definedOf({
    pathId: state.pathId,
    currentStageId: state.currentStageId,
    targetStageId: state.targetStageId,
    targetDate: state.targetDate,
    notes: state.notes,
    closedOn: state.closedOn,
    closedBy: state.closedBy,
  }),
});

export const talentPoolView = (state: TalentPoolState): TalentPoolView => ({
  talentPoolId: state.talentPoolId,
  code: state.code,
  name: state.name,
  kind: state.kind,
  status: state.status,
  version: state.version,
  ...definedOf({
    description: state.description,
    closedAt: state.closedAt?.toISOString(),
    closedBy: state.closedBy,
  }),
});

export const poolMembershipView = (state: PoolMembershipState): PoolMembershipView => ({
  membershipId: state.membershipId,
  talentPoolId: state.talentPoolId,
  employmentId: state.employmentId,
  from: state.from,
  addedBy: state.addedBy,
  version: state.version,
  ...definedOf({
    to: state.to,
    addedReason: state.addedReason,
    removedBy: state.removedBy,
    removedReason: state.removedReason,
  }),
});

/**
 * A succession plan, with whether its review day has passed.
 *
 * `reviewDue` is derived and **notifies nobody**. `JobPort` has no adapter, so a review comes due
 * because somebody ran the query that produced this view — not because anything fired.
 */
export const successionPlanView = (
  state: SuccessionPlanState,
  asOf: string,
): SuccessionPlanView => ({
  successionPlanId: state.successionPlanId,
  positionId: state.positionId,
  status: state.status,
  reviewDue: reviewIsDue(state, asOf),
  version: state.version,
  ...definedOf({
    reviewOn: state.reviewOn,
    notes: state.notes,
    archivedAt: state.archivedAt?.toISOString(),
    archivedBy: state.archivedBy,
  }),
});

export const successorView = (state: SuccessorState): SuccessorView => ({
  successorId: state.successorId,
  successionPlanId: state.successionPlanId,
  employmentId: state.employmentId,
  status: state.status,
  nominatedOn: state.nominatedOn,
  nominatedBy: state.nominatedBy,
  version: state.version,
  ...definedOf({
    readinessLevelId: state.readinessLevelId,
    rank: state.rank,
    confirmedOn: state.confirmedOn,
    confirmedBy: state.confirmedBy,
    withdrawnOn: state.withdrawnOn,
    withdrawnBy: state.withdrawnBy,
    withdrawalReason: state.withdrawalReason,
  }),
});

export const readinessLevelView = (state: ReadinessLevelState): ReadinessLevelView => ({
  readinessLevelId: state.readinessLevelId,
  code: state.code,
  name: state.name,
  ordinal: state.ordinal,
  active: state.active,
  version: state.version,
});

/**
 * One assessor's statement, passed through untouched.
 *
 * The rationale is the text they wrote and it leaves as the text they wrote: nothing parses it,
 * scores it or compares it with a threshold. There is no derived level and no score field, because
 * readiness is stated and not computed (ADR-0074, D-10).
 */
export const readinessAssessmentView = (
  state: ReadinessAssessmentState,
): ReadinessAssessmentView => ({
  readinessAssessmentId: state.readinessAssessmentId,
  employmentId: state.employmentId,
  readinessLevelId: state.readinessLevelId,
  assessedOn: state.assessedOn,
  assessedBy: state.assessedBy,
  recordedAt: state.recordedAt.toISOString(),
  ...definedOf({
    positionId: state.positionId,
    successionPlanId: state.successionPlanId,
    rationale: state.rationale,
  }),
});

export const developmentPlanView = (state: DevelopmentPlanState): DevelopmentPlanView => ({
  developmentPlanId: state.developmentPlanId,
  employmentId: state.employmentId,
  status: state.status,
  startedOn: state.startedOn,
  version: state.version,
  ...definedOf({
    careerPlanId: state.careerPlanId,
    cycleLabel: state.cycleLabel,
    targetDate: state.targetDate,
    employeeAcknowledgedOn: state.employeeAcknowledgedOn,
    employeeAcknowledgementRecordedBy: state.employeeAcknowledgementRecordedBy,
    managerAcknowledgedOn: state.managerAcknowledgedOn,
    managerAcknowledgementRecordedBy: state.managerAcknowledgementRecordedBy,
    closedOn: state.closedOn,
    closedBy: state.closedBy,
  }),
});

/**
 * An item, with whether its target date has passed.
 *
 * A `course` item carries its `learningAssignmentId` and no status Career invented: `status` on one
 * stays `planned` because Learning owns whether it was done (ADR-0073). Nothing here reads Learning
 * to fill in the answer, because a per-item cross-module read would be an N+1 on every page.
 */
export const developmentItemView = (
  state: DevelopmentItemState,
  asOf: string,
): DevelopmentItemView => ({
  developmentItemId: state.developmentItemId,
  developmentPlanId: state.developmentPlanId,
  category: state.category,
  kind: state.kind,
  title: state.title,
  status: state.status,
  overdue: isOverdue(state, asOf),
  version: state.version,
  ...definedOf({
    learningAssignmentId: state.learningAssignmentId,
    targetDate: state.targetDate,
    completedOn: state.completedOn,
    completedBy: state.completedBy,
  }),
});

/**
 * Three counts and an explicit `NOT VERIFIED`.
 *
 * The verdict is a constant rather than an omitted field. A response that carried counts and no
 * verdict would read as "balanced" to a screen that forgot to check, and the whole point of D-12 is
 * that this product does not know what balanced means: the specification gives a 70-20-10 weighting
 * and the word "validated", and defines neither the rule, the tolerance, how an item's contribution
 * is measured, nor what an uncategorized item does.
 */
export const developmentMixView = (items: readonly DevelopmentItemState[]): DevelopmentMixView => ({
  ...categoryCountsOf(items),
  mixVerdict: 'NOT VERIFIED',
});

/**
 * A recommendation, with what it stands as today.
 *
 * `status` is the stored value — never `expired`, which a check constraint refuses. `standing` is
 * derived from `validUntil` and the day asked, and is the only place `expired` appears. A decided
 * recommendation keeps its decision: accepting something and then letting its validity lapse does
 * not un-accept it.
 */
export const mobilityRecommendationView = (
  state: MobilityRecommendationState,
  asOf: string,
): MobilityRecommendationView => ({
  mobilityRecommendationId: state.mobilityRecommendationId,
  employmentId: state.employmentId,
  kind: state.kind,
  status: state.status,
  standing: standingOf(state, asOf),
  recommendedOn: state.recommendedOn,
  recommendedBy: state.recommendedBy,
  version: state.version,
  ...definedOf({
    targetPositionId: state.targetPositionId,
    targetUnitId: state.targetUnitId,
    rationale: state.rationale,
    validUntil: state.validUntil,
    decidedOn: state.decidedOn,
    decidedBy: state.decidedBy,
    decisionNote: state.decisionNote,
  }),
});
