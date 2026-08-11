import type { Transaction } from '@work/kernel';

import {
  scoreReview,
  type RatingScaleBand,
  type ScoringComponentInput,
} from '../domain/scoring.js';
import type { AssessmentItemState, AssessmentState } from '../domain/assessment.js';
import type { PerformanceResult } from '../domain/performance-rejection.js';
import type { ReviewTemplateState, TemplateComponentState } from '../domain/review-template.js';
import type { ScoreOutcome } from '../domain/scoring.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Assembling what the scoring engine needs, and nothing else.
 *
 * The engine is pure and knows nothing about stores. **This file is the only place that turns rows
 * into its inputs**, which is what keeps the approved D-6 semantics in one file rather than
 * scattered across handlers that each remember a different half of them.
 *
 * Three assembly rules carry real weight, and each of them is an approved decision rather than a
 * convenience:
 *
 *   * **The manager assessment is what a review is scored from.** Self and peer assessments are
 *     recorded, kept and shown; they do not enter the calculation, because nothing approved says
 *     how they would be weighted against the manager's and inventing a weight is exactly what §24
 *     of the brief forbids. If a tenant wants them to count, that is a decision somebody makes and
 *     a component the template declares — not something this file assumes.
 *   * **A cancelled goal is excluded before the engine sees it**, carrying `cancelled` as its
 *     reason. That is the sixth decision, and doing it here means a cancelled goal cannot reach the
 *     denominator by any path.
 *   * **Weights come from the goal, not from the assessment line.** An assessor rates; a tenant
 *     weights. A line whose weight came from whoever filled the form in would let an assessor
 *     change what a goal counts for by typing a different number.
 */

export const scaleBandFor = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  ratingScaleId: string,
): Promise<RatingScaleBand | undefined> => {
  const scale = await dependencies.stores.ratingScales.byId(transaction, ratingScaleId);

  if (scale === undefined) return undefined;

  const levels = await dependencies.stores.ratingScales.levelsFor(transaction, ratingScaleId);

  return {
    minimumScore: scale.minimumScore,
    maximumScore: scale.maximumScore,
    levels: levels.map((level) => ({
      ratingLevelId: level.ratingLevelId,
      ordinal: level.ordinal,
      minimumScore: level.minimumScore,
      maximumScore: level.maximumScore,
    })),
  };
};

export interface ScoringInputs {
  readonly scale: RatingScaleBand;
  readonly components: readonly ScoringComponentInput[];
}

/**
 * The inputs for one review, or the reason there are none.
 *
 * A review with no submitted manager assessment is not scorable, and is refused rather than scored
 * from a draft: a draft is somebody's working, and rating a person from a form they had not finished
 * filling in is not a rating anybody could defend.
 */
export const scoringInputsFor = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  review: { readonly reviewId: string; readonly employmentId: string; readonly cycleId: string },
  template: ReviewTemplateState,
  components: readonly TemplateComponentState[],
): Promise<ScoringInputs | string> => {
  const scale = await scaleBandFor(dependencies, transaction, template.ratingScaleId);

  if (scale === undefined) return 'review-scale-missing';

  const assessments = await dependencies.stores.assessments.forReview(transaction, review.reviewId);
  const manager = assessments.find(
    (assessment) => assessment.assessmentKind === 'manager' && assessment.status === 'submitted',
  );

  if (manager === undefined) return 'review-manager-assessment-missing';

  const items = await dependencies.stores.assessments.itemsFor(transaction, manager.assessmentId);
  const goals = await dependencies.stores.goals.forReview(
    transaction,
    review.employmentId,
    review.cycleId,
  );
  const weighted = await frameworkIsWeighted(dependencies, transaction, template);

  return {
    scale,
    components: components.map((component) =>
      component.component === 'goals'
        ? goalComponent(component, items, goals)
        : competencyComponent(component, items, weighted),
    ),
  };
};

const frameworkIsWeighted = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  template: ReviewTemplateState,
): Promise<boolean> => {
  if (template.competencyFrameworkId === undefined) return false;

  const framework = await dependencies.stores.frameworks.byId(
    transaction,
    template.competencyFrameworkId,
  );

  return framework?.weighted ?? false;
};

interface GoalFacts {
  readonly goalId: string;
  readonly weightBasisPoints: number;
  readonly status: string;
}

/**
 * The goal component: every goal in the cycle, whether it was assessed or not.
 *
 * Built from the *goals*, not from the assessment lines, so a goal the assessor skipped entirely
 * appears as `missing` rather than vanishing. A goal that vanished would leave the denominator
 * without anybody recording that it had — which is the difference between "assessed on four of five
 * goals" and "assessed on four goals", and only one of those is true.
 */
const goalComponent = (
  component: TemplateComponentState,
  items: readonly AssessmentItemState[],
  goals: readonly GoalFacts[],
): ScoringComponentInput => ({
  component: 'goals',
  weightBasisPoints: component.weightBasisPoints,
  weighted: true,
  items: goals.map((goal) => {
    // The sixth approved decision, applied before the engine sees the goal at all.
    if (goal.status === 'cancelled') {
      return { reference: goal.goalId, exclusionReason: 'cancelled' as const };
    }

    const line = items.find((item) => item.itemKind === 'goal' && item.goalId === goal.goalId);

    if (line === undefined) return { reference: goal.goalId, exclusionReason: 'missing' as const };
    if (line.excluded) {
      return {
        reference: goal.goalId,
        exclusionReason: line.exclusionReason ?? ('missing' as const),
      };
    }

    // The weight is the tenant's, from the goal. An assessor rates; they do not decide what a goal
    // is worth.
    return {
      reference: goal.goalId,
      weightBasisPoints: goal.weightBasisPoints,
      ...(line.score === undefined ? {} : { score: line.score }),
    };
  }),
});

/**
 * The competency component, built from the assessed lines.
 *
 * Unlike goals, a competency nobody rated has no row to stand in for it here — the framework's
 * competencies are the reference, and this uses the lines the assessment actually carries. Where a
 * line was recorded and excluded, the reason travels with it.
 */
const competencyComponent = (
  component: TemplateComponentState,
  items: readonly AssessmentItemState[],
  weighted: boolean,
): ScoringComponentInput => ({
  component: 'competencies',
  weightBasisPoints: component.weightBasisPoints,
  weighted,
  items: items
    .filter((item) => item.itemKind === 'competency')
    .map((item) => ({
      reference: item.competencyId ?? item.assessmentItemId,
      ...(item.excluded
        ? { exclusionReason: item.exclusionReason ?? ('missing' as const) }
        : { ...(item.score === undefined ? {} : { score: item.score }) }),
      ...(weighted && item.weightBasisPoints !== undefined
        ? { weightBasisPoints: item.weightBasisPoints }
        : {}),
    })),
});

/** The engine, applied. Kept here so no handler calls it with hand-assembled inputs. */
export const scoreFrom = (inputs: ScoringInputs): PerformanceResult<ScoreOutcome> =>
  scoreReview({ scale: inputs.scale, components: inputs.components });

/** Whether an assessment counts toward a multi-rater aggregate. Submitted responses only. */
export const submittedMultiRater = (
  assessments: readonly AssessmentState[],
): readonly AssessmentState[] =>
  assessments.filter(
    (assessment) =>
      assessment.status === 'submitted' &&
      (assessment.assessmentKind === 'peer' ||
        assessment.assessmentKind === 'direct_report' ||
        assessment.assessmentKind === 'skip_level'),
  );
