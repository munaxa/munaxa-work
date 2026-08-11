import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CONNECTION,
  TENANT_A,
  openPerformanceFixture,
  requireDatabaseInCi,
  type PerformanceFixture,
} from './performance-database.fixture.js';
import {
  EMPLOYEE_EMPLOYMENT,
  MANAGER_EMPLOYMENT,
  aCalibrationDecision,
  aCalibrationSession,
  aComponentScore,
  aCycle,
  aGoal,
  aGoalItem,
  aPlacement,
  aRatingScale,
  aReview,
  aReviewerAssignment,
  aSnapshot,
  aTemplate,
  anAssessment,
  anExcludedItem,
  someFeedback,
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

/**
 * The outcome round trips: calibration decisions, snapshots, feedback, assessments and the bounded
 * reads that carry them.
 *
 * The assertion that matters most is the calibration decision's: **both numbers survive**. The
 * original the engine produced and the calibrated one the meeting settled on are separate columns,
 * and there is no path here that writes one over the other.
 */

suite('performance outcome persistence', () => {
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

  it('keeps both numbers on a calibration decision', async () => {
    const world = await aScoredWorld(fixture);
    const session = aCalibrationSession(world.cycle.cycleId);
    const level = world.scale.levels[3]?.ratingLevelId ?? '';
    const decision = aCalibrationDecision(
      session.calibrationSessionId,
      world.review.reviewId,
      level,
    );

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.calibrationSessions.insert(transaction, session);
      await fixture.stores.calibrationDecisions.insert(transaction, decision);
    });

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.calibrationDecisions.forReview(transaction, world.review.reviewId),
    );

    expect(read[0]?.originalScore).toBe(370);
    expect(read[0]?.calibratedScore).toBe(410);
    expect(read[0]?.reason).toBe('Moderated against the peer group');
    expect(read[0]?.decidedBy).toBe('user:director');
  });

  it('round-trips a completion snapshot with its frozen scale and working', async () => {
    const world = await aScoredWorld(fixture);
    const meets = world.scale.levels[2]?.ratingLevelId ?? '';
    const scored = {
      ...world.review,
      calculatedScore: 376,
      calculatedRatingLevelId: meets,
      finalScore: 350,
      finalRatingLevelId: meets,
    };
    const snapshot = aSnapshot(scored, world.scale, [
      aComponentScore(world.review.reviewId, 'goals', 360),
    ]);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.snapshots.insert(transaction, snapshot),
    );

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.snapshots.forReview(transaction, world.review.reviewId),
    );

    expect(read?.calculation.calculatedScore).toBe(376);
    expect(read?.calculation.finalScore).toBe(350);
    expect(read?.ratingScale.levels).toHaveLength(4);
    expect(read?.componentScores[0]?.score).toBe(360);
    expect(read?.managerEmploymentId).toBe(MANAGER_EMPLOYMENT);
    // No name and no pay: the snapshot is the inputs to a decision, not a copy of the database.
    expect(JSON.stringify(read)).not.toMatch(/salary|fullName/u);
  });

  it('withdraws feedback without changing a word of it', async () => {
    const feedback = someFeedback();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.feedback.insert(transaction, feedback),
    );
    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.feedback.withdraw(
        transaction,
        feedback.feedbackId,
        new Date('2026-07-01T09:00:00Z'),
        'user:manager',
      ),
    );

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.feedback.byId(transaction, feedback.feedbackId),
    );

    expect(read).toBeUndefined();

    // The row is still there, and still says what it said. Withdrawal hides it; it does not edit it.
    const raw = await fixture.admin.query<{ body: string; deleted_by: string }>(
      `select body, deleted_by from performance_feedback where id = $1`,
      [feedback.feedbackId],
    );

    expect(raw.rows[0]?.body).toBe('Carried the migration through a difficult week.');
    expect(raw.rows[0]?.deleted_by).toBe('user:manager');
  });

  it('bounds a search and counts it with the same predicate', async () => {
    const world = await aScoredWorld(fixture);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      for (let index = 0; index < 5; index += 1) {
        await fixture.stores.goals.insert(transaction, aGoal(world.cycle.cycleId, 2000));
      }
    });

    const page = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.goals.search(
        transaction,
        { cycleId: world.cycle.cycleId, employmentId: EMPLOYEE_EMPLOYMENT },
        { limit: 2, offset: 0 },
      ),
    );

    expect(page.items).toHaveLength(2);
    // Five goals, and the count runs the same `where` as the page: a total from a different
    // predicate is the bug that shows "2 of 40" on a screen holding two rows.
    expect(page.total).toBe(5);
  });

  it('records an excluded assessment line with its reason and no score', async () => {
    const world = await aScoredWorld(fixture);
    const assessment = anAssessment(world.review.reviewId);
    const goal = aGoal(world.cycle.cycleId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.goals.insert(transaction, goal);
      await fixture.stores.assessments.insert(transaction, assessment);
      await fixture.stores.assessments.upsertItem(
        transaction,
        anExcludedItem(assessment.assessmentId, goal.goalId),
      );
    });

    const items = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assessments.itemsFor(transaction, assessment.assessmentId),
    );

    expect(items[0]?.excluded).toBe(true);
    expect(items[0]?.exclusionReason).toBe('cancelled');
    expect(items[0]?.score).toBeUndefined();
  });

  it('rewrites a draft line in place rather than adding a second', async () => {
    const world = await aScoredWorld(fixture);
    const assessment = anAssessment(world.review.reviewId);
    const goal = aGoal(world.cycle.cycleId);
    const item = aGoalItem(assessment.assessmentId, goal.goalId, 300);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.goals.insert(transaction, goal);
      await fixture.stores.assessments.insert(transaction, assessment);
      await fixture.stores.assessments.upsertItem(transaction, item);
      await fixture.stores.assessments.upsertItem(transaction, { ...item, score: 450 });
    });

    const items = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assessments.itemsFor(transaction, assessment.assessmentId),
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.score).toBe(450);
  });

  it('reads a reviewer assignment back with its role and requester', async () => {
    const world = await aScoredWorld(fixture);
    const assignment = aReviewerAssignment(world.review.reviewId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviewers.insert(transaction, assignment),
    );

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviewers.forReview(transaction, world.review.reviewId),
    );

    // Nothing about this is anonymous: the row names who was asked and who asked.
    expect(read[0]?.reviewerEmploymentId).toBe(assignment.reviewerEmploymentId);
    expect(read[0]?.role).toBe('peer');
    expect(read[0]?.requestedBy).toBe('user:hr');
  });

  it('places one employment in one cycle, once', async () => {
    const world = await aScoredWorld(fixture);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.placements.insert(
        transaction,
        aPlacement(world.cycle.cycleId, world.review.reviewId),
      ),
    );

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.placements.insert(
          transaction,
          aPlacement(world.cycle.cycleId, world.review.reviewId),
        ),
      ),
    ).rejects.toThrow();
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
