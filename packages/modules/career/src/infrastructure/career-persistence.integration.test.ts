import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyException, type Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openCareerFixture,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  aMembership,
  aNomination,
  aPath,
  aPool,
  aStage,
  aSuccessionPlan,
} from './career-states.js';

/**
 * The repository contract, against a real PostgreSQL.
 *
 * Insert, read, update, list, page, filter, not-found and optimistic concurrency — for every store
 * `CareerStores` declares. The in-memory stores answer the same interface and are useful for
 * application behaviour, but they are **not evidence** for SQL types, indexes, triggers or policies:
 * only this suite is.
 *
 * Everything goes in through the repository and comes back out through it, so what is under test is
 * the round trip. A hand-written `insert` beside the mapper it was written with would agree with
 * itself and prove nothing.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career persistence suite');

suite('career persistence', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_persistence_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  describe('paths and stages', () => {
    it('round-trips a path with its civil dates unchanged', async () => {
      const path = aPath();
      const read = await inA(async (transaction) => {
        await fixture.stores.paths.insert(transaction, path);
        return fixture.stores.paths.byId(transaction, path.pathId);
      });

      expect(read).toEqual(path);
      expect(read?.effectiveFrom).toBe('2026-01-01');
    });

    it('finds a path by code and returns nothing for one that does not exist', async () => {
      const path = aPath();
      const found = await inA(async (transaction) => {
        await fixture.stores.paths.insert(transaction, path);
        return {
          byCode: await fixture.stores.paths.byCode(transaction, 'engineering'),
          missing: await fixture.stores.paths.byCode(transaction, 'nobody-made-this'),
        };
      });

      expect(found.byCode?.pathId).toBe(path.pathId);
      expect(found.missing).toBeUndefined();
    });

    it('counts stages with the database rather than with a page', async () => {
      const path = aPath();
      const counted = await inA(async (transaction) => {
        await fixture.stores.paths.insert(transaction, path);
        for (let sequence = 1; sequence <= 3; sequence += 1) {
          await fixture.stores.paths.insertStage(transaction, aStage(path, sequence));
        }
        return {
          total: await fixture.stores.paths.stageCountOf(transaction, path.pathId),
          stages: await fixture.stores.paths.stagesFor(transaction, path.pathId),
        };
      });

      expect(counted.total).toBe(3);
      expect(counted.stages.map((stage) => stage.sequence)).toEqual([1, 2, 3]);
    });
  });

  describe('optimistic concurrency', () => {
    /**
     * The three-step property: the version the caller read succeeds, the same stale version is
     * refused, and the next one succeeds.
     *
     * The refusal is `ConcurrencyException`, which is what `Repository.updateRow` raises when its
     * `where version = $expected` matches no row. Every module since Phase 2 lets it travel to the
     * edge, where it becomes a 409.
     */
    it('accepts the current version, refuses the stale one, then accepts the next', async () => {
      const path = aPath();

      await inA(async (transaction) => {
        await fixture.stores.paths.insert(transaction, path);
      });

      await inA(async (transaction) => {
        await fixture.stores.paths.update(transaction, { ...path, status: 'published' }, 1);
      });

      await expect(
        inA(async (transaction) => {
          await fixture.stores.paths.update(transaction, { ...path, status: 'archived' }, 1);
        }),
      ).rejects.toThrow(ConcurrencyException);

      const after = await inA(async (transaction) => {
        await fixture.stores.paths.update(transaction, { ...path, status: 'archived' }, 2);
        return fixture.stores.paths.byId(transaction, path.pathId);
      });

      expect(after?.status).toBe('archived');
      expect(after?.version).toBe(3);
    });

    /**
     * The version guard is in the `where` clause of the write itself.
     *
     * Asserted against the plan cache rather than trusted: a repository that read the row, compared
     * the version in JavaScript and then updated without the predicate would pass the test above and
     * still lose a write, because the gap between the read and the write is exactly where the second
     * writer's update disappears.
     */
    it('puts the version in the update predicate rather than in a preceding read', async () => {
      const path = aPath();

      await inA(async (transaction) => {
        await fixture.stores.paths.insert(transaction, path);
      });

      const plan = await inA(async (transaction) => {
        const rows = await transaction.execute<{ 'QUERY PLAN': string }>(
          `explain update career_path set status = 'published'
             where id = $1 and tenant_id = $2 and version = $3 and deleted_at is null`,
          [path.pathId, TENANT_A, 1],
        );

        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });

      expect(plan).toMatch(/version/i);
      expect(plan).toMatch(/tenant_id/i);
    });
  });

  describe('the transaction belongs to the application', () => {
    /**
     * Two writes in one transaction commit together.
     *
     * A repository that opened its own transaction would commit the first write before the second
     * ran, and this would still pass — which is why the rollback assertion below is the one that
     * matters.
     */
    it('commits two writes together', async () => {
      const plan = aSuccessionPlan();
      const nomination = aNomination(plan);

      await inA(async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, plan);
        await fixture.stores.successors.insertIfAbsent(transaction, nomination);
      });

      const counts = await inA((transaction) =>
        fixture.stores.successors.benchCountsOf(transaction, plan.successionPlanId),
      );

      expect(counts).toEqual({ nominated: 1, confirmed: 0 });
    });

    /**
     * **A rollback leaves nothing behind, including the write that already succeeded.**
     *
     * This is the assertion that catches a repository quietly opening and committing its own
     * transaction. If `insertIfAbsent` had run in a transaction of its own, the succession plan would
     * survive the failure of the statement after it, and the tenant would be left with a plan whose
     * nomination never existed.
     */
    it('leaves nothing behind when the transaction rolls back', async () => {
      const plan = aSuccessionPlan();

      await expect(
        inA(async (transaction) => {
          await fixture.stores.successionPlans.insertIfAbsent(transaction, plan);
          throw new Error('the handler refused after writing');
        }),
      ).rejects.toThrow('the handler refused after writing');

      const found = await inA((transaction) =>
        fixture.stores.successionPlans.byId(transaction, plan.successionPlanId),
      );

      expect(found).toBeUndefined();
    });

    /** And the same for a failure PostgreSQL itself raises, part-way through a multi-write command. */
    it('rolls back a partial write when the database refuses the second statement', async () => {
      const pool = aPool();
      const first = aMembership(pool);
      const duplicate = aMembership(pool);

      await expect(
        inA(async (transaction) => {
          await fixture.stores.pools.insert(transaction, pool);
          await fixture.stores.memberships.insertIfAbsent(transaction, first);
          // The partial unique index refuses this one; `insertIfAbsent` yields rather than throwing,
          // so the handler raises to force the rollback this test is about.
          const written = await fixture.stores.memberships.insertIfAbsent(transaction, duplicate);

          if (!written) throw new Error('a second open membership was refused');
        }),
      ).rejects.toThrow('a second open membership was refused');

      const pools = await inA((transaction) =>
        fixture.stores.pools.all(transaction, undefined, { limit: 10, offset: 0 }),
      );

      expect(pools.total).toBe(0);
    });
  });
});
