import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openCareerFixture,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  EMPLOYMENT,
  OTHER_EMPLOYMENT,
  OTHER_POSITION,
  aDevelopmentPlan,
  aMembership,
  aNomination,
  aPlan,
  aPool,
  aReadinessLevel,
  aRecommendation,
  aSuccessionPlan,
  anObjective,
} from './career-states.js';

/**
 * The repository contract, against a real PostgreSQL.
 *
 * The invariants the *database* owns, reached through the repositories: the partial unique indexes
 * that arbitrate uniqueness, the reads that answer a question rather than return a table, and the
 * tenant boundary as a repository caller experiences it.
 *
 * Split from the contract suite at the seam between "does the round trip work" and "does the
 * database refuse what it must". Both halves go in through the repository and come back out through
 * it: a hand-written `insert` beside the mapper it was written with would agree with itself and
 * prove nothing.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career persistence invariants suite');

suite('career persistence invariants', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_invariants_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  describe('uniqueness the database owns', () => {
    /** Each index gets both halves: the duplicate it refuses, and the case it deliberately permits. */
    it('refuses a second active career plan and permits one after the first ended', async () => {
      const first = aPlan();
      const second = aPlan();

      const outcome = await inA(async (transaction) => {
        await fixture.stores.plans.insertIfAbsent(transaction, { ...first, status: 'active' });
        return fixture.stores.plans.insertIfAbsent(transaction, { ...second, status: 'active' });
      });

      expect(outcome).toBe(false);

      const permitted = await inA(async (transaction) => {
        await fixture.stores.plans.update(
          transaction,
          { ...first, status: 'achieved', closedOn: '2026-05-01', closedBy: 'user:test' },
          1,
        );
        return fixture.stores.plans.insertIfAbsent(transaction, { ...second, status: 'active' });
      });

      expect(permitted).toBe(true);
    });

    it('refuses a second open nomination and permits one after a withdrawal', async () => {
      const plan = aSuccessionPlan();
      const first = aNomination(plan);
      const again = aNomination(plan);

      const refused = await inA(async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, plan);
        await fixture.stores.successors.insertIfAbsent(transaction, first);
        return fixture.stores.successors.insertIfAbsent(transaction, again);
      });

      expect(refused).toBe(false);

      const permitted = await inA(async (transaction) => {
        await fixture.stores.successors.update(
          transaction,
          {
            ...first,
            status: 'withdrawn',
            withdrawnOn: '2026-09-01',
            withdrawnBy: 'user:test',
            withdrawalReason: 'Took a role elsewhere',
          },
          1,
        );
        return fixture.stores.successors.insertIfAbsent(transaction, again);
      });

      expect(permitted).toBe(true);
    });

    it('permits the same person on two positions’ benches (D-15)', async () => {
      const first = aSuccessionPlan();
      const second = aSuccessionPlan({ positionId: OTHER_POSITION });

      const both = await inA(async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, first);
        await fixture.stores.successionPlans.insertIfAbsent(transaction, second);
        return [
          await fixture.stores.successors.insertIfAbsent(transaction, aNomination(first)),
          await fixture.stores.successors.insertIfAbsent(transaction, aNomination(second)),
        ];
      });

      expect(both).toEqual([true, true]);
    });

    it('refuses a second open pool membership and permits a rejoin', async () => {
      const pool = aPool();
      const first = aMembership(pool);
      const again = aMembership(pool, { from: '2026-09-01' });

      const refused = await inA(async (transaction) => {
        await fixture.stores.pools.insert(transaction, pool);
        await fixture.stores.memberships.insertIfAbsent(transaction, first);
        return fixture.stores.memberships.insertIfAbsent(transaction, again);
      });

      expect(refused).toBe(false);

      const permitted = await inA(async (transaction) => {
        await fixture.stores.memberships.update(
          transaction,
          { ...first, to: '2026-06-30', removedBy: 'user:test' },
          1,
        );
        return fixture.stores.memberships.insertIfAbsent(transaction, again);
      });

      expect(permitted).toBe(true);
    });

    it('refuses a second active succession plan for one position', async () => {
      const first = { ...aSuccessionPlan(), status: 'active' as const };
      const second = { ...aSuccessionPlan(), status: 'active' as const };

      const outcome = await inA(async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, first);
        return fixture.stores.successionPlans.insertIfAbsent(transaction, second);
      });

      expect(outcome).toBe(false);
    });
  });

  describe('reads that answer a question rather than a table', () => {
    it('finds the active plan for an employment and ignores the ended one', async () => {
      const ended = aPlan();
      const active = aPlan();

      const found = await inA(async (transaction) => {
        await fixture.stores.plans.insertIfAbsent(transaction, {
          ...ended,
          status: 'abandoned',
          closedOn: '2026-04-01',
          closedBy: 'user:test',
        });
        await fixture.stores.plans.insertIfAbsent(transaction, { ...active, status: 'active' });
        return fixture.stores.plans.activeFor(transaction, EMPLOYMENT);
      });

      expect(found?.careerPlanId).toBe(active.careerPlanId);
    });

    it('answers who was in a pool on a stated day, inclusive of both ends', async () => {
      const pool = aPool();
      const membership = aMembership(pool);

      await inA(async (transaction) => {
        await fixture.stores.pools.insert(transaction, pool);
        await fixture.stores.memberships.insertIfAbsent(transaction, membership);
        await fixture.stores.memberships.update(
          transaction,
          { ...membership, to: '2026-06-30', removedBy: 'user:test' },
          1,
        );
      });

      const answers = await inA(async (transaction) => {
        const on = (day: string): Promise<{ total: number }> =>
          fixture.stores.memberships.search(
            transaction,
            { talentPoolId: pool.talentPoolId, inForceOn: day },
            { limit: 10, offset: 0 },
          );

        return {
          before: (await on('2026-01-04')).total,
          firstDay: (await on('2026-01-05')).total,
          during: (await on('2026-03-15')).total,
          lastDay: (await on('2026-06-30')).total,
          after: (await on('2026-07-01')).total,
        };
      });

      expect(answers).toEqual({ before: 0, firstDay: 1, during: 1, lastDay: 1, after: 0 });
    });

    it('finds the open nomination and treats a withdrawn one as absent', async () => {
      const plan = aSuccessionPlan();
      const nomination = aNomination(plan);

      const found = await inA(async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, plan);
        await fixture.stores.successors.insertIfAbsent(transaction, nomination);

        const open = await fixture.stores.successors.openFor(
          transaction,
          plan.successionPlanId,
          EMPLOYMENT,
        );

        await fixture.stores.successors.update(
          transaction,
          {
            ...nomination,
            status: 'withdrawn',
            withdrawnOn: '2026-09-01',
            withdrawnBy: 'user:test',
            withdrawalReason: 'Took a role elsewhere',
          },
          1,
        );

        return {
          open,
          afterWithdrawal: await fixture.stores.successors.openFor(
            transaction,
            plan.successionPlanId,
            EMPLOYMENT,
          ),
        };
      });

      expect(found.open?.successorId).toBe(nomination.successorId);
      expect(found.afterWithdrawal).toBeUndefined();
    });

    it('lists reviews that have come due, and nothing fires to make them due', async () => {
      const due = { ...aSuccessionPlan({ reviewOn: '2026-11-01' }), status: 'active' as const };
      const later = {
        ...aSuccessionPlan({ positionId: OTHER_POSITION, reviewOn: '2027-01-01' }),
        status: 'active' as const,
      };

      const found = await inA(async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, due);
        await fixture.stores.successionPlans.insertIfAbsent(transaction, later);
        return fixture.stores.successionPlans.search(
          transaction,
          { reviewOnOrBefore: '2026-12-01' },
          { limit: 10, offset: 0 },
        );
      });

      expect(found.total).toBe(1);
      expect(found.items[0]?.successionPlanId).toBe(due.successionPlanId);
    });

    it('bounds a development item search by target date', async () => {
      const plan = aDevelopmentPlan();
      const soon = anObjective(plan, { targetDate: '2026-09-01' });
      const later = anObjective(plan, { targetDate: '2027-03-01' });
      const undated = anObjective(plan);

      const found = await inA(async (transaction) => {
        await fixture.stores.developmentPlans.insert(transaction, plan);
        for (const item of [soon, later, undated]) {
          await fixture.stores.developmentItems.insert(transaction, item);
        }
        return fixture.stores.developmentItems.search(
          transaction,
          { developmentPlanId: plan.developmentPlanId, targetOnOrBefore: '2026-12-31' },
          { limit: 10, offset: 0 },
        );
      });

      expect(found.total).toBe(1);
      expect(found.items[0]?.developmentItemId).toBe(soon.developmentItemId);
    });
  });

  describe('tenant isolation through the repositories', () => {
    /**
     * The same repository, two tenants, both directions.
     *
     * The policy is the guarantee and was proved in Checkpoint 3 across twelve tables; this asserts
     * the repositories do not defeat it — that every read carries the tenant, and that a `total`
     * counted through a repository does not include a row it hid.
     */
    it('shows a tenant only its own rows, and counts only its own', async () => {
      const mine = aRecommendation();
      const theirs = aRecommendation();

      await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.mobility.insert(transaction, mine),
      );
      await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.mobility.insert(transaction, theirs),
      );

      const seenByA = await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.mobility.search(transaction, {}, { limit: 50, offset: 0 }),
      );
      const seenByB = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.mobility.search(transaction, {}, { limit: 50, offset: 0 }),
      );

      expect(seenByA.total).toBe(1);
      expect(seenByB.total).toBe(1);
      expect(seenByA.items[0]?.mobilityRecommendationId).toBe(mine.mobilityRecommendationId);
      expect(seenByB.items[0]?.mobilityRecommendationId).toBe(theirs.mobilityRecommendationId);
    });

    it('returns nothing for another tenant’s row addressed by its exact identifier', async () => {
      const mine = aSuccessionPlan();

      await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.successionPlans.insertIfAbsent(transaction, mine),
      );

      const found = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.successionPlans.byId(transaction, mine.successionPlanId),
      );

      expect(found).toBeUndefined();
    });

    /**
     * A bench count is the number a succession review acts on, and it must not include a row the
     * policy hid — nor disclose that another organization has one.
     */
    it('counts a bench within the tenant only', async () => {
      const plan = aSuccessionPlan();

      await fixture.inTenant(TENANT_A, async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, plan);
        await fixture.stores.successors.insertIfAbsent(transaction, aNomination(plan));
        await fixture.stores.successors.insertIfAbsent(
          transaction,
          aNomination(plan, { employmentId: OTHER_EMPLOYMENT }),
        );
      });

      const mine = await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.successors.benchCountsOf(transaction, plan.successionPlanId),
      );
      const theirs = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.successors.benchCountsOf(transaction, plan.successionPlanId),
      );

      expect(mine).toEqual({ nominated: 2, confirmed: 0 });
      expect(theirs).toEqual({ nominated: 0, confirmed: 0 });
    });

    it('refuses an update that would move a row into another tenant', async () => {
      const level = aReadinessLevel();

      await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.readinessLevels.insert(transaction, level),
      );

      // The repository never offers a way to change `tenant_id` — `mutable()` strips it — so the
      // attempt has to be raw SQL, and the policy's `with check` is what refuses it.
      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          client.query(`update career_readiness_level set tenant_id = $1`, [TENANT_B]),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });
});
