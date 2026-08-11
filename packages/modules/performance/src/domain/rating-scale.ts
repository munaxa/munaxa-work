import { isEntityCode } from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';

/**
 * The scale a tenant rates against, and the bands on it.
 *
 * **This is not a grade.** `PositionView.grade` means a job's level and `compensation_pay_grade`
 * means a pay band; both already exist and both mean something else. A third meaning of the word
 * would make it useless in all three modules, so what a review earns is a *rating level* on a
 * *rating scale*, and the word `grade` appears nowhere in this module (D-7).
 *
 * Scores are hundredths throughout, so a 1–5 scale is `100`…`500`. The range is not decoration: a
 * calculated score outside it is a **failure**, not a value to clamp, and the scoring engine
 * enforces that against these numbers.
 *
 * The levels must tile the scale without a gap and without an overlap. A gap would let a legitimate
 * score correspond to no rating at all; an overlap would make the rating depend on which row was
 * read first. Both are configuration defects, and both are refused here rather than resolved
 * silently at the moment somebody's review is scored.
 */

export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

export interface RatingLevelState {
  readonly ratingLevelId: string;
  readonly ratingScaleId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly ordinal: number;
  readonly minimumScore: number;
  readonly maximumScore: number;
  readonly version: number;
}

export interface RatingScaleState {
  readonly ratingScaleId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly minimumScore: number;
  readonly maximumScore: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly active: boolean;
  readonly version: number;
}

export interface DefineRatingLevelRequest {
  readonly ratingLevelId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly ordinal: number;
  readonly minimumScore: number;
  readonly maximumScore: number;
}

export interface DefineRatingScaleRequest {
  readonly ratingScaleId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly minimumScore: number;
  readonly maximumScore: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly levels: readonly DefineRatingLevelRequest[];
}

export interface DefinedRatingScale {
  readonly scale: RatingScaleState;
  readonly levels: readonly RatingLevelState[];
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const defineRatingScale = (
  request: DefineRatingScaleRequest,
): PerformanceResult<DefinedRatingScale> => {
  const checked = validateScale(request);

  if (!checked.ok) return checked;

  const levels = [...request.levels]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((level) => ({
      ratingLevelId: level.ratingLevelId,
      ratingScaleId: request.ratingScaleId,
      code: level.code,
      name: level.name,
      ordinal: level.ordinal,
      minimumScore: level.minimumScore,
      maximumScore: level.maximumScore,
      version: 1,
      ...optional('description', level.description),
    }));

  return accept({
    scale: {
      ratingScaleId: request.ratingScaleId,
      code: request.code,
      name: request.name,
      minimumScore: request.minimumScore,
      maximumScore: request.maximumScore,
      effectiveFrom: request.effectiveFrom,
      active: true,
      version: 1,
      ...optional('description', request.description),
      ...optional('effectiveTo', request.effectiveTo),
    },
    levels,
  });
};

const validateScale = (request: DefineRatingScaleRequest): PerformanceResult<true> => {
  if (!isEntityCode(request.code))
    return refuse('rating-scale-code-invalid', { code: request.code });
  if (!Number.isInteger(request.minimumScore) || !Number.isInteger(request.maximumScore)) {
    // Hundredths, and hundredths are whole numbers. A fractional bound would be a float creeping
    // into the one calculation this module must never round twice.
    return refuse('rating-scale-bounds-not-whole');
  }
  if (request.maximumScore <= request.minimumScore) return refuse('rating-scale-range-empty');
  if (request.effectiveTo !== undefined && request.effectiveTo < request.effectiveFrom) {
    return refuse('rating-scale-period-inverted');
  }
  return validateLevels(request);
};

/**
 * The levels, checked as a set rather than one at a time.
 *
 * Every rule here is about the *set*: distinct codes, distinct ordinals, contiguous bands, and the
 * two ends meeting the scale's own bounds. None of them can be expressed as a check constraint —
 * a constraint cannot see the sibling rows — which is why they live here and are re-checked by the
 * reconciliation query rather than assumed.
 */
const validateLevels = (request: DefineRatingScaleRequest): PerformanceResult<true> => {
  const levels = [...request.levels].sort((left, right) => left.ordinal - right.ordinal);

  if (levels.length === 0) return refuse('rating-scale-has-no-levels');

  const codes = new Set(levels.map((level) => level.code));
  const ordinals = new Set(levels.map((level) => level.ordinal));

  if (codes.size !== levels.length) return refuse('rating-scale-level-codes-duplicated');
  if (ordinals.size !== levels.length) return refuse('rating-scale-level-ordinals-duplicated');
  if (levels.some((level) => !isEntityCode(level.code))) return refuse('rating-level-code-invalid');
  if (levels.some((level) => level.maximumScore < level.minimumScore)) {
    return refuse('rating-level-range-inverted');
  }

  return validateBands(levels, request);
};

const validateBands = (
  levels: readonly DefineRatingLevelRequest[],
  request: DefineRatingScaleRequest,
): PerformanceResult<true> => {
  const lowest = levels[0];
  const highest = levels[levels.length - 1];

  if (lowest === undefined || highest === undefined) return refuse('rating-scale-has-no-levels');
  if (
    lowest.minimumScore !== request.minimumScore ||
    highest.maximumScore !== request.maximumScore
  ) {
    return refuse('rating-scale-levels-do-not-span');
  }

  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1];
    const current = levels[index];

    if (previous === undefined || current === undefined) continue;
    // Contiguous to the hundredth. A gap leaves a legitimate score with no rating; an overlap makes
    // the rating depend on row order.
    if (current.minimumScore !== previous.maximumScore + 1) {
      return refuse('rating-scale-levels-not-contiguous', {
        ordinal: String(current.ordinal),
      });
    }
  }

  return accept(true);
};

/** Retiring a scale leaves every review already rated against it exactly as it was. */
export const retireRatingScale = (
  state: RatingScaleState,
  on: Date,
): PerformanceResult<RatingScaleState> => {
  if (!state.active) return refuse('rating-scale-already-retired');
  if (on < state.effectiveFrom) return refuse('rating-scale-period-inverted');

  return accept({ ...state, active: false, effectiveTo: on });
};
