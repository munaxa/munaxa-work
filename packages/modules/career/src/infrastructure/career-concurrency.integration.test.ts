import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  OTHER_EMPLOYMENT,
  OTHER_POSITION,
  TENANT_A,
  openCareerFixture,
  refusalOf,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  insertMembership,
  insertPlan,
  insertPool,
  insertSuccessionPlan,
  insertSuccessor,
} from './career-fixtures.js';

/**
 * The invariants that are facts about a *set of rows*, arbitrated where they have to be.
 *
 * A domain guard cannot hold any of these. "One active plan per employment" is a read of every other
 * row followed by a write, and two managers can run it at the same instant: both read zero, both
 * write one, and the guard reported success to each of them. The arbiter has to be something that
 * sees both statements, which is a partial unique index.
 *
 * **Two connections, genuinely.** Two transactions on one pooled connection are the same
 * transaction, so a race written against a single connection proves only that a program doing two
 * things in order does them in order. Each test below opens the second transaction on its own pool.
 *
 * **No sleeps.** The mechanism is `begin` on both connections before either commits, so the second
 * writer is blocked on the first's uncommitted index entry and PostgreSQL — not a timer — decides
 * the outcome. A test that raced by waiting would pass on a fast machine and fail on a loaded one,
 * and would be proving the timer.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career concurrency suite');

suite('career concurrency', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_concurrency_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /**
   * Both writers start, then both commit. Exactly one survives, and the loser names the index.
   *
   * `Promise.allSettled` rather than `all`, because one of the two is *expected* to be rejected and
   * `all` would discard the refusal this test exists to read.
   */
  const race = async (
    write: (client: Parameters<Parameters<CareerFixture['asTenant']>[1]>[0]) => Promise<unknown>,
  ): Promise<{ accepted: number; refusals: string[] }> => {
    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, write),
      fixture.onSecondConnection(TENANT_A, write),
    ]);

    return {
      accepted: outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      refusals: outcomes
        .filter((outcome) => outcome.status === 'rejected')
        .map((outcome) => refusalOf(outcome.reason)),
    };
  };

  it('lets one of two simultaneous active plans through, and refuses the other', async () => {
    const outcome = await race((client) =>
      insertPlan(client, TENANT_A, { employmentId: OTHER_EMPLOYMENT, status: 'active' }),
    );

    expect(outcome.accepted).toBe(1);
    expect(outcome.refusals[0]).toContain('career_plan_active_idx');
  });

  /**
   * The specification's "Duplicate Successor Assignments" validation, where it belongs.
   *
   * A pre-check in the handler would let both nominations through when two managers submit at the
   * same instant, and the bench would show the same person twice.
   */
  it('refuses a duplicate nomination raced against itself', async () => {
    const planId = await fixture.asTenant(TENANT_A, (client) =>
      insertSuccessionPlan(client, TENANT_A, { positionId: OTHER_POSITION }),
    );
    const outcome = await race((client) =>
      insertSuccessor(client, TENANT_A, planId, { employmentId: OTHER_EMPLOYMENT }),
    );

    expect(outcome.accepted).toBe(1);
    expect(outcome.refusals[0]).toContain('career_successor_open_idx');
  });

  it('refuses a second open membership of the same pool raced against itself', async () => {
    const poolId = await fixture.asTenant(TENANT_A, (client) =>
      insertPool(client, TENANT_A, 'leadership'),
    );
    const outcome = await race((client) =>
      insertMembership(client, TENANT_A, poolId, { employmentId: OTHER_EMPLOYMENT }),
    );

    expect(outcome.accepted).toBe(1);
    expect(outcome.refusals[0]).toContain('career_pool_membership_open_idx');
  });

  it('refuses a second active succession plan for one position, raced', async () => {
    const outcome = await race((client) =>
      insertSuccessionPlan(client, TENANT_A, { positionId: OTHER_POSITION, status: 'active' }),
    );

    expect(outcome.accepted).toBe(1);
    expect(outcome.refusals[0]).toContain('career_succession_plan_active_idx');
  });

  it('refuses two pools claiming the same code, raced', async () => {
    const outcome = await race((client) => insertPool(client, TENANT_A, 'future-partners'));

    expect(outcome.accepted).toBe(1);
    expect(outcome.refusals[0]).toContain('career_talent_pool_code_idx');
  });

  describe('what the partial indexes deliberately permit', () => {
    /**
     * The index is *partial* for a reason, and a test that only proved the refusal would be
     * satisfied by a full unique index that also broke these three.
     */
    it('permits a second plan once the first has ended', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        await insertPlan(client, TENANT_A, {
          status: 'achieved',
          closedOn: '2026-05-01',
          closedBy: 'user:test',
        });
        await insertPlan(client, TENANT_A, { status: 'active' });
      });

      const plans = await fixture.asTenant(TENANT_A, (client) =>
        client.query<{ total: string }>(`select count(*) as total from career_plan`),
      );

      expect(Number(plans.rows[0]?.total ?? '0')).toBe(2);
    });

    /** Somebody taken off a bench may be put back on it. A withdrawal frees the slot. */
    it('permits a re-nomination after a withdrawal', async () => {
      const planId = await fixture.asTenant(TENANT_A, (client) =>
        insertSuccessionPlan(client, TENANT_A),
      );

      await fixture.asTenant(TENANT_A, async (client) => {
        await insertSuccessor(client, TENANT_A, planId, {
          status: 'withdrawn',
          withdrawnOn: '2026-05-01',
          withdrawnBy: 'user:head-of-hr',
          withdrawalReason: 'Took a role elsewhere',
        });
        await insertSuccessor(client, TENANT_A, planId, { status: 'nominated' });
      });

      const bench = await fixture.asTenant(TENANT_A, (client) =>
        client.query<{ status: string }>(`select status from career_successor order by status`),
      );

      expect(bench.rows.map((row) => row.status)).toEqual(['nominated', 'withdrawn']);
    });

    /** A person may rejoin a pool they left, and may be in two pools at once. */
    it('permits rejoining a pool after the membership ended', async () => {
      const poolId = await fixture.asTenant(TENANT_A, (client) => insertPool(client, TENANT_A));

      await fixture.asTenant(TENANT_A, async (client) => {
        await insertMembership(client, TENANT_A, poolId, {
          fromDate: '2026-01-05',
          toDate: '2026-03-31',
          removedBy: 'user:test',
        });
        await insertMembership(client, TENANT_A, poolId, { fromDate: '2026-09-01' });
      });

      const periods = await fixture.asTenant(TENANT_A, (client) =>
        client.query<{ total: string }>(`select count(*) as total from career_pool_membership`),
      );

      expect(Number(periods.rows[0]?.total ?? '0')).toBe(2);
    });

    /** A person may be a successor for more than one position (D-15). Uniqueness is per plan. */
    it('permits the same person on two positions’ benches', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const first = await insertSuccessionPlan(client, TENANT_A);
        const second = await insertSuccessionPlan(client, TENANT_A, {
          positionId: OTHER_POSITION,
        });

        await insertSuccessor(client, TENANT_A, first);
        await insertSuccessor(client, TENANT_A, second);
      });

      const bench = await fixture.asTenant(TENANT_A, (client) =>
        client.query<{ total: string }>(`select count(*) as total from career_successor`),
      );

      expect(Number(bench.rows[0]?.total ?? '0')).toBe(2);
    });
  });
});
