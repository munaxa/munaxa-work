import { MAX_BASIS_POINTS, type ExclusionReason } from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import type {
  ComponentOutcome,
  ExcludedItem,
  RatingLevelBand,
  RatingScaleBand,
  ScoreOutcome,
  ScoringComponentInput,
  ScoringItem,
  ScoringRequest,
} from './scoring-types.js';

export type {
  ComponentOutcome,
  ExcludedItem,
  RatingLevelBand,
  RatingScaleBand,
  ScoreOutcome,
  ScoringComponentInput,
  ScoringItem,
  ScoringRequest,
} from './scoring-types.js';

/**
 * The scoring engine, and the approved semantics of D-6 in one place.
 *
 * The specification defines no formula, so none was invented; these are the seven decisions as
 * approved, implemented literally and nowhere else in the module:
 *
 *   1. **Component weights** are tenant configuration on the review template, in integer basis
 *      points, and **must total 10,000**. A template whose components do not is refused before
 *      anything is scored rather than normalized into looking correct.
 *   2. **The goal aggregate** is `Σ(goal score × goal weight) ÷ Σ(weights of scored goals)`. Only
 *      scored, eligible goals appear in the denominator.
 *   3. **The competency aggregate** is an unweighted mean unless the framework explicitly carries
 *      weights, in which case those are used. **No weight is invented for a framework that has
 *      none** — an unweighted framework is scored as equal whole units, which is the same formula
 *      with the same code path and no fabricated numbers.
 *   4. **Rounding** is nearest, half away from zero, to two decimal places — which is to say, to a
 *      whole number of hundredths, the unit every score in this module is stored in.
 *   5. **Missing or incomplete work is excluded from the denominator**, and the exclusion is
 *      recorded with its reason. It is never silently converted into a zero, because a zero is a
 *      judgement and an absence is not.
 *   6. **A cancelled goal is excluded entirely** — it contributes neither a score nor a
 *      denominator weight.
 *   7. **A manual override never reaches this file.** Calibration is recorded separately, against
 *      the original this engine produced, which is why nothing here writes an overridden value.
 *
 * And the invariant that accompanies them: **a score outside the rating scale's range is a
 * failure, not something to clamp.** A clamped rating is a wrong rating that looks right, and
 * somebody would be told it was theirs.
 *
 * **Every number here is a `bigint`.** Not because the magnitudes demand it — they do not — but
 * because a score that decides somebody's rating must not be one rounding of a binary fraction
 * away from a different answer, and the only way to be sure of that is for no floating-point value
 * to exist in the calculation at all. Scores are integer hundredths; weights are integer basis
 * points; the single division in the whole engine rounds explicitly.
 */

/**
 * The out-of-range invariant, in the one place a score can actually leave the scale.
 *
 * **A score outside the scale fails; it is never clamped.** Inside `scoreReview` the arithmetic
 * makes that unreachable — a weighted mean of values within a range is within that range — so the
 * guard that matters is this one, applied where a number arrives from outside the aggregation: an
 * assessed item, and a score a calibration session decided on. The engine keeps its own checks as
 * backstops and the report says plainly that they cannot be provoked.
 */
export const withinScale = (scale: RatingScaleBand, score: number): boolean =>
  score >= scale.minimumScore && score <= scale.maximumScore;

/**
 * Nearest, half away from zero, on exact integers.
 *
 * `(2|a| + |b|) / (2|b|)` under truncating integer division is `floor(|a/b| + 1/2)`, which is
 * "round half up in magnitude"; restoring the sign afterwards makes it "half away from zero". No
 * intermediate value is ever a fraction.
 */
export const divideRounded = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator === 0n) throw new Error('performance: a score cannot be divided by no weight');

  const negative = numerator < 0n !== denominator < 0n;
  const magnitude = (numerator < 0n ? -numerator : numerator) * 2n;
  const divisor = denominator < 0n ? -denominator : denominator;
  const rounded = (magnitude + divisor) / (divisor * 2n);

  return negative ? -rounded : rounded;
};

