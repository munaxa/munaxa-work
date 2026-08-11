import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  openPerformanceFixture,
  requireDatabaseInCi,
  type PerformanceFixture,
} from './performance-database.fixture.js';
import {
  aCalibrationDecision,
  aCalibrationSession,
  aComponentScore,
  aCycle,
  aGoal,
  aGoalItem,
  aProgressEntry,
  aRatingScale,
  aReview,
  aSnapshot,
  aTemplate,
  anAssessment,
  someFeedback,
} from './performance-fixtures.js';

/**
 * What cannot be rewritten — proved through the repositories *and* through SQL the repositories
 * would never issue.
 *
 * **Every block asserts the permitted case beside the refusals.** That is the lesson Phase 12
 * learned the expensive way: two of its triggers turned out to refuse more than they should, and
 * the only reason anybody found out was a test that tried the legitimate operation. A trigger that
 * refuses too much is as much a defect as one that refuses too little.
 *
 * **No trigger is disabled and no constraint is relaxed to make a fixture easier.** Where a test
 * needs a row in a state the application would not create, it says so and the state is still one
 * the schema permits.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Performance immutability suite');

suite('performance immutability', () => {
  let fixture: PerformanceFixture;

  beforeAll(async () => {
    fixture = await openPerformanceFixture('performance_immutability_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('lets a draft assessment be edited, and freezes it on submission', async () => {
    const world = await aWorld(fixture);
    const assessment = anAssessment(world.review.reviewId);
    const goal = aGoal(world.cycle.cycleId);
    const item = aGoalItem(assessment.assessmentId, goal.goalId, 300);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.goals.insert(transaction, goal);
      await fixture.stores.assessments.insert(transaction, assessment);
      await fixture.stores.assessments.upsertItem(transaction, item);
    });

    // Permitted: a draft belongs to its author and may be rewritten freely.
    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assessments.upsertItem(transaction, { ...item, score: 450 }),
    );

    const edited = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assessments.itemsFor(transaction, assessment.assessmentId),
    );

    expect(edited[0]?.score).toBe(450);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assessments.update(
        transaction,
        {
          ...assessment,
          status: 'submitted',
          submittedAt: new Date('2027-01-10T09:00:00Z'),
          submittedBy: 'user:manager',
        },
        1,
      ),
    );

    // Refused through the repository…
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.assessments.upsertItem(transaction, { ...item, score: 500 }),
      ),
    ).rejects.toThrow();

    // …and refused through SQL no repository would issue.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update performance_assessment set overall_comment = $1 where id = $2`,
          ['Rewritten after the fact.', assessment.assessmentId],
        ),
      ),
    ).rejects.toThrow(/performance_assessment_immutable/u);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update performance_assessment_item set score = 500 where id = $1`, [
          item.assessmentItemId,
        ]),
      ),
    ).rejects.toThrow(/performance_assessment_item_immutable/u);
  });

  it('lets a review move, score and complete — and freezes it afterwards', async () => {
    const world = await aWorld(fixture);
    const level = world.scale.levels[2]?.ratingLevelId ?? '';
    const scored = {
      ...world.review,
      status: 'manager_assessment' as const,
      calculatedScore: 370,
      calculatedRatingLevelId: level,
      finalScore: 370,
      finalRatingLevelId: level,
      scoredAt: new Date('2027-01-10T09:00:00Z'),
    };

    // Permitted: an open review is scored and moved as often as the work requires.
    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.update(transaction, scored, 1),
    );

    const completed = {
      ...scored,
      status: 'completed' as const,
      completedAt: new Date('2027-01-20T09:00:00Z'),
      completedBy: 'user:hr',
    };

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.update(transaction, completed, 2),
    );

    // Permitted after completion: archival, and nothing else.
    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.update(
        transaction,
        { ...completed, status: 'archived', archivedAt: new Date('2027-06-01T09:00:00Z') },
        3,
      ),
    );

    const archived = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.byId(transaction, world.review.reviewId),
    );

    expect(archived?.status).toBe('archived');
    expect(archived?.finalScore).toBe(370);

    // Refused: the rating itself, from SQL, after completion.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update performance_review set final_score = 500 where id = $1`, [
          world.review.reviewId,
        ]),
      ),
    ).rejects.toThrow(/performance_review_immutable/u);

    // Refused: reopening. A completed review does not go back to being assessed.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update performance_review set status = 'manager_assessment' where id = $1`,
          [world.review.reviewId],
        ),
      ),
    ).rejects.toThrow(/performance_review_immutable/u);

    // Refused: a delete, from any path.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`delete from performance_review where id = $1`, [
          world.review.reviewId,
        ]),
      ),
    ).rejects.toThrow(/performance_review_immutable/u);
  });

  it('appends progress entries and refuses to rewrite one', async () => {
    const world = await aWorld(fixture);
    const goal = aGoal(world.cycle.cycleId);
    const first = aProgressEntry(goal.goalId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.goals.insert(transaction, goal);
      await fixture.stores.goalProgress.insert(transaction, first);
      // Permitted: a second entry. The trail is appended to, which is the whole point of it.
      await fixture.stores.goalProgress.insert(transaction, {
        ...aProgressEntry(goal.goalId),
        progressBasisPoints: 8000,
      });
    });

    const entries = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.goalProgress.forGoal(transaction, goal.goalId),
    );

    expect(entries).toHaveLength(2);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update performance_goal_progress set progress_basis_points = 10000 where id = $1`,
          [first.goalProgressId],
        ),
      ),
    ).rejects.toThrow(/performance_goal_progress_immutable/u);
  });

  it('records calibration decisions and refuses to rewrite one’s original score', async () => {
    const world = await aWorld(fixture);
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

    // Permitted: a session concludes, which is an update to the *session* and not to a decision.
    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.calibrationSessions.update(
        transaction,
        {
          ...session,
          status: 'concluded',
          concludedAt: new Date('2027-01-16T09:00:00Z'),
          concludedBy: 'user:director',
        },
        1,
      ),
    );

    // Refused: the "before" that makes the record worth keeping.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update performance_calibration_decision set original_score = 410 where id = $1`,
          [decision.calibrationDecisionId],
        ),
      ),
    ).rejects.toThrow(/performance_calibration_decision_immutable/u);
  });

  it('takes a snapshot once and refuses to rewrite it', async () => {
    const world = await aWorld(fixture);
    const level = world.scale.levels[2]?.ratingLevelId ?? '';
    const scored = {
      ...world.review,
      calculatedScore: 376,
      calculatedRatingLevelId: level,
      finalScore: 350,
      finalRatingLevelId: level,
    };
    const snapshot = aSnapshot(scored, world.scale, [
      aComponentScore(world.review.reviewId, 'goals', 360),
    ]);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.snapshots.insert(transaction, snapshot),
    );

    // Refused: a second snapshot for the same review.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.snapshots.insert(
          transaction,
          aSnapshot(scored, world.scale, [aComponentScore(world.review.reviewId, 'goals', 100)]),
        ),
      ),
    ).rejects.toThrow();

    // Refused: rewriting the one that exists.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update performance_review_snapshot set taken_by = $1 where id = $2`, [
          'user:somebody-else',
          snapshot.reviewSnapshotId,
        ]),
      ),
    ).rejects.toThrow(/performance_review_snapshot_immutable/u);
  });

  it('withdraws feedback but refuses to edit or remove it', async () => {
    const feedback = someFeedback();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.feedback.insert(transaction, feedback),
    );

    // Permitted: withdrawal, which is a soft delete and touches only the delete columns.
    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.feedback.withdraw(
        transaction,
        feedback.feedbackId,
        new Date('2026-07-01T09:00:00Z'),
        'user:manager',
      ),
    );

    // Refused: editing what somebody said.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update performance_feedback set body = $1 where id = $2`, [
          'Something else entirely.',
          feedback.feedbackId,
        ]),
      ),
    ).rejects.toThrow(/performance_feedback_immutable/u);

    // Refused: a hard delete.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`delete from performance_feedback where id = $1`, [
          feedback.feedbackId,
        ]),
      ),
    ).rejects.toThrow(/performance_feedback_immutable/u);
  });

  it('refuses a review completed by the auto-approver, at the table', async () => {
    const world = await aWorld(fixture);
    const level = world.scale.levels[2]?.ratingLevelId ?? '';

    // The check constraint, not the domain. Five modules refuse `system:auto-approval` in code;
    // this proves the table refuses it too, so a bulk path around the application cannot sign
    // somebody's review with nobody's name.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update performance_review
              set status = 'completed', completed_at = now(), completed_by = 'system:auto-approval',
                  final_score = 370, final_rating_level_id = $1
            where id = $2`,
          [level, world.review.reviewId],
        ),
      ),
    ).rejects.toThrow(/performance_review_completion_actor_check/u);
  });

  it('refuses a completed review with no rating, at the table', async () => {
    const world = await aWorld(fixture);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update performance_review
              set status = 'completed', completed_at = now(), completed_by = 'user:hr'
            where id = $1`,
          [world.review.reviewId],
        ),
      ),
    ).rejects.toThrow(/performance_review_completed_score_check/u);
  });
});

interface World {
  readonly scale: ReturnType<typeof aRatingScale>;
  readonly cycle: ReturnType<typeof aCycle>;
  readonly review: ReturnType<typeof aReview>;
}

const aWorld = async (fixture: PerformanceFixture): Promise<World> => {
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
