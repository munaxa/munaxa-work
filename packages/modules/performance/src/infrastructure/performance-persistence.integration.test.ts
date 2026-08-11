import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CONNECTION,
  TENANT_A,
  openPerformanceFixture,
  requireDatabaseInCi,
  type PerformanceFixture,
} from './performance-database.fixture.js';
import {
  aComponentScore,
  aCompetency,
  aCycle,
  aFramework,
  aGoal,
  aProgressEntry,
  aRatingScale,
  aReview,
  aTemplate,
} from './performance-fixtures.js';

/**
 * The round trip: an application value, written, read back, and identical.
 *
 * The assertions that earn their keep are the exact ones. **Every score in this module is an
 * integer number of hundredths and every weight an integer number of basis points**, so a value
 * that came back one apart would mean a rating told to somebody was not the rating that was
 * computed. The suite therefore asserts the bounds of the scale, a rounding-boundary value, and an
 * observed measurement above 2^53 — the smallest integer a JavaScript double cannot represent,
 * which is the value that catches an accidental `Number()` on the `bigint` path.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Performance persistence suite');

suite('performance persistence', () => {
  let fixture: PerformanceFixture;

  beforeAll(async () => {
    fixture = await openPerformanceFixture('performance_persistence_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('round-trips a rating scale with its levels, exactly', async () => {
    const scale = aRatingScale();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.ratingScales.insert(transaction, scale.scale, scale.levels),
    );

    const [read, levels] = await fixture.asTenant(TENANT_A, async (transaction) => [
      await fixture.stores.ratingScales.byId(transaction, scale.scale.ratingScaleId),
      await fixture.stores.ratingScales.levelsFor(transaction, scale.scale.ratingScaleId),
    ]);

    expect(read?.minimumScore).toBe(100);
    expect(read?.maximumScore).toBe(500);
    // A civil date read as a `Date` at the process's local midnight would be a day out on any
    // server west of UTC. The `to_char` alias is what keeps this exact.
    expect(read?.effectiveFrom.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(levels.map((level) => level.ordinal)).toEqual([1, 2, 3, 4]);
    expect(levels.map((level) => [level.minimumScore, level.maximumScore])).toEqual([
      [100, 199],
      [200, 299],
      [300, 399],
      [400, 500],
    ]);
  });

  it('keeps a competency’s absent weight absent, and a present one exact', async () => {
    const framework = aFramework(true);
    const weighted = aCompetency(framework.frameworkId, 'delivery', 7500);
    const unweightedFramework = { ...aFramework(false), code: 'behaviours' };
    const unweighted = aCompetency(unweightedFramework.frameworkId, 'collaboration');

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.frameworks.insert(transaction, framework);
      await fixture.stores.frameworks.insert(transaction, unweightedFramework);
      await fixture.stores.frameworks.insertCompetency(transaction, weighted, []);
      await fixture.stores.frameworks.insertCompetency(transaction, unweighted, []);
    });

    const [withWeights, without] = await fixture.asTenant(TENANT_A, async (transaction) => [
      await fixture.stores.frameworks.competenciesFor(transaction, framework.frameworkId),
      await fixture.stores.frameworks.competenciesFor(transaction, unweightedFramework.frameworkId),
    ]);

    expect(withWeights[0]?.weightBasisPoints).toBe(7500);
    // Absent, not zero. An unweighted framework's competency carries no weight at all, and a
    // mapper that produced 0 would let the engine divide by something nobody configured.
    expect(without[0]?.weightBasisPoints).toBeUndefined();
  });

  it('round-trips scores at the bounds of the scale and at a rounding boundary', async () => {
    const scale = aRatingScale();
    const template = aTemplate(scale.scale.ratingScaleId);
    const cycle = aCycle(template.template.templateId);
    const review = aReview(cycle.cycleId, scale.scale.ratingScaleId);
    const lowest = scale.levels[0];
    const highest = scale.levels[3];

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.ratingScales.insert(transaction, scale.scale, scale.levels);
      await fixture.stores.templates.insert(transaction, template.template, template.components);
      await fixture.stores.cycles.insert(transaction, cycle);
      await fixture.stores.reviews.insert(transaction, review);
    });

    const boundaries = [100, 101, 250, 301, 499, 500];

    for (const [index, score] of boundaries.entries()) {
      await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.reviews.update(
          transaction,
          { ...review, ...scoredAt(score, lowest, highest) },
          // The version rises by one on every successful write, so the expectation tracks it.
          index + 1,
        ),
      );

      const read = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.reviews.byId(transaction, review.reviewId),
      );

      expect(read?.calculatedScore).toBe(score);
      expect(read?.finalScore).toBe(score);
      expect(Number.isInteger(read?.calculatedScore)).toBe(true);
    }
  });

  it('round-trips a measurement larger than a double can represent', async () => {
    const scale = aRatingScale();
    const template = aTemplate(scale.scale.ratingScaleId);
    const cycle = aCycle(template.template.templateId);
    const goal = aGoal(cycle.cycleId);
    // 2^53 + 1: the smallest integer a JavaScript double cannot hold. `Number()` would return 2^53.
    const enormous = 9_007_199_254_740_993n;

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.ratingScales.insert(transaction, scale.scale, scale.levels);
      await fixture.stores.templates.insert(transaction, template.template, template.components);
      await fixture.stores.cycles.insert(transaction, cycle);
      await fixture.stores.goals.insert(transaction, goal);
      await fixture.stores.goalProgress.insert(transaction, aProgressEntry(goal.goalId, enormous));
    });

    const entries = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.goalProgress.forGoal(transaction, goal.goalId),
    );

    expect(entries[0]?.observedValue).toBe(enormous);
    expect(String(entries[0]?.observedValue)).toBe('9007199254740993');
  });

  it('round-trips the persisted working, including which lines left the denominator', async () => {
    const world = await aScoredWorld(fixture);
    const working = [
      aComponentScore(world.review.reviewId, 'goals', 360),
      aComponentScore(world.review.reviewId, 'competencies', 400),
    ];

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.componentScores.replace(transaction, world.review.reviewId, working),
    );

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.componentScores.forReview(transaction, world.review.reviewId),
    );

    expect(read.map((component) => component.score).sort()).toEqual([360, 400]);
    // The exclusions are stored, not derived. A rating explained years later must not depend on
    // assessment rows that may since have been re-scored.
    expect(read[0]?.excludedItems).toEqual([{ reference: 'goal-b', reason: 'cancelled' }]);
  });

  it('replaces the working on a rescore rather than accumulating two answers', async () => {
    const world = await aScoredWorld(fixture);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.componentScores.replace(transaction, world.review.reviewId, [
        aComponentScore(world.review.reviewId, 'goals', 300),
      ]),
    );
    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.componentScores.replace(transaction, world.review.reviewId, [
        aComponentScore(world.review.reviewId, 'goals', 400),
      ]),
    );

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.componentScores.forReview(transaction, world.review.reviewId),
    );

    expect(read).toHaveLength(1);
    expect(read[0]?.score).toBe(400);
  });
});

interface ScoredWorld {
  readonly scale: ReturnType<typeof aRatingScale>;
  readonly cycle: ReturnType<typeof aCycle>;
  readonly review: ReturnType<typeof aReview>;
}

/** A scale, a template, a cycle and one enrolled review — the world most assertions need. */
export const aScoredWorld = async (fixture: PerformanceFixture): Promise<ScoredWorld> => {
  const scale = aRatingScale();
  const template = aTemplate(scale.scale.ratingScaleId);
  const cycle = aCycle(template.template.templateId);
  const review = aReview(cycle.cycleId, scale.scale.ratingScaleId);

  await fixture.asTenant(TENANT_A, async (transaction) => {
    await fixture.stores.ratingScales.insert(transaction, scale.scale, scale.levels);
    await fixture.stores.templates.insert(transaction, template.template, template.components);
    await fixture.stores.cycles.insert(transaction, cycle);
    await fixture.stores.reviews.insert(transaction, review);
  });

  return { scale, cycle, review };
};

/** A score and the level it lands in, as one value so the loop stays a loop. */
const scoredAt = (
  score: number,
  lowest: { readonly ratingLevelId: string } | undefined,
  highest: { readonly ratingLevelId: string } | undefined,
): Record<string, number | string> => {
  const level = (score < 300 ? lowest : highest)?.ratingLevelId ?? '';

  return {
    calculatedScore: score,
    calculatedRatingLevelId: level,
    finalScore: score,
    finalRatingLevelId: level,
  };
};
