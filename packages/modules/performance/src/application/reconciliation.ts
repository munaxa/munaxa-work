import { MAX_BASIS_POINTS } from '../domain/performance-vocabulary.js';
import { goalWeightsSatisfy } from '../domain/goal.js';
import type { CycleState } from '../domain/cycle.js';
import type { GoalState } from '../domain/goal.js';
import type { ReviewTemplateState, TemplateComponentState } from '../domain/review-template.js';
import type { ReviewState } from '../domain/review.js';
import type { TalentPlacementState } from '../domain/talent-placement.js';
import type { ReconciliationFinding } from './performance-ports.js';

/**
 * What reconciliation looks for, as pure functions over state.
 *
 * **It reports; it repairs nothing.** There is no scheduler to run it and nothing acts on what it
 * returns — it is a query somebody runs, which is the only honest shape while `JobPort` has no
 * adapter (D-22). A report that silently corrected what it found would hide the fact that it kept
 * finding it.
 *
 * The rules live here rather than in SQL so the in-memory store and the PostgreSQL repository
 * answer the *same* questions. Where the repository can push a predicate down it will; what it must
 * not do is answer a different question and have nobody notice.
 */

export interface ReconciliationInput {
  readonly cycleId: string;
  readonly cycles: readonly CycleState[];
  readonly reviews: readonly ReviewState[];
  readonly templates: readonly ReviewTemplateState[];
  readonly components: readonly TemplateComponentState[];
  readonly goals: readonly GoalState[];
  readonly placements: readonly TalentPlacementState[];
}

export const findingsFor = (input: ReconciliationInput): readonly ReconciliationFinding[] => {
  const cycle = input.cycles.find((candidate) => candidate.cycleId === input.cycleId);

  if (cycle === undefined) return [];

  const template = input.templates.find(
    (candidate) => candidate.templateId === cycle.reviewTemplateId,
  );
  const reviews = input.reviews.filter((review) => review.cycleId === input.cycleId);

  return [
    ...componentWeightFindings(cycle, template, input.components),
    ...uncalibratedFindings(reviews, template),
    ...goalWeightFindings(reviews, input.goals, template),
    ...placementDriftFindings(reviews, input.placements),
  ];
};

/**
 * The third place the first approved scoring decision is enforced.
 *
 * The domain refuses a template whose components do not total 10,000 and the engine refuses to
 * score against one. This finds the case neither can: a template written before a rule existed, or
 * one a future bulk path inserted around the application service.
 */
const componentWeightFindings = (
  cycle: CycleState,
  template: ReviewTemplateState | undefined,
  components: readonly TemplateComponentState[],
): readonly ReconciliationFinding[] => {
  if (template === undefined) {
    return [
      {
        kind: 'cycle-template-missing',
        subjectId: cycle.cycleId,
        detail: { templateId: cycle.reviewTemplateId },
      },
    ];
  }

  const mine = components.filter((component) => component.templateId === template.templateId);
  const total = mine.reduce((running, component) => running + component.weightBasisPoints, 0);

  if (mine.length === 0 || total === MAX_BASIS_POINTS) return [];

  return [
    {
      kind: 'template-component-weights-not-total',
      subjectId: template.templateId,
      detail: { total: String(total), required: String(MAX_BASIS_POINTS) },
    },
  ];
};

/** A review completed without the calibration its template required. */
const uncalibratedFindings = (
  reviews: readonly ReviewState[],
  template: ReviewTemplateState | undefined,
): readonly ReconciliationFinding[] => {
  if (template === undefined || !template.requiresCalibration) return [];

  return reviews
    .filter((review) => review.completedAt !== undefined && !review.calibrated)
    .map((review) => ({
      kind: 'review-completed-without-calibration',
      subjectId: review.reviewId,
      detail: { cycleId: review.cycleId },
    }));
};

/** A participant whose goals do not add up to what the template requires. */
const goalWeightFindings = (
  reviews: readonly ReviewState[],
  goals: readonly GoalState[],
  template: ReviewTemplateState | undefined,
): readonly ReconciliationFinding[] => {
  if (template === undefined || template.goalWeightTotalBasisPoints === 0) return [];

  // **Indexed once, not scanned per review.** This was `goals.filter(...)` inside the loop below,
  // which is O(reviews x goals): at 10,000 reviews and 30,000 goals that is three hundred million
  // comparisons, and the benchmark measured it at 10,330ms against a 10,000ms budget. The findings
  // are identical — same rules, same order — the traversal is not.
  const byEmployment = new Map<string, GoalState[]>();

  for (const goal of goals) {
    const key = `${goal.employmentId ?? ''}:${goal.cycleId ?? ''}`;

    byEmployment.set(key, [...(byEmployment.get(key) ?? []), goal]);
  }

  return reviews.flatMap((review): readonly ReconciliationFinding[] => {
    const mine = byEmployment.get(`${review.employmentId}:${review.cycleId}`) ?? [];

    if (mine.length === 0) {
      return [
        {
          kind: 'review-has-no-goals',
          subjectId: review.reviewId,
          detail: { employmentId: review.employmentId },
        },
      ];
    }
    if (goalWeightsSatisfy(mine, template.goalWeightTotalBasisPoints)) return [];

    const total = mine
      .filter((goal) => goal.status !== 'cancelled')
      .reduce((running, goal) => running + goal.weightBasisPoints, 0);

    return [
      {
        kind: 'goal-weights-not-total',
        subjectId: review.reviewId,
        detail: { total: String(total), required: String(template.goalWeightTotalBasisPoints) },
      },
    ];
  });
};

/**
 * A placement whose recorded band no longer matches its review's rating.
 *
 * Not repaired: the placement is a human judgement recorded at a moment, and quietly moving it to
 * agree with a later calibration would rewrite what a talent review actually concluded.
 */
const placementDriftFindings = (
  reviews: readonly ReviewState[],
  placements: readonly TalentPlacementState[],
): readonly ReconciliationFinding[] => {
  // Indexed for the same reason as the goals above: `reviews.find(...)` per placement is a scan of
  // the whole cycle for every row on the matrix.
  const byReview = new Map(reviews.map((review) => [review.reviewId, review]));

  return placements.flatMap((placement) => {
    const review = byReview.get(placement.reviewId);

    if (review === undefined || review.finalRatingLevelId === undefined) return [];
    if (!review.calibrated) return [];

    return [
      {
        kind: 'placement-predates-calibration',
        subjectId: placement.talentPlacementId,
        detail: { reviewId: placement.reviewId, boxCode: placement.boxCode },
      },
    ];
  });
};
