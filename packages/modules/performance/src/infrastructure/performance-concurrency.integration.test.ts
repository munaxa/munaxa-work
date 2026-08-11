import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runInContext, uuidV7, type Transaction, type UnitOfWork } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openPerformanceFixture,
  requireDatabaseInCi,
  type PerformanceFixture,
} from './performance-database.fixture.js';
import {
  PEER_EMPLOYMENT,
  aCalibrationDecision,
  aCalibrationSession,
  aCycle,
  aGoal,
  aRatingScale,
  aReview,
  aReviewerAssignment,
  aSnapshot,
  aTemplate,
  anAssessment,
} from './performance-fixtures.js';

/**
 * Races, settled by the database.
 *
 * **Two connections, always.** Two transactions on one pooled connection are the same transaction,
 * so a race written against a single unit of work proves nothing at all — it proves that a program
 * doing two things in order does them in order.
 *
 * The completion race is the one this checkpoint exists to prove. It also proves the *ordering* the
 * application checkpoint had to fix: the version-guarded update runs before the snapshot insert, so
 * the loser meets the optimistic version rather than the snapshot's unique index. Both refuse; only
 * one of them says anything a reader can act on.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Performance concurrency suite');

suite('performance concurrency', () => {
  let fixture: PerformanceFixture;
  let second: UnitOfWork;

  beforeAll(async () => {
    fixture = await openPerformanceFixture('performance_concurrency_role');
    second = fixture.onSecondConnection();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** The same work, on the *other* connection, in the same tenant. */
  const onSecond = <TResult>(
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult> =>
    runInContext({ tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:second' }, () =>
      second.execute(work),
    );

  it('completes a review exactly once when two managers race, and takes one snapshot', async () => {
    const world = await aScoredWorld(fixture);
    const completed = {
      ...world.scored,
      status: 'completed' as const,
      completedAt: new Date('2027-01-20T09:00:00Z'),
      completedBy: 'user:hr',
    };
    /** The corrected ordering: the version-guarded update first, the snapshot second. */
    const complete = (
      run: (work: (transaction: Transaction) => Promise<void>) => Promise<void>,
      by: string,
    ): Promise<void> =>
      run(async (transaction) => {
        await fixture.stores.reviews.update(transaction, { ...completed, completedBy: by }, 2);
        await fixture.stores.snapshots.insert(transaction, aSnapshot(completed, world.scale, []));
      });

    const settled = await Promise.allSettled([
      complete((work) => fixture.asTenant(TENANT_A, work), 'user:hr'),
      complete(onSecond, 'user:manager'),
    ]);

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const loser = settled.find((outcome) => outcome.status === 'rejected');

    // **The version is what refused, not the snapshot's unique index.** That is the corrected
    // ordering: a loser that met the index would fail naming a table nobody asked about.
    expect(String((loser as PromiseRejectedResult).reason)).toMatch(/modified by someone else/u);

    const [review, snapshot] = await fixture.asTenant(TENANT_A, async (transaction) => [
      await fixture.stores.reviews.byId(transaction, world.review.reviewId),
      await fixture.stores.snapshots.forReview(transaction, world.review.reviewId),
    ]);

    expect(review?.status).toBe('completed');
    expect(review?.version).toBe(3);
    expect(snapshot).toBeDefined();

    // One snapshot, and the historical result is intact.
    const count = await fixture.admin.query<{ total: string }>(
      `select count(*)::text as total from performance_review_snapshot where review_id = $1`,
      [world.review.reviewId],
    );

    expect(count.rows[0]?.total).toBe('1');
    expect(review?.finalScore).toBe(370);
  });

  it('lets one goal progress update win and refuses the other deterministically', async () => {
    const world = await aScoredWorld(fixture);
    const goal = aGoal(world.cycle.cycleId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.goals.insert(transaction, goal),
    );

    const settled = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.goals.update(transaction, { ...goal, progressBasisPoints: 5000 }, 1),
      ),
      onSecond((transaction) =>
        fixture.stores.goals.update(transaction, { ...goal, progressBasisPoints: 9000 }, 1),
      ),
    ]);

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.goals.byId(transaction, goal.goalId),
    );

    // One of the two, never a silent overwrite of the other. The version says which happened.
    expect([5000, 9000]).toContain(read?.progressBasisPoints);
    expect(read?.version).toBe(2);
  });

  it('closes a goal once when a completion and a cancellation race', async () => {
    const world = await aScoredWorld(fixture);
    const goal = aGoal(world.cycle.cycleId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.goals.insert(transaction, goal),
    );

    const settled = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.goals.update(
          transaction,
          {
            ...goal,
            status: 'achieved',
            finalScore: 400,
            closedAt: new Date('2026-12-31T09:00:00Z'),
            closedBy: 'user:manager',
          },
          1,
        ),
      ),
      onSecond((transaction) =>
        fixture.stores.goals.update(
          transaction,
          {
            ...goal,
            status: 'cancelled',
            closedAt: new Date('2026-12-31T09:00:00Z'),
            closedBy: 'user:hr',
            closureReason: 'Deprioritized',
          },
          1,
        ),
      ),
    ]);

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.goals.byId(transaction, goal.goalId),
    );

    // A goal ends one way. A race that let both through would leave a cancelled goal carrying a
    // score, which the sixth approved scoring decision forbids and a check constraint refuses.
    expect(['achieved', 'cancelled']).toContain(read?.status);
    if (read?.status === 'cancelled') expect(read.finalScore).toBeUndefined();
  });

  it('records one calibration decision per review per session, and keeps the original', async () => {
    const world = await aScoredWorld(fixture);
    const session = aCalibrationSession(world.cycle.cycleId);
    const level = world.scale.levels[3]?.ratingLevelId ?? '';

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.calibrationSessions.insert(transaction, session),
    );

    const settled = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.calibrationDecisions.insert(
          transaction,
          aCalibrationDecision(session.calibrationSessionId, world.review.reviewId, level),
        ),
      ),
      onSecond((transaction) =>
        fixture.stores.calibrationDecisions.insert(transaction, {
          ...aCalibrationDecision(session.calibrationSessionId, world.review.reviewId, level),
          calibratedScore: 500,
          decidedBy: 'user:someone-else',
        }),
      ),
    ]);

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const decisions = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.calibrationDecisions.forReview(transaction, world.review.reviewId),
    );

    expect(decisions).toHaveLength(1);
    // The original the engine produced is untouched by whichever decision won.
    expect(decisions[0]?.originalScore).toBe(370);
    expect(decisions[0]?.reason.length).toBeGreaterThan(0);
    expect(decisions[0]?.decidedBy.length).toBeGreaterThan(0);

    const review = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.byId(transaction, world.review.reviewId),
    );

    expect(review?.calculatedScore).toBe(370);
  });

  it('assigns a reviewer once when two invitations race', async () => {
    const world = await aScoredWorld(fixture);
    const assignment = aReviewerAssignment(world.review.reviewId, PEER_EMPLOYMENT);

    const settled = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.reviewers.insert(transaction, assignment),
      ),
      onSecond((transaction) =>
        fixture.stores.reviewers.insert(transaction, {
          ...assignment,
          reviewerAssignmentId: uuidV7(),
        }),
      ),
    ]);

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const held = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviewers.forReview(transaction, world.review.reviewId),
    );

    expect(held).toHaveLength(1);
  });

  it('accepts one response per reviewer when two submissions race', async () => {
    const world = await aScoredWorld(fixture);
    const assessment = anAssessment(world.review.reviewId, PEER_EMPLOYMENT, 'peer');

    const settled = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.assessments.insert(transaction, assessment),
      ),
      onSecond((transaction) =>
        fixture.stores.assessments.insert(transaction, {
          ...assessment,
          assessmentId: uuidV7(),
        }),
      ),
    ]);

    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);

    const held = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assessments.forReview(transaction, world.review.reviewId),
    );

    // One assessor, one kind, one response. The unique index settles it rather than a read-then-write.
    expect(held).toHaveLength(1);
  });

  it('enrols one review per employment when two enrolments race', async () => {
    const world = await aScoredWorld(fixture);
    const duplicate = aReview(world.cycle.cycleId, world.scale.scale.ratingScaleId);

    const settled = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.reviews.insert(transaction, duplicate),
      ),
      onSecond((transaction) =>
        fixture.stores.reviews.insert(transaction, { ...duplicate, reviewId: uuidV7() }),
      ),
    ]);

    // The first review already exists from `aScoredWorld`, so *both* of these are duplicates.
    expect(settled.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(0);

    const held = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.forCycle(transaction, world.cycle.cycleId),
    );

    expect(held).toHaveLength(1);
  });
});

