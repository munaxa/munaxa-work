import { describe, expect, it } from 'vitest';

import {
  divideRounded,
  levelFor,
  scoreReview,
  withinScale,
  type RatingScaleBand,
  type ScoringComponentInput,
} from './scoring.js';

/**
 * The golden cases for the approved D-6 semantics.
 *
 * Every number below was worked out by hand from the decisions as approved, and the expectation is
 * written as the arithmetic rather than as a magic constant, so a reader can check the engine
 * against the decision without running anything. That matters more here than anywhere else in the
 * module: this file is the only place the difference between a fair rating and an unfair one is
 * decided, and a test that merely asserts "it returns a number" would let any of these cases regress
 * silently.
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

describe('rounding', () => {
  it('rounds to nearest, and takes a half away from zero', () => {
    // The whole of the fourth decision, in six lines. 100.5 goes to 101 and −100.5 to −101; the
    // half never goes to the even neighbour and never goes toward zero.
    expect(divideRounded(201n, 2n)).toBe(101n);
    expect(divideRounded(203n, 2n)).toBe(102n);
    expect(divideRounded(-201n, 2n)).toBe(-101n);
    expect(divideRounded(202n, 2n)).toBe(101n);
    expect(divideRounded(200n, 3n)).toBe(67n);
    expect(divideRounded(100n, 3n)).toBe(33n);
  });

  it('refuses to divide by no weight rather than returning a number', () => {
    expect(() => divideRounded(100n, 0n)).toThrow(/no weight/);
  });
});

describe('scoring a review', () => {
  it('weights the goal aggregate by the weights of the scored goals', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals([
          { reference: 'goal-a', score: 400, weightBasisPoints: 5000 },
          { reference: 'goal-b', score: 300, weightBasisPoints: 5000 },
        ]),
        competencies([
          { reference: 'competency-a', score: 450 },
          { reference: 'competency-b', score: 350 },
          { reference: 'competency-c', score: 400 },
        ]),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    // Goals: (400 × 5000 + 300 × 5000) ÷ 10000 = 350. Competencies, unweighted: (450 + 350 + 400)
    // ÷ 3 = 400. Final: (350 × 6000 + 400 × 4000) ÷ 10000 = 370.
    expect(scored.value.components[0]?.score).toBe(350);
    expect(scored.value.components[1]?.score).toBe(400);
    expect(scored.value.score).toBe(370);
    expect(scored.value.ratingLevelId).toBe('level-3');
  });

  it('takes an unweighted competency framework as a plain mean, inventing no weight', () => {
    const scored = scoreReview({
      scale: SCALE,
      components: [
        goals([{ reference: 'goal-a', score: 300, weightBasisPoints: 10_000 }], 5000),
        // Deliberately uneven: a mean that happens to be exact would not show whether anything was
        // weighted. (100 + 101) ÷ 2 = 100.5, which the fourth decision rounds to 101.
        competencies(
          [
            { reference: 'competency-a', score: 100 },
            { reference: 'competency-b', score: 101 },
          ],
          5000,
        ),
      ],
    });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    expect(scored.value.components[1]?.score).toBe(101);
    // Every scored competency counts as one whole unit, so the denominator is two of them.
    expect(scored.value.components[1]?.denominatorBasisPoints).toBe(20_000);
    // Final: (300 × 5000 + 101 × 5000) ÷ 10000 = 200.5 → 201.
    expect(scored.value.score).toBe(201);
  });

  it('uses framework weights where the framework carries them', () => {
    const weighted: ScoringComponentInput = {
      component: 'competencies',
      weightBasisPoints: 10_000,
      weighted: true,
      items: [
        { reference: 'competency-a', score: 500, weightBasisPoints: 7500 },
        { reference: 'competency-b', score: 100, weightBasisPoints: 2500 },
      ],
    };
    const scored = scoreReview({ scale: SCALE, components: [weighted] });

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    // (500 × 7500 + 100 × 2500) ÷ 10000 = 400. An unweighted mean would have been 300, which is
    // the point of the assertion.
    expect(scored.value.score).toBe(400);
    expect(scored.value.ratingLevelId).toBe('level-4');
  });

  it('scores the minimum and the maximum of the scale', () => {
    const at = (score: number): number | undefined => {
      const scored = scoreReview({
        scale: SCALE,
        components: [goals([{ reference: 'goal-a', score, weightBasisPoints: 10_000 }], 10_000)],
      });

      return scored.ok ? scored.value.score : undefined;
    };

    expect(at(100)).toBe(100);
    expect(at(500)).toBe(500);
  });
});

describe('the scale', () => {
  it('answers whether a score is inside it, and takes the lower of two adjacent bands', () => {
    expect(withinScale(SCALE, 100)).toBe(true);
    expect(withinScale(SCALE, 500)).toBe(true);
    expect(withinScale(SCALE, 99)).toBe(false);
    expect(withinScale(SCALE, 501)).toBe(false);
    expect(levelFor(SCALE, 199)?.ratingLevelId).toBe('level-1');
    expect(levelFor(SCALE, 200)?.ratingLevelId).toBe('level-2');
    expect(levelFor(SCALE, 449)?.ratingLevelId).toBe('level-4');
  });
});
