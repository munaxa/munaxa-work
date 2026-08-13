import { describe, expect, it } from 'vitest';

import { EMPLOYMENT, HR, ask, attempt, harnessFor, reasonOf, send } from './career-test-harness.js';
import { aNomination, aPool, aSuccessionPlan } from './career-scenarios.js';
import type { PagedMemberships } from './career-record-queries.js';

/**
 * Periods, withdrawals, and what a retried command does.
 *
 * A pool membership period and a withdrawn nomination are both answers to "what did we do, and what
 * happened next" — the question a succession review asks a year later. A product that reconstructed
 * either from mutable current state could answer only "what is true now", which is a different and
 * much less useful thing.
 *
 * Convergence sits here too, because it is the same property from the other side: a retried command
 * must not create a *second* period or a *second* nomination, and the first one's dates must survive
 * the retry untouched.
 */

describe('a pool membership', () => {
  /**
   * Removal ends a period; it never deletes the row. "Who did we invest in, and what happened to
   * them" cannot be answered from a table that forgets.
   */
  it('keeps the period after somebody is removed', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);
      const { membershipId } = await send<{ membershipId: string }>(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-01-05',
      });

      await send(harness, {
        commandName: 'career.remove-from-pool',
        membershipId,
        on: '2026-06-30',
        reason: 'Completed the scheme',
        expectedVersion: 1,
      });

      const held = harness.stores.tables.memberships.get(membershipId);

      expect(held?.to).toBe('2026-06-30');
      expect(held?.removedReason).toBe('Completed the scheme');
      expect(harness.stores.tables.memberships.size).toBe(1);
    });
  });

  it('refuses to end a membership twice, so the first day survives', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);
      const { membershipId } = await send<{ membershipId: string }>(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-01-05',
      });

      await send(harness, {
        commandName: 'career.remove-from-pool',
        membershipId,
        on: '2026-06-30',
        expectedVersion: 1,
      });

      const refused = await attempt(harness, {
        commandName: 'career.remove-from-pool',
        membershipId,
        on: '2026-07-31',
        expectedVersion: 2,
      });

      expect(reasonOf(refused)).toBe('career.rejection.membership-already-ended');
      expect(harness.stores.tables.memberships.get(membershipId)?.to).toBe('2026-06-30');
    });
  });

  /**
   * "Who was in this pool in March" is answered from the periods, both ends inclusive.
   *
   * Somebody removed on the 30th was in the pool on the 30th — and a boundary wrong by one here
   * would quietly disagree with the SQL the repository will write.
   */
  it('answers who was a member on a stated day, inclusive of both ends', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);
      const { membershipId } = await send<{ membershipId: string }>(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-01-05',
      });

      await send(harness, {
        commandName: 'career.remove-from-pool',
        membershipId,
        on: '2026-06-30',
        expectedVersion: 1,
      });

      const during = await ask<PagedMemberships>(harness, {
        queryName: 'career.search-pool-memberships',
        talentPoolId: poolId,
        inForceOn: '2026-03-15',
      });
      const onTheLastDay = await ask<PagedMemberships>(harness, {
        queryName: 'career.search-pool-memberships',
        talentPoolId: poolId,
        inForceOn: '2026-06-30',
      });
      const after = await ask<PagedMemberships>(harness, {
        queryName: 'career.search-pool-memberships',
        talentPoolId: poolId,
        inForceOn: '2026-07-01',
      });

      expect(during.total).toBe(1);
      expect(onTheLastDay.total).toBe(1);
      expect(after.total).toBe(0);
      expect(during.asOf).toBe('2026-03-15');
    });
  });

  it('permits rejoining a pool somebody left', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);
      const { membershipId } = await send<{ membershipId: string }>(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-01-05',
      });

      await send(harness, {
        commandName: 'career.remove-from-pool',
        membershipId,
        on: '2026-06-30',
        expectedVersion: 1,
      });
      await send(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-09-01',
      });

      expect(harness.stores.tables.memberships.size).toBe(2);
    });
  });
});

describe('a withdrawn nomination', () => {
  it('stays on the bench as history', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const successorId = await aNomination(harness, planId);

      await send(harness, {
        commandName: 'career.withdraw-successor',
        successorId,
        reason: 'Took a role elsewhere',
        expectedVersion: 1,
      });

      const held = harness.stores.tables.successors.get(successorId);

      expect(held?.status).toBe('withdrawn');
      expect(held?.withdrawalReason).toBe('Took a role elsewhere');
      expect(held?.withdrawnOn).toBe('2026-08-13');
      expect(harness.stores.tables.successors.size).toBe(1);
    });
  });

  it('frees the slot, so somebody may be put back on the bench', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const successorId = await aNomination(harness, planId);

      await send(harness, {
        commandName: 'career.withdraw-successor',
        successorId,
        reason: 'Changed their mind',
        expectedVersion: 1,
      });
      await aNomination(harness, planId);

      expect(harness.stores.tables.successors.size).toBe(2);
    });
  });
});

describe('convergence, where uniqueness is the database’s', () => {
  /**
   * A retried command returns the row that already exists, with `created: false`.
   *
   * A retry that reported a conflict would make a lost response indistinguishable from a duplicate
   * act, and only one of the two is a problem. This proves the *rule*; the *race* — two managers at
   * the same instant — is PostgreSQL's, and was tested across two real connections in Checkpoint 3.
   */
  it('returns the existing nomination rather than a second one', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const first = await send<{ successorId: string; created: boolean }>(harness, {
        commandName: 'career.nominate-successor',
        successionPlanId: planId,
        employmentId: EMPLOYMENT,
      });
      const second = await send<{ successorId: string; created: boolean }>(harness, {
        commandName: 'career.nominate-successor',
        successionPlanId: planId,
        employmentId: EMPLOYMENT,
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.successorId).toBe(first.successorId);
      expect(harness.stores.tables.successors.size).toBe(1);
    });
  });

  it('returns the existing pool membership rather than a second period', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);
      const first = await send<{ membershipId: string; created: boolean }>(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-01-05',
      });
      const second = await send<{ membershipId: string; created: boolean }>(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-02-05',
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.membershipId).toBe(first.membershipId);
      // And the *first* period's start day survives — the retry did not move it.
      expect(harness.stores.tables.memberships.get(first.membershipId)?.from).toBe('2026-01-05');
    });
  });
});