interface ScoredWorld {
  readonly scale: ReturnType<typeof aRatingScale>;
  readonly cycle: ReturnType<typeof aCycle>;
  readonly review: ReturnType<typeof aReview>;
  readonly scored: ReturnType<typeof aReview>;
}

/** A world whose review has already been scored at 370, ready to be completed. */
const aScoredWorld = async (fixture: PerformanceFixture): Promise<ScoredWorld> => {
  const scale = aRatingScale();
  const template = aTemplate(scale.scale.ratingScaleId);
  const cycle = aCycle(template.template.templateId);
  const review = aReview(cycle.cycleId, scale.scale.ratingScaleId);
  const level = scale.levels[2]?.ratingLevelId ?? '';
  const scored = {
    ...review,
    status: 'manager_assessment' as const,
    calculatedScore: 370,
    calculatedRatingLevelId: level,
    finalScore: 370,
    finalRatingLevelId: level,
    scoredAt: new Date('2027-01-10T09:00:00Z'),
  };

  await fixture.asTenant(TENANT_A, async (transaction) => {
    await fixture.stores.ratingScales.insert(transaction, scale.scale, scale.levels);
    await fixture.stores.templates.insert(transaction, template.template, template.components);
    await fixture.stores.cycles.insert(transaction, cycle);
    await fixture.stores.reviews.insert(transaction, review);
    await fixture.stores.reviews.update(transaction, scored, 1);
  });

  return { scale, cycle, review, scored };
};
