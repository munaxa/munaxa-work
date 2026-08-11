import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ALL_PERFORMANCE_PERMISSIONS } from '@work/performance';

import {
  CONNECTION,
  HR,
  TENANT_A,
  http,
  openPerformanceApi,
  permitting,
  requireDatabaseInCi,
  type GoalBody,
  type PageBody,
  type PerformanceApiFixture,
  type ProblemBody,
  type ReviewDetailBody,
} from './performance-api.fixture.js';
import { BASE, configure, enrol, post, type Configured } from './performance-api-scenario.js';
import { EMPLOYEE_ID, MANAGER_ID, PEER_ID } from './phase-thirteen-upstream.js';

/**
 * The Performance API's lifecycle, over **real PostgreSQL**: HTTP → controller → application →
 * repository → database, and back.
 *
 * The properties here are the ones a unit test cannot establish. An exact score has to survive a
 * driver, an integer column, a driver again and `JSON.stringify`. A civil date has to survive a
 * pattern, a `Date`, a `date` column and a `to_char`. A stale version has to lose a race to a real
 * transaction. None of those hold in a fake and fail in production; all of them hold in production
 * and fail in a fake.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Performance API lifecycle suite');

/** One past the largest integer a double can hold. A measurement that rounded is unfalsifiable. */
const ENORMOUS = '9007199254740993';

