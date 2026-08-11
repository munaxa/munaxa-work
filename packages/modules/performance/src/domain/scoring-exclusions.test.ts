import { describe, expect, it } from 'vitest';

import { scoreReview, type RatingScaleBand, type ScoringComponentInput } from './scoring.js';

/**
 * The golden cases for what a score leaves out, and for what it refuses to produce at all.
 *
 * The fifth and sixth approved scoring decisions live here: missing, incomplete and cancelled work
 * leaves the denominator with its reason recorded and never becomes a zero. So does the invariant
 * that accompanies the seven — a score outside the rating scale is a failure, never a clamp — and
 * the first decision's rule that component weights totalling anything but 10,000 are refused before
 * anything is scored.
 */

/** A 1–5 scale, in the hundredths every score in this module is stored in. */
const SCALE: RatingScaleBand = {
  minimumScore: 100,
  maximumScore: 500,
  levels: [
    { ratingLevelId: 'level-1', ordinal: 1, minimumScore: 100, maximumScore: 199 },
    { ratingLevelId: 'level-2', ordinal: 2, minimumScore: 200, maximumScore: 299 },
    { ratingLevelId: 'level-3', ordinal: 3, minimumScore: 300, maximumScore: 399 },
    { ratingLevelId: 'level-4', ordinal: 4, minimumScore: 400, maximumScore: 449 },
    { ratingLevelId: 'level-5', ordinal: 5, minimumScore: 450, maximumScore: 500 },
  ],
};

const goals = (
  items: ScoringComponentInput['items'],
  weightBasisPoints = 6000,
): ScoringComponentInput => ({ component: 'goals', weightBasisPoints, weighted: true, items });

const competencies = (
  items: ScoringComponentInput['items'],
  weightBasisPoints = 4000,
): ScoringComponentInput => ({
  component: 'competencies',
  weightBasisPoints,
  weighted: false,
  items,
});

describe('what does not participate', () => {
  it('excludes a goal nobody scored, and records that it was missing', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals(
          [
            { reference: 'goal-a', score: 400, weightBasisPoints: 5000 },
            { reference: 'goal-b', weightBasisPoints: 5000 },
          ],
          10_000,
        ),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    // 400, not 200. The unscored goal leaves the denominator; it does not become a zero.
    expect(scored.value.score).toBe(400);
    expect(scored.value.components[0]?.denominatorBasisPoints).toBe(5000);
    expect(scored.value.components[0]?.excludedItems).toEqual([
      { reference: 'goal-b', reason: 'missing' },
    ]);
  });

  it('excludes a cancelled goal entirely — no score, and no denominator weight', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals(
          [
            { reference: 'goal-a', score: 300, weightBasisPoints: 4000 },
            { reference: 'goal-b', exclusionReason: 'cancelled', weightBasisPoints: 6000 },
          ],
          10_000,
        ),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    expect(scored.value.score).toBe(300);
    expect(scored.value.components[0]?.denominatorBasisPoints).toBe(4000);
    expect(scored.value.components[0]?.excludedItems).toEqual([
      { reference: 'goal-b', reason: 'cancelled' },
    ]);
  });

  it('records a scored goal with no weight as incomplete rather than guessing one', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals(
          [
            { reference: 'goal-a', score: 300, weightBasisPoints: 10_000 },
            { reference: 'goal-b', score: 500 },
          ],
          10_000,
        ),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    expect(scored.value.score).toBe(300);
    expect(scored.value.components[0]?.excludedItems).toEqual([
      { reference: 'goal-b', reason: 'incomplete' },
    ]);
  });

  it('lets a zero-weight goal be scored and count for nothing', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals(
          [
            { reference: 'goal-a', score: 400, weightBasisPoints: 10_000 },
            { reference: 'goal-b', score: 100, weightBasisPoints: 0 },
          ],
          10_000,
        ),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    // The formula divides by the weights of the scored goals, and a weight of zero is a weight of
    // zero on both sides of the division. The goal is not excluded — it simply counts for nothing.
    expect(scored.value.score).toBe(400);
    expect(scored.value.components[0]?.excludedItems).toEqual([]);
  });

  it('excludes a whole component whose weights all come to nothing', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals([{ reference: 'goal-a', score: 100, weightBasisPoints: 0 }]),
        competencies([{ reference: 'competency-a', score: 450 }]),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    expect(scored.value.components[0]?.included).toBe(false);
    expect(scored.value.components[0]?.exclusionReason).toBe('not_applicable');
    // The goals component leaves the final denominator too, so the competency score stands alone
    // rather than being diluted by a component that measured nothing.
    expect(scored.value.score).toBe(450);
    expect(scored.value.ratingLevelId).toBe('level-5');
  });

  it('excludes an incomplete component from the final denominator', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals([{ reference: 'goal-a', weightBasisPoints: 10_000 }]),
        competencies([{ reference: 'competency-a', score: 320 }]),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    expect(scored.value.components[0]?.exclusionReason).toBe('missing');
    expect(scored.value.components[0]?.contributedScore).toBeUndefined();
    // 320, not 128. Sixty percent of the review was not assessed, and the forty percent that was
    // is what the rating rests on.
    expect(scored.value.score).toBe(320);
  });

  it('refuses to rate a review where nothing at all was assessed', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals([{ reference: 'goal-a', weightBasisPoints: 5000 }]),
        competencies([{ reference: 'competency-a', exclusionReason: 'not_applicable' }]),
      ],
    });

    expect(scored.ok).toBe(false);
    if (scored.ok) return;

    // Not zero, and not the bottom of the scale. There is nothing to rate.
    expect(scored.error.reason).toBe('scoring-nothing-assessed');
  });
});

