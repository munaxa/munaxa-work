import type { PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  EMPLOYEE_ID,
  PEER_ID,
  POSITION_ID,
  TENANT,
  applicationConnection,
  attempt,
  harnessFor,
  named,
  reasonOf,
  requireDatabaseInCi,
  send,
  upstream,
  type CrossModuleHarness,
} from './phase-fifteen-harness.js';

/**
 * What two people doing the same thing at the same time leaves behind, through the production
 * wiring.
 *
 * **Two harnesses, two connection pools, one database.** A race written against a single pool is not
 * a race: two transactions on one pooled connection are the same transaction, and the suite would be
 * proving that a program doing two things in order does them in order. Each harness here opens its
 * own pool, so the arbiter is PostgreSQL — a partial unique index and a version predicate — rather
 * than JavaScript's scheduler.
 *
 * **No sleeps, and nothing disabled.** The two commands are started together and awaited together;
 * whichever the database serializes second discovers the other's row. Every constraint, policy and
 * trigger is the one the migration installed, and the connections are the unprivileged role, so a
 * refusal here is a refusal production would give.
 *
 * The distinction the assertions turn on: **a retry converges, a stale write conflicts.** Nominating
 * the same person twice is somebody clicking twice — the second attempt must find the first
 * nomination and report it, not raise an error and not add a second name to the bench. Moving a plan
 * from a version that is no longer current is a *different* decision made on stale information, and
 * that must be refused.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 15 concurrency suite');

interface Nominated {
  readonly successorId: string;
  readonly created: boolean;
}

interface Joined {
  readonly membershipId: string;
  readonly created: boolean;
}

/**
 * Waits until `count` sessions of this role are queued on a lock at an `update career_plan`.
 * Polls PostgreSQL's own lock table rather than sleeping a fixed time, and gives up loudly.
 */
