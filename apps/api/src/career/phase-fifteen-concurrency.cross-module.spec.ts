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
   * A stale version is not a retry, and must not converge.
   *
   * Both callers read version 1 and both decide to move the plan. The second is acting on a state
   * that no longer exists by the time it writes, and the version predicate in the `update`'s own
   * `where` clause — not a read before it — is what refuses it.
   */
  it('refuses the second of two moves issued from the same version', async () => {
    const { careerPlanId } = await first.inTenant(TENANT, 'user:hr', () =>
      send<{ careerPlanId: string }>(first, {
        commandName: 'career.create-plan',
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-03-01',
      }),
    );

    const move = {
      commandName: 'career.move-plan',
      careerPlanId,
      to: 'active',
      expectedVersion: 1,
    };
    const outcomes = await Promise.allSettled([
      first.inTenant(TENANT, 'user:hr', () => attempt(first, move)),
      second.inTenant(TENANT, 'user:hr-2', () => attempt(second, move)),
    ]);

    /**
     * One committed; the other raised `ConcurrencyException` out of the repository's `update`.
     *
     * It is *thrown* rather than returned as a refusal because the shared `Repository` raises it
     * from inside the transaction, where returning a value would commit whatever else the command
     * had already written. The API layer turns it into a 409 — so a caller sees a conflict, and the
     * database saw a rollback.
     */
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(String(failed[0]?.status === 'rejected' ? failed[0].reason : '')).toContain(
      'career_plan was modified by someone else',
    );

    const rows = await first.rowsIn<{ status: string; version: number }>(
      TENANT,
      `select status, version from career_plan where id = $1`,
      [careerPlanId],
    );

    // And the plan moved exactly once.
    expect(rows[0]?.status).toBe('active');
    expect(Number(rows[0]?.version)).toBe(2);
  });
});
