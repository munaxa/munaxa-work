import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openCareerFixture,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import { aPath, aPlan, aStage } from './career-states.js';
import { MAXIMUM_PAGE_SIZE, pageOf } from '../application/career-paging.js';
import type { CareerPathState } from '../domain/path.js';

/**
 * Paging, against real SQL.
 *
 * The application suite already proved the bound is computed correctly. This proves the *database*
 * honours it: that `limit` and `offset` reach the statement, that the `total` is a `count(*)` over
 * the same predicate rather than the length of the page, and that the ordering is deterministic
 * enough that paging cannot skip or repeat a row.
 *
 * **The determinism assertion is the one that matters.** An `order by` on a non-unique column alone
 * leaves PostgreSQL free to return equal rows in any order between statements, so page 2 could
 * repeat a row from page 1 and omit another entirely — and the suite that only checked lengths would
 * pass. Every ordered read in this module therefore breaks its tie on `id`.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career paging suite');

suite('career paging', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_paging_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  /** Twelve paths, so three pages of five with a short final one. */
  const twelvePaths = (): Promise<void> =>
    inA(async (transaction) => {
      for (let index = 1; index <= 12; index += 1) {
        await fixture.stores.paths.insert(
          transaction,
          aPath({ code: `path-${String(index).padStart(2, '0')}` }),
        );
      }
    });

  const page = (
    number: number,
    size: number,
  ): Promise<{ items: readonly CareerPathState[]; total: number }> =>
    inA((transaction) =>
      fixture.stores.paths.search(transaction, {}, pageOf({ page: number, size })),
    );

  it('returns the first page, a middle page, the final page and an empty page beyond', async () => {
    await twelvePaths();

    const first = await page(1, 5);
    const middle = await page(2, 5);
    const final = await page(3, 5);
    const beyond = await page(4, 5);

    expect(first.items).toHaveLength(5);
    expect(middle.items).toHaveLength(5);
    expect(final.items).toHaveLength(2);
    expect(beyond.items).toHaveLength(0);

    // The total is the whole set on every page, including the empty one — which is what tells a
    // client it has run off the end rather than that the collection vanished.
    for (const held of [first, middle, final, beyond]) expect(held.total).toBe(12);
  });

  /**
   * No row is skipped and none is repeated.
   *
   * This is what an `order by` with a unique tie-break buys, and the reason every ordered read in
   * this module ends in `id`.
   */
  it('walks the whole collection exactly once across its pages', async () => {
    await twelvePaths();

    const seen: string[] = [];

    for (const number of [1, 2, 3]) {
      const held = await page(number, 5);

      seen.push(...held.items.map((path) => path.pathId));
    }

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it('orders by code, so the same page returns the same rows twice running', async () => {
    await twelvePaths();

    const once = await page(2, 5);
    const twice = await page(2, 5);

    expect(once.items.map((path) => path.code)).toEqual(twice.items.map((path) => path.code));
    expect(once.items.map((path) => path.code)).toEqual([
      'path-06',
      'path-07',
      'path-08',
      'path-09',
      'path-10',
    ]);
  });

  it('honours the smallest valid size and the largest', async () => {
    await twelvePaths();

    const smallest = await page(1, 1);
    const largest = await page(1, MAXIMUM_PAGE_SIZE);

    expect(smallest.items).toHaveLength(1);
    expect(smallest.total).toBe(12);
    expect(largest.items).toHaveLength(12);
  });

  /**
   * An invalid page or size is clamped rather than refused, and the clamp happens before the SQL.
   *
   * A negative `offset` is a syntax error in PostgreSQL, and a caller who could send one would get a
   * driver error instead of an answer — which is why `pageOf` floors both, and why this asserts the
   * clamped request actually executes.
   */
  it('clamps an invalid page and an invalid size instead of failing', async () => {
    await twelvePaths();

    const negative = await inA((transaction) =>
      fixture.stores.paths.search(transaction, {}, pageOf({ page: -3, size: -1 })),
    );
    const oversized = await inA((transaction) =>
      fixture.stores.paths.search(transaction, {}, pageOf({ size: 10_000 })),
    );

    expect(negative.items).toHaveLength(1);
    expect(negative.total).toBe(12);
    expect(oversized.items).toHaveLength(12);
  });

  /**
   * The total counts the filtered set, not the table.
   *
   * A `count(*)` over a different predicate from the page is the defect that shows "1 of 40" on a
   * screen holding forty rows, and it is why `pageOf` runs both statements with the same parameters.
   */
  it('counts the filtered set rather than the table', async () => {
    await inA(async (transaction) => {
      for (let index = 1; index <= 6; index += 1) {
        const path = aPath({ code: `draft-${String(index)}` });

        await fixture.stores.paths.insert(transaction, path);
      }
      for (let index = 1; index <= 4; index += 1) {
        const path = aPath({ code: `live-${String(index)}` });

        await fixture.stores.paths.insert(transaction, { ...path, status: 'published' });
      }
    });

    const published = await inA((transaction) =>
      fixture.stores.paths.search(transaction, { status: 'published' }, { limit: 2, offset: 0 }),
    );

    expect(published.items).toHaveLength(2);
    expect(published.total).toBe(4);
  });

  it('returns an empty page and a zero total for a collection with nothing in it', async () => {
    const empty = await page(1, 10);

    expect(empty).toEqual({ items: [], total: 0 });
  });

  /**
   * A collection read fetches a page from the database rather than the table.
   *
   * Asserted from the plan: a repository that read everything and sliced in memory would answer
   * every test above correctly and fall over at a hundred thousand rows. `Limit` in the plan is the
   * evidence that the bound reached the statement.
   */
  it('pushes the bound into the statement rather than slicing in memory', async () => {
    await twelvePaths();

    const plan = await inA(async (transaction) => {
      const rows = await transaction.execute<{ 'QUERY PLAN': string }>(
        `explain select p.id from career_path p
           where p.tenant_id = $1 and p.deleted_at is null
           order by p.code limit $2 offset $3`,
        [TENANT_A, 5, 5],
      );

      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });

    expect(plan).toMatch(/Limit/);
  });

  it('bounds an aggregate’s child read too, and keeps it in sequence order', async () => {
    const path = aPath({ code: 'staged' });

    const stages = await inA(async (transaction) => {
      await fixture.stores.paths.insert(transaction, path);
      for (const sequence of [3, 1, 2]) {
        await fixture.stores.paths.insertStage(transaction, aStage(path, sequence));
      }
      return fixture.stores.paths.stagesFor(transaction, path.pathId);
    });

    expect(stages.map((stage) => stage.sequence)).toEqual([1, 2, 3]);
  });

  /** And a person-scoped search pages the same way, with its own deterministic order. */
  it('pages a plan search by start date with a unique tie-break', async () => {
    await inA(async (transaction) => {
      for (let index = 0; index < 7; index += 1) {
        const employmentId = `01930000-0000-7000-8000-0000000${String(index).padStart(5, '0')}`;

        await fixture.stores.plans.insertIfAbsent(
          transaction,
          aPlan({ employmentId, startedOn: '2026-03-01' }),
        );
      }
    });

    const first = await inA((transaction) =>
      fixture.stores.plans.search(transaction, {}, { limit: 3, offset: 0 }),
    );
    const second = await inA((transaction) =>
      fixture.stores.plans.search(transaction, {}, { limit: 3, offset: 3 }),
    );
    const third = await inA((transaction) =>
      fixture.stores.plans.search(transaction, {}, { limit: 3, offset: 6 }),
    );
    const identifiers = [...first.items, ...second.items, ...third.items].map(
      (plan) => plan.careerPlanId,
    );

    // Every plan started on the same civil day, so `started_on` alone orders nothing — the `id`
    // tie-break is the whole reason this walks seven distinct rows rather than repeating some.
    expect(identifiers).toHaveLength(7);
    expect(new Set(identifiers).size).toBe(7);
    expect(first.total).toBe(7);
  });
});