const waitForBlockedUpdates = async (
  client: PoolClient,
  count: number,
  deadline = Date.now() + 10_000,
): Promise<void> => {
  const { rows } = await client.query<{ waiting: number }>(
    `select count(*)::int as waiting
       from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where not l.granted and a.usename = current_user and a.query ilike 'update career_plan%'`,
  );
  const waiting = rows[0]?.waiting ?? 0;

  if (waiting >= count) return;
  if (Date.now() > deadline) throw new Error(`Only ${String(waiting)} of ${String(count)} queued.`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  return waitForBlockedUpdates(client, count, deadline);
};

suite('phase 15 — concurrency and convergence', () => {
  let first: CrossModuleHarness;
  let second: CrossModuleHarness;

  beforeAll(async () => {
    const connectionString = await applicationConnection();
    // One upstream world, so both connections confirm the same employments and positions.
    const facts = upstream();

    first = harnessFor({ facts, connectionString });
    second = harnessFor({ facts, connectionString });
  });

  afterAll(async () => {
    await first.close();
    await second.close();
  });

  beforeEach(async () => {
    await first.truncate();
  });

  const benchFor = async (): Promise<string> => {
    const created = await first.inTenant(TENANT, 'user:hr', () =>
      send<{ successionPlanId: string }>(first, {
        commandName: 'career.create-succession-plan',
        positionId: POSITION_ID,
      }),
    );

    return created.successionPlanId;
  };

  /**
   * The same nomination, twice, at the same instant, on two connections.
   *
   * One `insert` wins the partial unique index. The other's `insert ... on conflict do nothing`
   * writes nothing, reads the row that won, and reports it — same identifier, `created: false`. The
   * bench has one name on it, which is the only answer a succession review can act on.
   */
  it('converges when the same nomination is issued on two connections at once', async () => {
    const successionPlanId = await benchFor();

    const [mine, theirs] = await Promise.all([
      first.inTenant(TENANT, 'user:hr', () =>
        send<Nominated>(first, {
          commandName: 'career.nominate-successor',
          successionPlanId,
          employmentId: EMPLOYEE_ID,
        }),
      ),
      second.inTenant(TENANT, 'user:hr-2', () =>
        send<Nominated>(second, {
          commandName: 'career.nominate-successor',
          successionPlanId,
          employmentId: EMPLOYEE_ID,
        }),
      ),
    ]);

    // Exactly one of them created it, and both name the same nomination.
    expect([mine.created, theirs.created].filter(Boolean)).toHaveLength(1);
    expect(mine.successorId).toBe(theirs.successorId);

    const rows = await first.rowsIn<{ id: string }>(
      TENANT,
      `select id from career_successor
        where succession_plan_id = $1 and employment_id = $2 and withdrawn_on is null`,
      [successionPlanId, EMPLOYEE_ID],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(mine.successorId);
  });

  /** Sequential, which is the shape a retried request actually has. */
  it('converges when the same nomination is retried after the first has committed', async () => {
    const successionPlanId = await benchFor();
    const command = {
      commandName: 'career.nominate-successor',
      successionPlanId,
      employmentId: EMPLOYEE_ID,
    };

    const original = await first.inTenant(TENANT, 'user:hr', () => send<Nominated>(first, command));
    const retried = await second.inTenant(TENANT, 'user:hr', () =>
      send<Nominated>(second, command),
    );

    expect(original.created).toBe(true);
    expect(retried.created).toBe(false);
    expect(retried.successorId).toBe(original.successorId);
  });

  /** Two different people at once are two nominations — convergence must not swallow one. */
  it('keeps two different nominees when both are nominated at once', async () => {
    const successionPlanId = await benchFor();

    await Promise.all([
      first.inTenant(TENANT, 'user:hr', () =>
        send<Nominated>(first, {
          commandName: 'career.nominate-successor',
          successionPlanId,
          employmentId: EMPLOYEE_ID,
        }),
      ),
      second.inTenant(TENANT, 'user:hr-2', () =>
        send<Nominated>(second, {
          commandName: 'career.nominate-successor',
          successionPlanId,
          employmentId: PEER_ID,
        }),
      ),
    ]);

    const rows = await first.rowsIn<{ employment_id: string }>(
      TENANT,
      `select employment_id from career_successor
        where succession_plan_id = $1 and withdrawn_on is null`,
      [successionPlanId],
    );

    expect(rows.map((row) => row.employment_id).sort()).toEqual([EMPLOYEE_ID, PEER_ID].sort());
  });

  /** The same convergence, on the other aggregate that has it. */
  it('converges when the same pool membership is added on two connections at once', async () => {
    const { talentPoolId } = await first.inTenant(TENANT, 'user:hr', () =>
      send<{ talentPoolId: string }>(first, {
        commandName: 'career.create-pool',
        code: 'future-leaders',
        name: named('Future leaders', 'قادة المستقبل'),
        kind: 'leadership',
      }),
    );

    const [mine, theirs] = await Promise.all([
      first.inTenant(TENANT, 'user:hr', () =>
        send<Joined>(first, {
          commandName: 'career.add-to-pool',
          talentPoolId,
          employmentId: EMPLOYEE_ID,
          from: '2026-04-01',
        }),
      ),
      second.inTenant(TENANT, 'user:hr-2', () =>
        send<Joined>(second, {
          commandName: 'career.add-to-pool',
          talentPoolId,
          employmentId: EMPLOYEE_ID,
          from: '2026-04-01',
        }),
      ),
    ]);

    expect([mine.created, theirs.created].filter(Boolean)).toHaveLength(1);
    expect(mine.membershipId).toBe(theirs.membershipId);

    const rows = await first.rowsIn(
      TENANT,
      `select id from career_pool_membership
        where talent_pool_id = $1 and employment_id = $2 and to_date is null`,
      [talentPoolId, EMPLOYEE_ID],
    );

    expect(rows).toHaveLength(1);
  });

  /**
   * A stale version is not a retry, and must not converge: of two moves issued from version 1,
   * exactly one commits and the plan's version advances by exactly one.
   *
   * **How the second is refused depends on when PostgreSQL serializes it, and both ways are
   * correct.** The handler reads the plan, asks the domain whether the move is allowed, and only
   * then writes with the version predicate in the `update`'s own `where` clause:
   *
   * - If both transactions read version 1 before either writes, the second `update` waits for the
   *   first's row lock, re-checks `version = 1` against the committed row, matches nothing, and the
   *   repository throws `ConcurrencyException` (a 409), rolling the transaction back.
   * - If the second reads after the first committed, it reads the plan as already `active`, and the
   *   domain refuses `active -> active` (`plan-transition-refused`) before any write is attempted.
   *
   * Either way nothing is written twice. The two tests after this one force each interleaving, so
   * both paths are proven on every run rather than whichever one the scheduler happened to pick
   * (MW-073: this test once asserted only the first path and failed when CI produced the second).
   */
  const createPlan = async (): Promise<string> => {
    const { careerPlanId } = await first.inTenant(TENANT, 'user:hr', () =>
      send<{ careerPlanId: string }>(first, {
        commandName: 'career.create-plan',
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-03-01',
      }),
    );

    return careerPlanId;
  };

  const moveFromVersionOne = (careerPlanId: string) => ({
    commandName: 'career.move-plan',
    careerPlanId,
    to: 'active',
    expectedVersion: 1,
  });

  const STALE_VERSION = 'career_plan was modified by someone else';
  const ALREADY_MOVED = 'career.rejection.plan-transition-refused';

  type Outcome = PromiseSettledResult<Awaited<ReturnType<typeof attempt>>>;

  const committed = (outcome: Outcome): boolean =>
    outcome.status === 'fulfilled' && outcome.value.ok;

  /** The refusal each interleaving produces, or `undefined` for anything that is not a refusal. */
  const refusalOf = (outcome: Outcome): string | undefined => {
    if (outcome.status === 'rejected') {
      return String(outcome.reason).includes(STALE_VERSION) ? STALE_VERSION : undefined;
    }
    return outcome.value.ok ? undefined : reasonOf(outcome.value);
  };

  const expectMovedExactlyOnce = async (careerPlanId: string): Promise<void> => {
    const rows = await first.rowsIn<{ status: string; version: number }>(
      TENANT,
      `select status, version from career_plan where id = $1`,
      [careerPlanId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('active');
    expect(Number(rows[0]?.version)).toBe(2);
  };

  it('refuses the second of two moves issued from the same version', async () => {
    const careerPlanId = await createPlan();
    const move = moveFromVersionOne(careerPlanId);
    const outcomes = await Promise.allSettled([
      first.inTenant(TENANT, 'user:hr', () => attempt(first, move)),
      second.inTenant(TENANT, 'user:hr-2', () => attempt(second, move)),
    ]);

    expect(outcomes.filter(committed)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !committed(outcome)).map(refusalOf)).toEqual([
      expect.stringMatching(new RegExp(`^(${STALE_VERSION}|${ALREADY_MOVED})$`)),
    ]);
    await expectMovedExactlyOnce(careerPlanId);
  });

  it('refuses a move from a version that was already moved, without writing', async () => {
    const careerPlanId = await createPlan();
    const move = moveFromVersionOne(careerPlanId);

    const mine = await first.inTenant(TENANT, 'user:hr', () => attempt(first, move));
    const theirs = await second.inTenant(TENANT, 'user:hr-2', () => attempt(second, move));

    expect(mine.ok).toBe(true);
    expect(theirs.ok).toBe(false);
    expect(reasonOf(theirs)).toBe(ALREADY_MOVED);
    await expectMovedExactlyOnce(careerPlanId);
  });

  /**
   * Both read version 1, and both reach the `update` before either commits.
   *
   * A third connection holds the row lock (`select ... for update`, which a plain read does not
   * wait for), so both handlers read version 1 and then queue behind it at their `update`. Only
   * once PostgreSQL reports both waiting is the lock released; one update wins, and the other
   * re-evaluates its `version = 1` predicate against the committed row and matches nothing.
   */
  it('refuses the second of two moves that both read the same version', async () => {
    const careerPlanId = await createPlan();
    const move = moveFromVersionOne(careerPlanId);
    const holder = await first.pool.connect();

    try {
      await holder.query('begin');
      await holder.query(`select set_config('app.tenant_id', $1, true)`, [TENANT]);
      await holder.query(`select id from career_plan where id = $1 for update`, [careerPlanId]);

      const racing = Promise.allSettled([
        first.inTenant(TENANT, 'user:hr', () => attempt(first, move)),
        second.inTenant(TENANT, 'user:hr-2', () => attempt(second, move)),
      ]);

      await waitForBlockedUpdates(holder, 2);
      await holder.query('commit');

      const outcomes = await racing;

      expect(outcomes.filter(committed)).toHaveLength(1);
      expect(outcomes.filter((outcome) => !committed(outcome)).map(refusalOf)).toEqual([
        STALE_VERSION,
      ]);
    } finally {
      await holder.query('rollback');
      holder.release();
    }
    await expectMovedExactlyOnce(careerPlanId);
  });
});
