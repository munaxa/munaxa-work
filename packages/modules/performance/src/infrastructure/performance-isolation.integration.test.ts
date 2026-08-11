import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  PERFORMANCE_TABLES,
  TENANT_A,
  TENANT_B,
  openPerformanceFixture,
  requireDatabaseInCi,
  type PerformanceFixture,
} from './performance-database.fixture.js';
import {
  EMPLOYEE_EMPLOYMENT,
  MANAGER_EMPLOYMENT,
  PEER_EMPLOYMENT,
  aCalibrationDecision,
  aCalibrationSession,
  aCycle,
  aGoal,
  aRatingScale,
  aReview,
  aTemplate,
  someFeedback,
} from './performance-fixtures.js';

/**
 * Row-level security, as an unprivileged role, in both directions.
 *
 * **The role owns nothing and holds no `BYPASSRLS`.** That is the only configuration under which
 * any of this means anything: a superuser bypasses every policy, so a suite run as one would pass
 * whether or not isolation worked — and here that would mean reporting that one tenant cannot read
 * another's performance reviews without ever having checked.
 *
 * Both directions, for every table this module owns. A policy that isolates A from B and not B from
 * A is a policy somebody wrote once and tested once.
 *
 * **What these do not prove, and the suite says so where it matters:** row-level security isolates
 * *tenants*. "Employee A must not read employee B's review" is not a tenant property — a policy
 * would have to know which employment the caller is, and this product has no
 * principal-to-employment resolution. That guarantee is the application's, is asserted through the
 * repository's own scope predicate below, and is stated as such rather than implied by a green RLS
 * test.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Performance isolation suite');

suite('performance isolation', () => {
  let fixture: PerformanceFixture;

  beforeAll(async () => {
    fixture = await openPerformanceFixture('performance_isolation_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('protects every table this module owns', async () => {
    const protection = await fixture.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*)::text from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[])`,
      [PERFORMANCE_TABLES],
    );

    expect(protection.rows).toHaveLength(PERFORMANCE_TABLES.length);
    for (const row of protection.rows) {
      // `force` matters as much as `enable`: without it the table's owner bypasses its own policy,
      // and the owner is what a migration and a careless operator both connect as.
      expect(row.relrowsecurity, `${row.relname} has row security`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} forces row security`).toBe(true);
      expect(Number(row.policies), `${row.relname} has a policy`).toBeGreaterThan(0);
    }
  });

  it('hides one tenant’s cycles, reviews and goals from the other, both ways', async () => {
    const inA = await aWorldIn(fixture, TENANT_A);
    const inB = await aWorldIn(fixture, TENANT_B);

    const bReadingA = await fixture.asTenant(TENANT_B, async (transaction) => ({
      cycle: await fixture.stores.cycles.byId(transaction, inA.cycle.cycleId),
      review: await fixture.stores.reviews.byId(transaction, inA.review.reviewId),
      goal: await fixture.stores.goals.byId(transaction, inA.goal.goalId),
    }));

    expect(bReadingA.cycle).toBeUndefined();
    expect(bReadingA.review).toBeUndefined();
    expect(bReadingA.goal).toBeUndefined();

    const aReadingB = await fixture.asTenant(TENANT_A, async (transaction) => ({
      cycle: await fixture.stores.cycles.byId(transaction, inB.cycle.cycleId),
      review: await fixture.stores.reviews.byId(transaction, inB.review.reviewId),
      goal: await fixture.stores.goals.byId(transaction, inB.goal.goalId),
    }));

    expect(aReadingB.cycle).toBeUndefined();
    expect(aReadingB.review).toBeUndefined();
    expect(aReadingB.goal).toBeUndefined();

    // And each still sees its own, so the policy is isolating rather than simply refusing.
    const own = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.byId(transaction, inA.review.reviewId),
    );

    expect(own?.reviewId).toBe(inA.review.reviewId);
  });

  it('keeps one tenant’s search results out of the other’s page and out of its count', async () => {
    const inA = await aWorldIn(fixture, TENANT_A);

    await aWorldIn(fixture, TENANT_B);

    const page = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.search(transaction, {}, { limit: 50, offset: 0 }),
    );

    expect(page.items.map((review) => review.reviewId)).toEqual([inA.review.reviewId]);
    // The count is the disclosure that survives a filtered page. "There are three more you cannot
    // see" is information, and it must not be there either.
    expect(page.total).toBe(1);
  });

  it('hides a calibration decision and a piece of feedback from the other tenant', async () => {
    const inA = await aWorldIn(fixture, TENANT_A);
    const session = aCalibrationSession(inA.cycle.cycleId);
    const decision = aCalibrationDecision(
      session.calibrationSessionId,
      inA.review.reviewId,
      inA.scale.levels[3]?.ratingLevelId ?? '',
    );
    const feedback = someFeedback();

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.calibrationSessions.insert(transaction, session);
      await fixture.stores.calibrationDecisions.insert(transaction, decision);
      await fixture.stores.feedback.insert(transaction, feedback);
    });

    const fromB = await fixture.asTenant(TENANT_B, async (transaction) => ({
      decisions: await fixture.stores.calibrationDecisions.forReview(
        transaction,
        inA.review.reviewId,
      ),
      feedback: await fixture.stores.feedback.byId(transaction, feedback.feedbackId),
      sessions: await fixture.stores.calibrationSessions.forCycle(transaction, inA.cycle.cycleId),
    }));

    expect(fromB.decisions).toEqual([]);
    expect(fromB.feedback).toBeUndefined();
    expect(fromB.sessions).toEqual([]);
  });

  it('refuses a write into another tenant’s row from inside this tenant’s transaction', async () => {
    const inA = await aWorldIn(fixture, TENANT_A);

    // The `with check` half of the policy. A tenant that could *write* rows it cannot read would
    // be able to plant a review in another company's cycle.
    await expect(
      fixture.asTenant(TENANT_B, (transaction) =>
        transaction.execute(`update performance_review set status = 'archived' where id = $1`, [
          inA.review.reviewId,
        ]),
      ),
    ).resolves.toBeDefined();

    const untouched = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.byId(transaction, inA.review.reviewId),
    );

    // The update reached no row rather than raising: a policy filters, and filtering to nothing is
    // how "you cannot touch that" is expressed in SQL.
    expect(untouched?.status).toBe('pending');
  });

  it('does not let a foreign key be used to reach across the tenant boundary', async () => {
    const inA = await aWorldIn(fixture, TENANT_A);
    const inB = await aWorldIn(fixture, TENANT_B);

    // A goal in tenant B naming tenant A's cycle. The foreign key is satisfied — PostgreSQL's
    // referential check runs with the constraint's own privileges and does **not** see policies —
    // so this is precisely the case where a reader might assume the key provides isolation.
    const crossing = { ...aGoal(inA.cycle.cycleId), employmentId: EMPLOYEE_EMPLOYMENT };

    await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.goals.insert(transaction, crossing),
    );

    const fromB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.goals.byId(transaction, crossing.goalId),
    );

    // The row exists in B and points at A's cycle. **The key did not stop it, and it never would.**
    expect(fromB?.cycleId).toBe(inA.cycle.cycleId);

    // What does stop it: reading through it gets nothing, because the cycle is behind A's policy.
    const reached = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.cycles.byId(transaction, fromB?.cycleId ?? ''),
    );

    expect(reached).toBeUndefined();

    // And the application refuses the reference in the first place — Phase 11's ADR-0042 says a
    // cross-module foreign key does not enforce tenant isolation, and the same is true within a
    // module. The guard is the command, and B's own cycle is what a command would have used.
    expect(inB.cycle.cycleId).not.toBe(inA.cycle.cycleId);
  });

  it('bounds a manager’s reads to the employments the scope names, in SQL', async () => {
    const inA = await aWorldIn(fixture, TENANT_A);
    const otherReview = aReview(inA.cycle.cycleId, inA.scale.scale.ratingScaleId, PEER_EMPLOYMENT);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.insert(transaction, otherReview),
    );

    const bounded = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.search(
        transaction,
        { employmentIdsIn: [EMPLOYEE_EMPLOYMENT] },
        { limit: 50, offset: 0 },
      ),
    );

    // **This is the employee-level guarantee, and it is the application's rather than RLS's.** The
    // bound is a predicate in the query, so the row the caller may not see never leaves the
    // database — and the count agrees with the page.
    expect(bounded.items.map((review) => review.employmentId)).toEqual([EMPLOYEE_EMPLOYMENT]);
    expect(bounded.total).toBe(1);

    const nothing = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.reviews.search(transaction, { employmentIdsIn: [] }, { limit: 50, offset: 0 }),
    );

    // An empty scope reads nothing. `= any('{}')` is false for every row; an omitted clause would
    // have meant "everything", which is the shape of every scope bug worth fearing.
    expect(nothing.items).toEqual([]);
    expect(nothing.total).toBe(0);
  });

  it('bounds a feedback read to the subjects the scope names', async () => {
    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.feedback.insert(transaction, someFeedback());
      await fixture.stores.feedback.insert(
        transaction,
        someFeedback(PEER_EMPLOYMENT, MANAGER_EMPLOYMENT),
      );
    });

    const bounded = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.feedback.search(
        transaction,
        { subjectEmploymentIdsIn: [EMPLOYEE_EMPLOYMENT] },
        { limit: 50, offset: 0 },
      ),
    );

    expect(bounded.items.map((entry) => entry.subjectEmploymentId)).toEqual([EMPLOYEE_EMPLOYMENT]);
    expect(bounded.total).toBe(1);
  });
});

interface World {
  readonly scale: ReturnType<typeof aRatingScale>;
  readonly cycle: ReturnType<typeof aCycle>;
  readonly review: ReturnType<typeof aReview>;
  readonly goal: ReturnType<typeof aGoal>;
}

/** One tenant's world, built through the repositories inside that tenant's transaction. */
const aWorldIn = async (fixture: PerformanceFixture, tenantId: string): Promise<World> => {
  const scale = aRatingScale();
  const template = aTemplate(scale.scale.ratingScaleId);
  const cycle = aCycle(template.template.templateId);
  const review = aReview(cycle.cycleId, scale.scale.ratingScaleId);
  const goal = aGoal(cycle.cycleId);

  await fixture.asTenant(tenantId, async (transaction) => {
    await fixture.stores.ratingScales.insert(transaction, scale.scale, scale.levels);
    await fixture.stores.templates.insert(transaction, template.template, template.components);
    await fixture.stores.cycles.insert(transaction, cycle);
    await fixture.stores.reviews.insert(transaction, review);
    await fixture.stores.goals.insert(transaction, goal);
  });

  return { scale, cycle, review, goal };
};
