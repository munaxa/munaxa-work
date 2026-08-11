import { type TalentBand } from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import type { RatingLevelBand, RatingScaleBand } from './scoring.js';
import type { ReviewState } from './review.js';

/**
 * The nine-box placement: performance against potential, for one employment in one cycle.
 *
 * **Performance publishes a recommendation and changes nothing.** This placement modifies no
 * employment, triggers no promotion, moves no salary and writes to no other module. Career &
 * Succession (Phase 15) may pull it when it exists; it will not be pushed anywhere, and nothing
 * downstream is entitled to treat it as a decision (D-17, AD-005).
 *
 * **The two axes are not alike, and the model says so.** The performance band is *derived* from the
 * review's rating — it is arithmetic on a number this module already computed, and re-typing it
 * would let a placement disagree with the review it came from. The potential band is a human
 * judgement about the future, which nothing in this repository can compute, so it is supplied with
 * an assessor and a rationale attached.
 */

const AUTO_APPROVAL = 'system:auto-approval';

export interface TalentPlacementState {
  readonly talentPlacementId: string;
  readonly cycleId: string;
  readonly reviewId: string;
  readonly employmentId: string;
  readonly performanceBand: TalentBand;
  readonly potentialBand: TalentBand;
  readonly boxCode: string;
  readonly rationale?: string;
  readonly placedAt: Date;
  readonly placedBy: string;
  readonly version: number;
}

export interface RecordPlacementRequest {
  readonly talentPlacementId: string;
  readonly potentialBand: number;
  readonly rationale?: string;
  readonly placedAt: Date;
  readonly placedBy: string;
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

const isBand = (value: number): value is TalentBand => value === 1 || value === 2 || value === 3;

/**
 * The performance band, derived from where the review's rating sits on its own scale.
 *
 * The levels are split into three by ordinal rather than by score, because a scale's bands are
 * already the tenant's statement of what "low", "middle" and "high" mean on it. Splitting by score
 * instead would impose an even division on a scale a tenant deliberately made uneven.
 */
export const performanceBandOf = (
  scale: RatingScaleBand,
  ratingLevelId: string,
): PerformanceResult<TalentBand> => {
  const ordered = [...scale.levels].sort((left, right) => left.ordinal - right.ordinal);
  const position = ordered.findIndex(
    (level: RatingLevelBand) => level.ratingLevelId === ratingLevelId,
  );

  if (position < 0) return refuse('placement-rating-level-not-on-scale');
  if (ordered.length < 3)
    return refuse('placement-scale-too-narrow', {
      levels: String(ordered.length),
    });

  // Three equal parts of the ordered levels, lowest third first. Integer arithmetic throughout, as
  // everywhere else in this module.
  const third = Math.floor((position * 3) / ordered.length) + 1;

  return isBand(third) ? accept(third) : refuse('placement-band-out-of-range');
};

export const recordPlacement = (
  review: ReviewState,
  scale: RatingScaleBand,
  request: RecordPlacementRequest,
): PerformanceResult<TalentPlacementState> => {
  if (review.completedAt === undefined) return refuse('placement-review-not-completed');
  if (review.finalRatingLevelId === undefined) return refuse('review-not-yet-scored');
  if (request.placedBy === AUTO_APPROVAL) return refuse('placement-not-human');
  if (!isBand(request.potentialBand)) {
    return refuse('placement-potential-out-of-range', { band: String(request.potentialBand) });
  }

  const performance = performanceBandOf(scale, review.finalRatingLevelId);

  if (!performance.ok) return performance;

  return accept({
    talentPlacementId: request.talentPlacementId,
    cycleId: review.cycleId,
    reviewId: review.reviewId,
    employmentId: review.employmentId,
    performanceBand: performance.value,
    potentialBand: request.potentialBand,
    boxCode: boxCodeOf(performance.value, request.potentialBand),
    placedAt: request.placedAt,
    placedBy: request.placedBy,
    version: 1,
    ...optional('rationale', request.rationale),
  });
};

/**
 * The box, as a stable code rather than a label.
 *
 * `p2x3` is performance band 2, potential band 3. The nine familiar names — "star", "core player",
 * and the rest — are a tenant's vocabulary and a translator's problem, not this module's: shipping
 * them would be shipping a judgement about what those boxes mean about a person.
 */
export const boxCodeOf = (performanceBand: TalentBand, potentialBand: TalentBand): string =>
  `p${String(performanceBand)}x${String(potentialBand)}`;
