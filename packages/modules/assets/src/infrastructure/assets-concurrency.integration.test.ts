import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openAssetsFixture,
  requireDatabaseInCi,
  type AssetsFixture,
} from './assets-database.fixture.js';

/**
 * The races, proved against real PostgreSQL with real connections contending.
 *
 * **No sleeps and no timing assumptions.** Two transactions are started and awaited together; the
 * index decides, and the assertion is on the invariant rather than on which one wins. Asserting a
 * winner would be asserting a scheduling detail — what matters is that **exactly one survives**.
 *
 * These are the assertions that make ADR-0071 true here rather than merely cited: a `select`
 * followed by an `insert` is not idempotent under concurrency, so the readable refusals the use
 * cases give are a courtesy, and the partial unique indexes are the guarantee.
 */

requireDatabaseInCi('Assets concurrency');

describe.skipIf(CONNECTION === undefined)('two storekeepers at once', () => {
  let fixture: AssetsFixture;

  beforeAll(async () => {
    fixture = await openAssetsFixture('assets_concurrency_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const givenCategory = (code = 'laptop'): Promise<string> =>
    fixture.asTenant(TENANT_A, async (transaction) => {
      const id = uuidV7();

      await fixture.stores.categories.insert(transaction, {
        assetCategoryId: id,
        code,
        name: { en: 'Laptop', ar: 'حاسوب محمول' },
        sequence: 10,
        active: true,
        version: 1,
      });
      return id;
    });

  const registering = (categoryId: string, tag: string, serialNumber?: string): Promise<void> =>
    fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assets.insert(transaction, {
        assetId: uuidV7(),
        assetCategoryId: categoryId,
        assetTag: tag,
        status: 'registered',
        version: 1,
        ...(serialNumber === undefined ? {} : { serialNumber }),
      }),
    );

  const survivors = (outcomes: readonly PromiseSettledResult<unknown>[]): number =>
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length;

  const refusal = (outcomes: readonly PromiseSettledResult<unknown>[]): string =>
    String(
      (outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult).reason,
    );

  it('lets exactly one of two identical tags survive, and the index is what decides', async () => {
    const categoryId = await givenCategory();
    const outcomes = await Promise.allSettled([
      registering(categoryId, 'IT-00417'),
      registering(categoryId, 'IT-00417'),
    ]);

    expect(survivors(outcomes)).toBe(1);
    expect(refusal(outcomes)).toMatch(/asset_tag_idx/);
  });

  it('lets exactly one of two identical serial numbers survive', async () => {
    const categoryId = await givenCategory();
    const outcomes = await Promise.allSettled([
      registering(categoryId, 'IT-1', 'SN-00099'),
      registering(categoryId, 'IT-2', 'SN-00099'),
    ]);

    expect(survivors(outcomes)).toBe(1);
    expect(refusal(outcomes)).toMatch(/asset_serial_idx/);
  });

  it('lets exactly one of two identical catalogue codes survive', async () => {
    const outcomes = await Promise.allSettled([givenCategory('vehicle'), givenCategory('vehicle')]);

    expect(survivors(outcomes)).toBe(1);
    expect(refusal(outcomes)).toMatch(/asset_category_code_idx/);
  });

  /**
   * Two items with no serial number do not contend at all.
   *
   * The index is partial, so the many rows that carry no serial number are simply not in it. If it
   * were a plain unique index this test would fail on the second insert, and a tenant could hold
   * exactly one unserialled chair.
   */
  it('lets two items with no serial number both survive', async () => {
    const categoryId = await givenCategory();
    const outcomes = await Promise.allSettled([
      registering(categoryId, 'FUR-1'),
      registering(categoryId, 'FUR-2'),
    ]);

    expect(survivors(outcomes)).toBe(2);
  });

  /**
   * Two people editing one item from two stale screens: one write lands, the other is refused.
   *
   * The version predicate is in the `where` clause rather than in a preceding read, because a read
   * followed by a write is two statements with a gap between them — and the gap is exactly where the
   * second person's correction disappears.
   */
  it('refuses the second of two amendments made from the same version', async () => {
    const categoryId = await givenCategory();
    const assetId = await fixture.asTenant(TENANT_A, async (transaction) => {
      const id = uuidV7();

      await fixture.stores.assets.insert(transaction, {
        assetId: id,
        assetCategoryId: categoryId,
        assetTag: 'IT-00417',
        status: 'registered',
        version: 1,
      });
      return id;
    });

    const amending = (description: string): Promise<void> =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.assets.update(
          transaction,
          {
            assetId,
            assetCategoryId: categoryId,
            assetTag: 'IT-00417',
            status: 'registered',
            version: 1,
            description,
          },
          1,
        ),
      );

    const outcomes = await Promise.allSettled([
      amending('From one screen'),
      amending('From another'),
    ]);

    expect(survivors(outcomes)).toBe(1);

    const held = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assets.byId(transaction, assetId),
    );

    // One write landed, and the row moved on by exactly one version — so the loser's change is
    // genuinely absent rather than silently merged.
    expect(held?.version).toBe(2);
  });

  /**
   * A status move made from a stale version is refused for the same reason.
   *
   * Two people cannot both retire and repair one item from the same screen state: the transition
   * table decides which moves are legal, and the version decides which caller was looking at the
   * truth.
   */
  it('refuses a status move made against a version that has already moved', async () => {
    const categoryId = await givenCategory();
    const assetId = await fixture.asTenant(TENANT_A, async (transaction) => {
      const id = uuidV7();

      await fixture.stores.assets.insert(transaction, {
        assetId: id,
        assetCategoryId: categoryId,
        assetTag: 'IT-00417',
        status: 'registered',
        version: 1,
      });
      return id;
    });

    const moving = (status: 'available' | 'retired'): Promise<void> =>
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.assets.update(
          transaction,
          {
            assetId,
            assetCategoryId: categoryId,
            assetTag: 'IT-00417',
            status,
            version: 1,
          },
          1,
        ),
      );

    const outcomes = await Promise.allSettled([moving('available'), moving('retired')]);

    expect(survivors(outcomes)).toBe(1);
  });
});
