import { describe, expect, it } from 'vitest';

import {
  EMPLOYMENT,
  HR,
  ask,
  harnessFor,
  named,
  send,
  type Harness,
} from './career-test-harness.js';
import { aPool, aSuccessionPlan } from './career-scenarios.js';
import { MAXIMUM_PAGE_SIZE, pageOf } from './career-paging.js';
import type { PagedPaths } from './career-queries.js';
import type { PagedMemberships } from './career-record-queries.js';
import type { BenchStrengthView, TalentPoolView } from '../contracts/views.js';
import type { Page } from './career-ports.js';

/**
 * Every collection read is bounded, and the total is the server's rather than the page's.
 *
 * The second half matters more than the first. A `total` taken from `items.length` is the size of
 * the page, so "this director has three successors" would be right until there were more than fifty
 * of them — and a bench count computed that way is exactly the number a succession review acts on.
 */

describe('the page bound', () => {
  it('defaults, clamps and floors rather than refusing', () => {
    expect(pageOf({})).toEqual({ limit: 50, offset: 0 });
    expect(pageOf({ page: 3, size: 10 })).toEqual({ limit: 10, offset: 20 });
    // A caller asking for ten thousand rows gets the maximum and a truthful `total`. Refusing would
    // tempt a client into paging in a loop, which is the same unbounded read spelled differently.
    expect(pageOf({ size: 10_000 })).toEqual({ limit: MAXIMUM_PAGE_SIZE, offset: 0 });
    expect(pageOf({ size: 0 })).toEqual({ limit: 1, offset: 0 });
    expect(pageOf({ page: 0 })).toEqual({ limit: 50, offset: 0 });
    expect(pageOf({ page: -4, size: -1 })).toEqual({ limit: 1, offset: 0 });
  });

  it('never produces a page larger than the maximum, whatever is asked for', () => {
    for (const size of [201, 500, 10_000, Number.MAX_SAFE_INTEGER]) {
      expect(pageOf({ size }).limit, String(size)).toBe(MAXIMUM_PAGE_SIZE);
    }
  });
});

describe('a collection read', () => {
  const twelvePools = async (harness: Harness): Promise<void> => {
    for (let index = 1; index <= 12; index += 1) {
      await send(harness, {
        commandName: 'career.create-pool',
        code: `pool-${index}`,
        name: named(`Pool ${index}`, `مجموعة ${index}`),
        kind: 'custom',
      });
    }
  };

  it('returns the first page, a middle page, the final page and an empty page beyond', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      await twelvePools(harness);

      const first = await ask<Page<TalentPoolView>>(harness, {
        queryName: 'career.list-pools',
        page: 1,
        size: 5,
      });
      const middle = await ask<Page<TalentPoolView>>(harness, {
        queryName: 'career.list-pools',
        page: 2,
        size: 5,
      });
      const final = await ask<Page<TalentPoolView>>(harness, {
        queryName: 'career.list-pools',
        page: 3,
        size: 5,
      });
      const beyond = await ask<Page<TalentPoolView>>(harness, {
        queryName: 'career.list-pools',
        page: 4,
        size: 5,
      });

      expect(first.items).toHaveLength(5);
      expect(middle.items).toHaveLength(5);
      expect(final.items).toHaveLength(2);
      expect(beyond.items).toHaveLength(0);

      // The total is the whole set on every page — including the empty one, which is what tells a
      // client it has run off the end rather than that the collection vanished.
      for (const page of [first, middle, final, beyond]) {
        expect(page.total).toBe(12);
      }
    });
  });

  it('does not overlap or skip rows between pages', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      await twelvePools(harness);

      const seen: string[] = [];

      for (const page of [1, 2, 3]) {
        const found = await ask<Page<TalentPoolView>>(harness, {
          queryName: 'career.list-pools',
          page,
          size: 5,
        });

        seen.push(...found.items.map((pool) => pool.talentPoolId));
      }

      expect(seen).toHaveLength(12);
      expect(new Set(seen).size).toBe(12);
    });
  });

  it('clamps an oversized request and still reports the true total', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      await twelvePools(harness);

      const page = await ask<Page<TalentPoolView>>(harness, {
        queryName: 'career.list-pools',
        size: 10_000,
      });

      expect(page.items).toHaveLength(12);
      expect(page.total).toBe(12);
    });
  });

  it('returns an empty page rather than an error for a collection with nothing in it', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const page = await ask<PagedPaths>(harness, { queryName: 'career.search-paths' });

      expect(page).toMatchObject({ items: [], total: 0, asOf: '2026-08-13' });
    });
  });
});

describe('a count is the server’s, not the page’s', () => {
  /**
   * A bench deeper than a page still counts correctly.
   *
   * `benchCountsOf` counts the table; a handler that derived the number from `forPlan(...).length`
   * would be right until the sixty-first nomination, and wrong in exactly the situation where the
   * number matters.
   */
  it('counts a bench deeper than the default page', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);

      for (let index = 0; index < 60; index += 1) {
        const employmentId = `employment-${index}`;

        harness.employment.add({ employmentId, status: 'active', active: true });
        await send(harness, {
          commandName: 'career.nominate-successor',
          successionPlanId: planId,
          employmentId,
        });
      }

      const bench = await ask<BenchStrengthView>(harness, {
        queryName: 'career.read-bench-strength',
        successionPlanId: planId,
      });

      expect(bench.nominated).toBe(60);
      expect(bench.confirmed).toBe(0);
      expect(bench.asOf).toBe('2026-08-13');
    });
  });

  it('moves a nomination between the two counts when it is confirmed', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const { successorId } = await send<{ successorId: string }>(harness, {
        commandName: 'career.nominate-successor',
        successionPlanId: planId,
        employmentId: EMPLOYMENT,
      });

      await send(harness, {
        commandName: 'career.confirm-successor',
        successorId,
        expectedVersion: 1,
      });

      const bench = await ask<BenchStrengthView>(harness, {
        queryName: 'career.read-bench-strength',
        successionPlanId: planId,
      });

      expect(bench).toMatchObject({ nominated: 0, confirmed: 1 });
    });
  });

  /** A withdrawn nomination counts towards neither. A bench of people who left is not a bench. */
  it('counts a withdrawn nomination in neither total', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const { successorId } = await send<{ successorId: string }>(harness, {
        commandName: 'career.nominate-successor',
        successionPlanId: planId,
        employmentId: EMPLOYMENT,
      });

      await send(harness, {
        commandName: 'career.withdraw-successor',
        successorId,
        reason: 'Took a role elsewhere',
        expectedVersion: 1,
      });

      const bench = await ask<BenchStrengthView>(harness, {
        queryName: 'career.read-bench-strength',
        successionPlanId: planId,
      });

      expect(bench).toMatchObject({ nominated: 0, confirmed: 0 });
    });
  });
});

describe('a membership as-of read is bounded too', () => {
  it('pages the periods in force on a stated day', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);

      for (let index = 0; index < 8; index += 1) {
        const employmentId = `member-${index}`;

        harness.employment.add({ employmentId, status: 'active', active: true });
        await send(harness, {
          commandName: 'career.add-to-pool',
          talentPoolId: poolId,
          employmentId,
          from: '2026-01-05',
        });
      }

      const page = await ask<PagedMemberships>(harness, {
        queryName: 'career.search-pool-memberships',
        talentPoolId: poolId,
        inForceOn: '2026-03-01',
        size: 3,
      });

      expect(page.items).toHaveLength(3);
      expect(page.total).toBe(8);
      expect(page.asOf).toBe('2026-03-01');
    });
  });
});