/**
 * Scores a review from its assessed items and the template's component weights.
 *
 * Refuses rather than approximating: components that do not total 10,000, a score outside the
 * scale, a scale with no level covering the result, and the case where nothing at all was
 * assessable are each a refusal naming what went wrong.
 */
export const scoreReview = (request: ScoringRequest): PerformanceResult<ScoreOutcome> => {
  const shape = validateShape(request);

  if (!shape.ok) return shape;

  const outcomes = request.components.map((component) => scoreComponent(component, request.scale));
  const invalid = outcomes.find((outcome) => !outcome.ok);

  if (invalid !== undefined && !invalid.ok)
    return refuse(invalid.error.reason, invalid.error.detail);

  const components = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.value] : []));

  return combine(components, request.scale);
};

/**
 * The component weights, and the one rule about them that is not arithmetic.
 *
 * They must total 10,000. A template that weights goals at 60% and competencies at 30% is not a
 * template that means 2:1 — it is a template somebody mis-entered, and scoring it would produce a
 * number nobody could account for.
 */
const validateShape = (request: ScoringRequest): PerformanceResult<true> => {
  if (request.components.length === 0) return refuse('scoring-no-components');

  const duplicated =
    new Set(request.components.map((component) => component.component)).size !==
    request.components.length;

  if (duplicated) return refuse('scoring-duplicate-component');

  const total = request.components.reduce(
    (running, component) => running + component.weightBasisPoints,
    0,
  );

  if (total !== MAX_BASIS_POINTS) {
    return refuse('scoring-component-weights-not-total', {
      total: String(total),
      required: String(MAX_BASIS_POINTS),
    });
  }

  if (request.scale.maximumScore <= request.scale.minimumScore)
    return refuse('scoring-scale-empty');
  if (request.scale.levels.length === 0) return refuse('scoring-scale-has-no-levels');

  return accept(true);
};

/** Whether a line participates, and the reason recorded when it does not. */
const participationOf = (item: ScoringItem, weighted: boolean): ExclusionReason | undefined => {
  if (item.exclusionReason !== undefined) return item.exclusionReason;
  if (item.score === undefined) return 'missing';
  if (weighted && item.weightBasisPoints === undefined) return 'incomplete';
  return undefined;
};

interface Participating {
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly excluded: readonly ExcludedItem[];
  readonly outOfRange?: string;
}

/**
 * The one aggregation, used for both components.
 *
 * A weighted component divides by the weights of the lines that were scored; an unweighted one
 * gives every scored line a whole unit, which is the unweighted mean written as the same
 * arithmetic. No weight is invented in either case: the unweighted path assigns nothing that
 * distinguishes one competency from another.
 */
const gather = (component: ScoringComponentInput, scale: RatingScaleBand): Participating => {
  const excluded: ExcludedItem[] = [];
  let numerator = 0n;
  let denominator = 0n;
  let outOfRange: string | undefined;

  for (const item of component.items) {
    const reason = participationOf(item, component.weighted);

    if (reason !== undefined) {
      excluded.push({ reference: item.reference, reason });
      continue;
    }

    const score = item.score ?? 0;

    if (!withinScale(scale, score)) {
      outOfRange ??= item.reference;
      continue;
    }

    const weight = BigInt(component.weighted ? (item.weightBasisPoints ?? 0) : MAX_BASIS_POINTS);

    numerator += BigInt(score) * weight;
    denominator += weight;
  }

  return { numerator, denominator, excluded, ...(outOfRange === undefined ? {} : { outOfRange }) };
};

const scoreComponent = (
  component: ScoringComponentInput,
  scale: RatingScaleBand,
): PerformanceResult<ComponentOutcome> => {
  const gathered = gather(component, scale);

  if (gathered.outOfRange !== undefined) {
    return refuse('scoring-item-out-of-range', {
      component: component.component,
      reference: gathered.outOfRange,
    });
  }

  if (gathered.denominator === 0n) {
    return accept(absent(component, gathered, absentReason(component, gathered)));
  }

  const score = Number(divideRounded(gathered.numerator, gathered.denominator));

  if (!withinScale(scale, score)) {
    return refuse('scoring-component-out-of-range', {
      component: component.component,
      score: String(score),
    });
  }

  return accept({
    component: component.component,
    weightBasisPoints: component.weightBasisPoints,
    included: true,
    score,
    denominatorBasisPoints: Number(gathered.denominator),
    excludedItems: gathered.excluded,
  });
};

