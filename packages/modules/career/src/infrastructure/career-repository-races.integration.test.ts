import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConcurrencyException,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openCareerFixture,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  HR,
  OTHER_EMPLOYMENT,
  OTHER_POSITION,
  aMembership,
  aNomination,
  aPath,
  aPlan,
  aPool,
  aReadinessLevel,
  aStage,
  aSuccessionPlan,
  anAssessment,
} from './career-states.js';

/**
 * Races, through the repositories, across **two real PostgreSQL connections**.
 *
 * Checkpoint 3 raced raw SQL and proved the indexes arbitrate. This races the *repositories*, which
 * is a different claim: that `insertIfAbsent` maps to `on conflict do nothing` rather than to a
 * read-then-write, that `updateRow` puts its version in the predicate rather than in a preceding
 * comparison, and that neither opens a transaction of its own that would commit early.
 *
 * **Two units of work, each on its own pool.** Two transactions on one pooled connection are the
 * same transaction, so a race written against a single unit of work proves only that a program doing
 * two things in order does them in order.
 *
 * **No sleeps.** Both writers begin before either commits, so the second is blocked on the first's
 * uncommitted index entry and PostgreSQL — not a timer — decides. A test that raced by waiting would
 * pass on a fast machine and fail on a loaded one, and would be proving the timer.
 *
 * **No constraint is disabled anywhere in this file.** A race that had to be helped is not a race.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career repository race suite');

suite('career repository races', () => {
  let fixture: CareerFixture;
  let second: UnitOfWork;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_races_role');
    second = fixture.secondUnitOfWork();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** The second connection, in the same tenant and under the same actor. */
  const onSecond = <TResult>(
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult> =>
    runInContext({ tenantId: TENANT_A, correlationId: uuidV7(), actor: HR }, () =>
      second.execute(work),
    );

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  /**
   * Both writers run at once. `allSettled` rather than `all`, because one is *expected* to lose and
   * `all` would discard the outcome this suite exists to read.
   */
  const race = <TResult>(
    first: () => Promise<TResult>,
    other: () => Promise<TResult>,
  ): Promise<PromiseSettledResult<TResult>[]> => Promise.allSettled([first(), other()]);

  describe('an `insertIfAbsent` race settles to one row and a convergent answer', () => {
    /**
     * Both callers are told the truth: one wrote, one did not. Neither throws.
     *
     * That is the shape convergence has to have — a retry that reported a conflict would make a lost
     * response indistinguishable from a duplicate act, and only one of those is a problem.
     */
    it('lets one active career plan through and tells the loser it did not write', async () => {
      const first = { ...aPlan(), status: 'active' as const };
      const other = { ...aPlan(), status: 'active' as const };
      const outcomes = await race(
        () => inA((transaction) => fixture.stores.plans.insertIfAbsent(transaction, first)),
        () => onSecond((transaction) => fixture.stores.plans.insertIfAbsent(transaction, other)),
      );
      const written = outcomes.filter(
        (outcome) => outcome.status === 'fulfilled' && outcome.value === true,
      );

      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);
      expect(written).toHaveLength(1);

      const stored = await inA((transaction) =>
        fixture.stores.plans.search(transaction, { status: 'active' }, { limit: 10, offset: 0 }),
      );

      expect(stored.total).toBe(1);
    });

    it('lets one nomination through when two managers submit at the same instant', async () => {
      const plan = aSuccessionPlan({ positionId: OTHER_POSITION });

      await inA((transaction) => fixture.stores.successionPlans.insertIfAbsent(transaction, plan));

      const first = aNomination(plan, { employmentId: OTHER_EMPLOYMENT });
      const other = aNomination(plan, { employmentId: OTHER_EMPLOYMENT });
      const outcomes = await race(
        () => inA((transaction) => fixture.stores.successors.insertIfAbsent(transaction, first)),
        () =>
          onSecond((transaction) => fixture.stores.successors.insertIfAbsent(transaction, other)),
      );

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value === true),
      ).toHaveLength(1);

      const counts = await inA((transaction) =>
        fixture.stores.successors.benchCountsOf(transaction, plan.successionPlanId),
      );

      expect(counts).toEqual({ nominated: 1, confirmed: 0 });
    });

    it('lets one open pool membership through', async () => {
      const pool = aPool('leadership');

      await inA((transaction) => fixture.stores.pools.insert(transaction, pool));

      const first = aMembership(pool, { employmentId: OTHER_EMPLOYMENT });
      const other = aMembership(pool, { employmentId: OTHER_EMPLOYMENT });
      const outcomes = await race(
        () => inA((transaction) => fixture.stores.memberships.insertIfAbsent(transaction, first)),
        () =>
          onSecond((transaction) => fixture.stores.memberships.insertIfAbsent(transaction, other)),
      );

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value === true),
      ).toHaveLength(1);
    });

    it('lets one active succession plan through for a position', async () => {
      const first = {
        ...aSuccessionPlan({ positionId: OTHER_POSITION }),
        status: 'active' as const,
      };
      const other = {
        ...aSuccessionPlan({ positionId: OTHER_POSITION }),
        status: 'active' as const,
      };
      const outcomes = await race(
        () =>
          inA((transaction) => fixture.stores.successionPlans.insertIfAbsent(transaction, first)),
        () =>
          onSecond((transaction) =>
            fixture.stores.successionPlans.insertIfAbsent(transaction, other),
          ),
      );

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value === true),
      ).toHaveLength(1);
    });
  });

  describe('a plain `insert` race raises rather than converging', () => {
    /**
     * Two paths claiming one code, and two levels claiming one ordinal.
     *
     * These use `insert` rather than `insertIfAbsent`, because a duplicate code is a *mistake* rather
     * than a retry: the application checks it and returns a conflict, and the index is the backstop
     * for the instant two administrators submit together. The loser therefore sees the driver's
     * unique violation rather than a `false`, which is the honest difference between "you raced" and
     * "you already did this".
     */
    it('refuses the second path to claim a code', async () => {
      const first = aPath({ code: 'future-leaders' });
      const other = aPath({ code: 'future-leaders' });
      const outcomes = await race(
        () => inA((transaction) => fixture.stores.paths.insert(transaction, first)),
        () => onSecond((transaction) => fixture.stores.paths.insert(transaction, other)),
      );
      const refused = outcomes.filter((outcome) => outcome.status === 'rejected');

      expect(refused).toHaveLength(1);
      expect(String((refused[0] as PromiseRejectedResult).reason)).toContain(
        'career_path_code_idx',
      );
    });

    it('refuses the second readiness level to claim an ordinal', async () => {
      const first = aReadinessLevel('ready-soon', 3);
      const other = aReadinessLevel('nearly-ready', 3);
      const outcomes = await race(
        () => inA((transaction) => fixture.stores.readinessLevels.insert(transaction, first)),
        () => onSecond((transaction) => fixture.stores.readinessLevels.insert(transaction, other)),
      );
      const refused = outcomes.filter((outcome) => outcome.status === 'rejected');

      expect(refused).toHaveLength(1);
      expect(String((refused[0] as PromiseRejectedResult).reason)).toContain(
        'career_readiness_level_ordinal_idx',
      );
    });

    it('refuses the second stage to claim a position on one path', async () => {
      const path = aPath({ code: 'staged' });

      await inA((transaction) => fixture.stores.paths.insert(transaction, path));

      const outcomes = await race(
        () => inA((transaction) => fixture.stores.paths.insertStage(transaction, aStage(path, 2))),
        () =>
          onSecond((transaction) => fixture.stores.paths.insertStage(transaction, aStage(path, 2))),
      );
      const refused = outcomes.filter((outcome) => outcome.status === 'rejected');

      expect(refused).toHaveLength(1);
      expect(String((refused[0] as PromiseRejectedResult).reason)).toContain(
        'career_stage_sequence_idx',
      );
    });
  });

  describe('a versioned amendment race', () => {
    /**
     * Two amendments from the same read. Exactly one wins, and the loser gets
     * `ConcurrencyException` — because the version is in the `where` clause of the update itself.
     *
     * A repository that read the row, compared the version and then wrote without the predicate
     * would let both through and silently lose the first amendment, which is the defect the
     * predicate exists to prevent.
     */
    it('lets one amendment through and refuses the other with a named exception', async () => {
      const plan = aPlan();

      await inA((transaction) => fixture.stores.plans.insertIfAbsent(transaction, plan));

      const outcomes = await race(
        () =>
          inA((transaction) =>
            fixture.stores.plans.update(transaction, { ...plan, notes: 'the first note' }, 1),
          ),
        () =>
          onSecond((transaction) =>
            fixture.stores.plans.update(transaction, { ...plan, notes: 'the second note' }, 1),
          ),
      );
      const refused = outcomes.filter((outcome) => outcome.status === 'rejected');

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyException);

      const after = await inA((transaction) =>
        fixture.stores.plans.byId(transaction, plan.careerPlanId),
      );

      // One amendment, one version bump. The loser wrote nothing at all.
      expect(after?.version).toBe(2);
      expect(['the first note', 'the second note']).toContain(after?.notes);
    });
  });

  describe('concurrent writes that do not conflict', () => {
    /**
     * Both succeed, and that matters as much as the refusals.
     *
     * A schema that refused these would be one where every uniqueness index was full rather than
     * partial, or where an over-broad lock serialized unrelated work. Two different people getting
     * career plans at the same moment is the ordinary case, not the exception.
     */
    it('lets two people get active career plans at the same instant', async () => {
      const mine = { ...aPlan(), status: 'active' as const };
      const theirs = { ...aPlan({ employmentId: OTHER_EMPLOYMENT }), status: 'active' as const };
      const outcomes = await race(
        () => inA((transaction) => fixture.stores.plans.insertIfAbsent(transaction, mine)),
        () => onSecond((transaction) => fixture.stores.plans.insertIfAbsent(transaction, theirs)),
      );

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value === true),
      ).toHaveLength(2);

      const stored = await inA((transaction) =>
        fixture.stores.plans.search(transaction, { status: 'active' }, { limit: 10, offset: 0 }),
      );

      expect(stored.total).toBe(2);
    });

    /** And two assessments about the same person on the same day: append-only has no uniqueness. */
    it('lets two readiness assessments about one person land together', async () => {
      const level = aReadinessLevel();

      await inA((transaction) => fixture.stores.readinessLevels.insert(transaction, level));

      const outcomes = await race(
        () =>
          inA((transaction) => fixture.stores.assessments.insert(transaction, anAssessment(level))),
        () =>
          onSecond((transaction) =>
            fixture.stores.assessments.insert(transaction, anAssessment(level)),
          ),
      );

      expect(outcomes.every((outcome) => outcome.status === 'fulfilled')).toBe(true);

      const history = await inA((transaction) =>
        fixture.stores.assessments.historyFor(transaction, aPlan().employmentId),
      );

      expect(history).toHaveLength(2);
    });
  });
});