describe('what is refused', () => {
  it('refuses component weights that do not total 10,000', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals([{ reference: 'goal-a', score: 300, weightBasisPoints: 10_000 }], 6000),
        competencies([{ reference: 'competency-a', score: 300 }], 3000),
      ],
    });

    expect(scored.ok).toBe(false);
    if (scored.ok) return;

    expect(scored.error.reason).toBe('scoring-component-weights-not-total');
    expect(scored.error.detail).toEqual({ total: '9000', required: '10000' });
  });

  it('refuses a score outside the scale rather than clamping it', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [goals([{ reference: 'goal-a', score: 600, weightBasisPoints: 10_000 }], 10_000)],
    });

    expect(scored.ok).toBe(false);
    if (scored.ok) return;

    // The invariant that accompanies the seven decisions. A clamp here would have produced 500 —
    // a wrong rating that looks right, and one somebody would be told was theirs.
    expect(scored.error.reason).toBe('scoring-item-out-of-range');
    expect(scored.error.detail).toEqual({ component: 'goals', reference: 'goal-a' });
  });

  it('refuses a score below the scale as readily as one above it', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [goals([{ reference: 'goal-a', score: 0, weightBasisPoints: 10_000 }], 10_000)],
    });

    expect(scored.ok).toBe(false);
    if (scored.ok) return;

    expect(scored.error.reason).toBe('scoring-item-out-of-range');
  });

  it('refuses a score that falls in a gap between two rating levels', () => {
    const gapped: RatingScaleBand = {
      minimumScore: 100,
      maximumScore: 500,
      levels: [
        { ratingLevelId: 'low', ordinal: 1, minimumScore: 100, maximumScore: 199 },
        { ratingLevelId: 'high', ordinal: 2, minimumScore: 300, maximumScore: 500 },
      ],
    };
    const scored = scoreReview({
      scale: gapped,
      components: [goals([{ reference: 'goal-a', score: 250, weightBasisPoints: 10_000 }], 10_000)],
    });

    expect(scored.ok).toBe(false);
    if (scored.ok) return;

    // A scale with a hole in it is a configuration defect, and rounding somebody into the nearest
    // band would hide it behind a rating.
    expect(scored.error.reason).toBe('scoring-no-rating-level');
  });

  it('refuses a duplicated component and an empty one', () => {
    const duplicated = scoreReview({
      scale: SCALE,
      components: [
        goals([{ reference: 'goal-a', score: 300, weightBasisPoints: 10_000 }], 5000),
        goals([{ reference: 'goal-b', score: 300, weightBasisPoints: 10_000 }], 5000),
      ],
    });

    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.error.reason).toBe('scoring-duplicate-component');

    const empty = scoreReview({ scale: SCALE, components: [] });

    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.reason).toBe('scoring-no-components');
  });
});

describe('the working', () => {
  it('reports each component’s weighted share alongside the score', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals([{ reference: 'goal-a', score: 300, weightBasisPoints: 10_000 }]),
        competencies([{ reference: 'competency-a', score: 400 }]),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    // 300 × 6000 ÷ 10000 = 180, and 400 × 4000 ÷ 10000 = 160. They come to the final 340, which is
    // what makes the number explainable to the person it belongs to.
    expect(scored.value.components[0]?.contributedScore).toBe(180);
    expect(scored.value.components[1]?.contributedScore).toBe(160);
    expect(scored.value.score).toBe(340);
  });
});