/**
 * Which of the four reasons a component that scored nothing carries.
 *
 * Three genuinely different situations, and they must not collapse into one. A component with **no
 * lines at all** is `missing` — nobody assessed it. A component whose lines were all excluded
 * carries whatever reason they carried. A component that *was* assessed but whose weights come to
 * zero is `not_applicable`: the work was done and the arithmetic has nothing to divide by.
 *
 * Collapsing the first into the third was a defect this module's application suite found: a review
 * where the whole competency section was skipped reported that competencies did not apply, which
 * reads as a configuration choice rather than as work nobody did.
 */
const absentReason = (
  component: ScoringComponentInput,
  gathered: Participating,
): ExclusionReason => {
  if (component.items.length === 0) return 'missing';
  if (gathered.excluded.length > 0) return reasonOf(gathered);
  return 'not_applicable';
};

const reasonOf = (gathered: Participating): ExclusionReason => {
  const reasons = new Set(gathered.excluded.map((item) => item.reason));
  const [only] = [...reasons];

  return reasons.size === 1 && only !== undefined ? only : 'incomplete';
};

const absent = (
  component: ScoringComponentInput,
  gathered: Participating,
  reason: ExclusionReason,
): ComponentOutcome => ({
  component: component.component,
  weightBasisPoints: component.weightBasisPoints,
  included: false,
  exclusionReason: reason,
  denominatorBasisPoints: 0,
  excludedItems: gathered.excluded,
});

/**
 * The final score, from the component scores and the weights of the components that participated.
 *
 * The excluded components leave the denominator, exactly as an excluded goal leaves the goal
 * aggregate's. A review where every component was excluded is refused rather than scored at zero:
 * there is nothing to rate, and rating it anyway would put a number on work nobody assessed.
 */
const combine = (
  components: readonly ComponentOutcome[],
  scale: RatingScaleBand,
): PerformanceResult<ScoreOutcome> => {
  const included = components.filter((component) => component.included);

  if (included.length === 0) return refuse('scoring-nothing-assessed');

  const denominator = included.reduce(
    (running, component) => running + BigInt(component.weightBasisPoints),
    0n,
  );

  if (denominator === 0n) return refuse('scoring-included-components-weigh-nothing');

  const numerator = included.reduce(
    (running, component) =>
      running + BigInt(component.score ?? 0) * BigInt(component.weightBasisPoints),
    0n,
  );
  const score = Number(divideRounded(numerator, denominator));

  if (!withinScale(scale, score)) {
    return refuse('scoring-out-of-range', {
      score: String(score),
      minimum: String(scale.minimumScore),
      maximum: String(scale.maximumScore),
    });
  }

  const level = levelFor(scale, score);

  if (level === undefined) return refuse('scoring-no-rating-level', { score: String(score) });

  return accept({
    score,
    ratingLevelId: level.ratingLevelId,
    components: components.map((component) => withContribution(component, denominator)),
  });
};

const withContribution = (component: ComponentOutcome, denominator: bigint): ComponentOutcome => {
  if (!component.included || component.score === undefined) return component;

  return {
    ...component,
    contributedScore: Number(
      divideRounded(BigInt(component.score) * BigInt(component.weightBasisPoints), denominator),
    ),
  };
};

/**
 * The level whose band contains the score.
 *
 * Lowest ordinal first, so a score on the boundary of two adjacent bands takes the lower — a scale
 * whose bands overlap is a configuration question, and answering it by picking the higher would
 * quietly round somebody's rating up.
 */
export const levelFor = (scale: RatingScaleBand, score: number): RatingLevelBand | undefined =>
  [...scale.levels]
    .sort((left, right) => left.ordinal - right.ordinal)
    .find((level) => score >= level.minimumScore && score <= level.maximumScore);