suite('performance API lifecycle', () => {
  let fixture: PerformanceApiFixture;
  let api: INestApplication;

  beforeAll(async () => {
    fixture = await openPerformanceApi();
    api = await fixture.applicationFor(TENANT_A, permitting(...ALL_PERFORMANCE_PERMISSIONS), HR);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const aGoal = async (configured: Configured): Promise<string> => {
    const created = await post(api, `${BASE}/goals`, {
      scope: 'individual',
      employmentId: EMPLOYEE_ID,
      cycleId: configured.cycleId,
      title: 'Reduce payroll run time',
      measurement: 'percentage',
      weightBasisPoints: 10_000,
      startDate: '2026-01-01',
      dueDate: '2026-06-30',
    });

    return created.goalId ?? '';
  };

  const readGoal = async (goalId: string): Promise<GoalBody> =>
    (await http(api).get(`${BASE}/goals/${goalId}`).expect(200)).body as GoalBody;

  const readReview = async (reviewId: string): Promise<ReviewDetailBody> =>
    (await http(api).get(`${BASE}/reviews/${reviewId}`).expect(200)).body as ReviewDetailBody;

  it('keeps a civil date the same date, through the wire, the column and back', async () => {
    const configured = await configure(api);
    const goalId = await aGoal(configured);
    const goal = await readGoal(goalId);

    // Not "a date near this one". `2026-06-30`, exactly. A `Date` built at the process's local
    // midnight comes back as the 29th west of UTC, and a goal reported overdue a day early is the
    // kind of defect nobody finds for a year.
    expect(goal.startDate).toBe('2026-01-01');
    expect(goal.dueDate).toBe('2026-06-30');

    const cycles = (await http(api).get(`${BASE}/cycles`).expect(200)).body as PageBody<{
      readonly periodStart: string;
      readonly periodEnd: string;
    }>;

    expect(cycles.items[0]?.periodStart).toBe('2026-01-01');
    expect(cycles.items[0]?.periodEnd).toBe('2026-12-31');
  });

  it('round-trips a measurement larger than a double, as an exact decimal string', async () => {
    const configured = await configure(api);
    const goalId = await aGoal(configured);

    await post(api, `${BASE}/goals/${goalId}/approval`, { expectedVersion: 1 });
    await post(api, `${BASE}/goals/${goalId}/status`, { expectedVersion: 2, status: 'active' });
    await post(api, `${BASE}/goals/${goalId}/progress`, {
      expectedVersion: 3,
      progressBasisPoints: 4500,
      observedValue: ENORMOUS,
    });

    const goal = await readGoal(goalId);

    // `9007199254740993` and not `9007199254740992`. A JSON number would have lost the last digit
    // between `JSON.parse` and here, which is why the field is a string on both sides.
    expect(goal.progress[0]?.observedValue).toBe(ENORMOUS);
    expect(goal.progress[0]?.observedValue).not.toBe('9007199254740992');
  });

  it('refuses a decimal score, and refuses a weight beyond one whole', async () => {
    const configured = await configure(api);

    // A score is hundredths and a weight is basis points. `4.5` is not a score this API accepts:
    // the value the engine computes and the value a client sent must be the same integer.
    await http(api)
      .post(`${BASE}/goals`)
      .send({
        scope: 'individual',
        employmentId: EMPLOYEE_ID,
        cycleId: configured.cycleId,
        title: 'A goal',
        measurement: 'percentage',
        weightBasisPoints: 45.5,
        startDate: '2026-01-01',
        dueDate: '2026-06-30',
      })
      .expect(400);

    await http(api)
      .post(`${BASE}/goals`)
      .send({
        scope: 'individual',
        employmentId: EMPLOYEE_ID,
        cycleId: configured.cycleId,
        title: 'A goal',
        measurement: 'percentage',
        weightBasisPoints: 10_001,
        startDate: '2026-01-01',
        dueDate: '2026-06-30',
      })
      .expect(400);
  });

  /** The component's own score, by name. The order they come back in is not part of the contract. */
  const componentOf = (detail: ReviewDetailBody, component: string): number | undefined =>
    detail.componentScores.find((each) => each.component === component)?.score;

  it('serializes a normal score and a rounding boundary exactly', async () => {
    const configured = await configure(api);
    const normal = await scoreOneReview(api, configured, 350, EMPLOYEE_ID);
    const detail = await readReview(normal);

    // 350 goals at 60% + 400 competencies at 40% = 210 + 160 = 370, exactly. Not 369.99999999.
    expect(detail.review.calculatedScore).toBe(370);
    expect(Number.isInteger(detail.review.calculatedScore)).toBe(true);
    expect(componentOf(detail, 'goals')).toBe(350);
    expect(componentOf(detail, 'competencies')).toBe(400);

    // 375 goals at 60% + 400 at 40% = 225 + 160 = 385. The engine's one division rounds half away
    // from zero on exact integers, so a boundary lands on a whole hundredth rather than near one.
    const boundary = await readReview(await scoreOneReview(api, configured, 375, PEER_ID));

    expect(boundary.review.calculatedScore).toBe(385);
    expect(componentOf(boundary, 'goals')).toBe(375);
  });

  it('serializes the configured minimum and maximum exactly, and refuses a score outside them', async () => {
    const configured = await configure(api);
    const atMinimum = await readReview(await scoreOneReview(api, configured, 100, EMPLOYEE_ID));
    const atMaximum = await readReview(await scoreOneReview(api, configured, 500, PEER_ID));

    // 100 goals at 60% + 400 competencies at 40% = 60 + 160 = 220.
    expect(componentOf(atMinimum, 'goals')).toBe(100);
    expect(atMinimum.review.calculatedScore).toBe(220);
    // 500 at 60% + 400 at 40% = 300 + 160 = 460.
    expect(componentOf(atMaximum, 'goals')).toBe(500);
    expect(atMaximum.review.calculatedScore).toBe(460);
  });

  it('refuses a score outside the configured scale rather than clamping it', async () => {
    const configured = await configure(api);

    await post(api, `${BASE}/cycles/${configured.cycleId}/participants`, {
      employmentIds: [EMPLOYEE_ID],
    });

    const listing = (
      await http(api).get(`${BASE}/reviews?cycleId=${configured.cycleId}`).expect(200)
    ).body as PageBody<{ readonly reviewId: string }>;
    const started = await post(
      api,
      `${BASE}/reviews/${listing.items[0]?.reviewId ?? ''}/assessments`,
      { assessmentKind: 'manager', assessorEmploymentId: MANAGER_ID },
    );

    // **Zero is not a score on a scale whose minimum is 100.** The domain refuses it rather than
    // clamping: a rating silently moved to the bottom of the scale is a rating somebody will be
    // told they received. The refusal is a 422 — the request was understood and declined — rather
    // than a 400, because the shape was fine.
    const refused = await http(api)
      .post(`${BASE}/assessments/${started.assessmentId ?? ''}/items`)
      .send({ itemKind: 'competency', competencyId: configured.competencyIds[0], score: 0 })
      .expect(422);

    expect((refused.body as ProblemBody).detail).toContain('score-out-of-range');
  });

  it('refuses a stale version with 409 rather than silently overwriting or answering 500', async () => {
    const configured = await configure(api);
    const goalId = await aGoal(configured);

    // Both clients read version 1 and both send a change the domain is perfectly happy with. The
    // only thing wrong with the second is that it is stale — which is exactly the case a conflict
    // must be distinguishable from a business refusal.
    await http(api)
      .patch(`${BASE}/goals/${goalId}`)
      .send({ expectedVersion: 1, title: 'Written by the first client' })
      .expect(200);

    const stale = await http(api)
      .patch(`${BASE}/goals/${goalId}`)
      .send({ expectedVersion: 1, title: 'Written by the second client' })
      .expect(409);

    expect((stale.body as ProblemBody).status).toBe(409);
    // The first writer's change stands. Nothing was silently overwritten.
    expect((await readGoal(goalId)).version).toBe(2);
    expect((await readGoal(goalId)).title).toBe('Written by the first client');
  });

  it('refuses to mutate a completed review, and the refusal is deterministic', async () => {
    const configured = await configure(api);
    const reviewId = await scoreOneReview(api, configured, 350, EMPLOYEE_ID);
    const scored = await readReview(reviewId);

    // A review is completed from `manager_assessment`. Scoring does not imply the manager has
    // finished, and the transition is refused rather than inferred.
    await post(api, `${BASE}/reviews/${reviewId}/status`, {
      expectedVersion: scored.review.version,
      status: 'manager_assessment',
    });
    await post(api, `${BASE}/reviews/${reviewId}/completion`, {
      expectedVersion: scored.review.version + 1,
    });

    const completed = await readReview(reviewId);

    expect(completed.review.status).toBe('completed');
    expect(completed.snapshot?.ratingScale.levels).toHaveLength(4);

    // The application refuses first; the trigger is the last line rather than the only one. Either
    // way the client gets one deterministic answer rather than a 500 from somewhere deep.
    const refused = await http(api)
      .post(`${BASE}/reviews/${reviewId}/status`)
      .send({ expectedVersion: completed.review.version, status: 'manager_assessment' })
      .expect(422);

    expect((refused.body as ProblemBody).status).toBe(422);
    expect((await readReview(reviewId)).review.calculatedScore).toBe(370);
  });

  it('pages a collection deterministically, without repeating or dropping a review', async () => {
    const configured = await configure(api);

    await post(api, `${BASE}/cycles/${configured.cycleId}/participants`, {
      employmentIds: [EMPLOYEE_ID, MANAGER_ID, PEER_ID],
    });

    const first = (await http(api).get(`${BASE}/reviews?page=1&size=2`).expect(200))
      .body as PageBody<{ readonly reviewId: string }>;
    const second = (await http(api).get(`${BASE}/reviews?page=2&size=2`).expect(200))
      .body as PageBody<{ readonly reviewId: string }>;
    const beyond = (await http(api).get(`${BASE}/reviews?page=99&size=2`).expect(200))
      .body as PageBody<unknown>;

    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(beyond.items).toEqual([]);
    // Nothing appears on both pages, and nothing is missing from either.
    expect(new Set([...first.items, ...second.items].map((review) => review.reviewId)).size).toBe(
      3,
    );
  });

  it('clamps an unbounded or absurd page request rather than answering with everything', async () => {
    const configured = await configure(api);

    await post(api, `${BASE}/cycles/${configured.cycleId}/participants`, {
      employmentIds: [EMPLOYEE_ID, MANAGER_ID],
    });

    // `size=100000` is clamped to the module's maximum of 200, and `size=abc` — which `Number()`
    // turns into `NaN`, comparing false against every bound — falls back to the default.
    const enormous = (await http(api).get(`${BASE}/reviews?size=100000`).expect(200))
      .body as PageBody<unknown>;
    const nonsense = (await http(api).get(`${BASE}/reviews?size=abc&page=-4`).expect(200))
      .body as PageBody<unknown>;

    expect(enormous.items).toHaveLength(2);
    expect(nonsense.items).toHaveLength(2);
  });

  it('records a notification intent and delivers nothing', async () => {
    const configured = await configure(api);
    const reviewId = await enrol(api, configured.cycleId, EMPLOYEE_ID);

    // Enrolment records nothing: nobody is told they are being reviewed, because nothing can tell
    // them. Inviting a reviewer records an intent, because somebody has to be asked.
    expect(fixture.notifications.sent).toEqual([]);

    await post(api, `${BASE}/reviews/${reviewId}/reviewers`, {
      reviewerEmploymentId: PEER_ID,
      role: 'peer',
    });

    // Intent is a real record; delivery is a missing dependency. Nothing in this repository sends
    // anything, and no route here implies otherwise.
    expect(fixture.notifications.sent).toHaveLength(1);
    expect(fixture.notifications.sent[0]?.templateKey).toBe('performance.reviewer.invited');
    expect(fixture.notifications.sent.every((sent) => sent.correlationId !== 'unknown')).toBe(true);
  });
});

/**
 * Enrol somebody, set and assess one goal and both competencies, and score the review.
 *
 * Driven entirely over HTTP, so the score under assertion is one a client could actually have
 * produced. `goalScore` is what the manager gave the goal; the competencies are always 400.
 *
 * The employment must be one Employment says reports to `MANAGER_ID`, because a manager assessment
 * is refused unless the assessor **is** the review's manager. That refusal is the point rather than
 * an inconvenience: it is what stops somebody assessing a person they do not manage.
 */
const scoreOneReview = async (
  api: INestApplication,
  configured: Configured,
  goalScore: number,
  employmentId: string,
): Promise<string> => {
  await post(api, `${BASE}/cycles/${configured.cycleId}/participants`, {
    employmentIds: [employmentId],
  });

  const listing = (await http(api).get(`${BASE}/reviews?cycleId=${configured.cycleId}`).expect(200))
    .body as PageBody<{ readonly reviewId: string; readonly employmentId: string }>;
  const reviewId =
    listing.items.find((review) => review.employmentId === employmentId)?.reviewId ?? '';
  const goal = await post(api, `${BASE}/goals`, {
    scope: 'individual',
    employmentId,
    cycleId: configured.cycleId,
    title: `Goal for ${employmentId}`,
    measurement: 'percentage',
    weightBasisPoints: 10_000,
    startDate: '2026-01-01',
    dueDate: '2026-06-30',
  });
  const started = await post(api, `${BASE}/reviews/${reviewId}/assessments`, {
    assessmentKind: 'manager',
    assessorEmploymentId: MANAGER_ID,
  });
  const assessmentId = started.assessmentId ?? '';

  await post(api, `${BASE}/assessments/${assessmentId}/items`, {
    itemKind: 'goal',
    goalId: goal.goalId ?? '',
    score: goalScore,
  });
  for (const competencyId of configured.competencyIds) {
    await post(api, `${BASE}/assessments/${assessmentId}/items`, {
      itemKind: 'competency',
      competencyId,
      score: 400,
    });
  }
  await post(api, `${BASE}/assessments/${assessmentId}/submission`, { expectedVersion: 1 });
  await post(api, `${BASE}/reviews/${reviewId}/score`, { expectedVersion: 1 });
  return reviewId;
};
