import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  STOREKEEPER,
  ask,
  attempt,
  givenAsset,
  givenCategory,
  harnessFor,
  send,
  tryAsk,
} from './assets-test-harness.js';
import type { AssetPageView, AssetView } from '../contracts/views.js';

/**
 * The inventory, through the real dispatcher and the real handlers.
 *
 * Split from `assets-lifecycle.test.ts` when the two together passed the 400-line file budget —
 * split at the seam that was already there rather than exempted, so one file is about the catalogue
 * a tenant configures and the other about the items it owns.
 */

describe('the inventory, end to end', () => {
  it('registers an item under a category and reads it back', async () => {
    const harness = harnessFor();
    const assetId = await givenAsset(harness, {
      serialNumber: 'SN-000123',
      description: 'Dell Latitude 5540',
      locationNote: 'Head office store room',
      purchaseReference: 'PO-2026-118',
    });
    const found = await harness.as(STOREKEEPER, () =>
      ask<AssetView>(harness, { queryName: 'assets.read-asset', assetId }),
    );

    expect(found.assetTag).toBe('IT-00417');
    expect(found.serialNumber).toBe('SN-000123');
    expect(found.status).toBe('registered');
    expect(found.version).toBe(1);
  });

  it('refuses an item under a category that does not exist', async () => {
    const harness = harnessFor();
    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.register-asset',
        assetCategoryId: '01940000-0000-7000-8000-0000000000ff',
        assetTag: 'IT-1',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'not_found', resource: 'asset_category' });
  });

  /**
   * A deactivated entry keeps classifying every asset already under it and classifies no new one —
   * which is the whole reason deactivation exists instead of deletion.
   */
  it('refuses a new item under a deactivated category, while the existing ones keep reading', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);
    const assetId = await givenAsset(harness, { assetCategoryId });

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'assets.amend-category',
        assetCategoryId,
        expectedVersion: 1,
        active: false,
      }),
    );

    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.register-asset',
        assetCategoryId,
        assetTag: 'IT-00418',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'conflict', reason: 'category_inactive' });

    const stillReadable = await harness.as(STOREKEEPER, () =>
      ask<AssetView>(harness, { queryName: 'assets.read-asset', assetId }),
    );

    expect(stillReadable.assetId).toBe(assetId);
  });

  it('refuses a duplicate tag readably', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);

    await givenAsset(harness, { assetCategoryId });

    const second = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.register-asset',
        assetCategoryId,
        assetTag: 'IT-00417',
      }),
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatchObject({ kind: 'conflict', reason: 'asset_tag_taken' });
  });

  it('refuses a duplicate serial number readably', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);

    await givenAsset(harness, { assetCategoryId, serialNumber: 'SN-1' });

    const second = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.register-asset',
        assetCategoryId,
        assetTag: 'IT-00418',
        serialNumber: 'SN-1',
      }),
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatchObject({ kind: 'conflict', reason: 'serial_number_taken' });
  });

  /**
   * Many items have no serial number, and none of them collides with any other.
   *
   * A blank serial number is stored as absent rather than as an empty string, which is what stops
   * every unserialled chair in a tenant from being the same chair.
   */
  it('lets any number of items have no serial number at all', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);

    await givenAsset(harness, { assetCategoryId, assetTag: 'FUR-1' });
    await givenAsset(harness, { assetCategoryId, assetTag: 'FUR-2', serialNumber: '   ' });

    const listed = await harness.as(STOREKEEPER, () =>
      ask<AssetPageView>(harness, { queryName: 'assets.search-assets' }),
    );

    expect(listed.total).toBe(2);
    expect(listed.items.every((item) => item.serialNumber === undefined)).toBe(true);
  });

  it('lets an item re-send the serial number it already holds', async () => {
    const harness = harnessFor();
    const assetId = await givenAsset(harness, { serialNumber: 'SN-1' });
    const amended = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.amend-asset',
        assetId,
        expectedVersion: 1,
        serialNumber: 'SN-1',
        description: 'Corrected description',
      }),
    );

    expect(amended.ok).toBe(true);
  });

  it('refuses an amendment that would take another item’s serial number', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);

    await givenAsset(harness, { assetCategoryId, assetTag: 'IT-1', serialNumber: 'SN-1' });

    const second = await givenAsset(harness, { assetCategoryId, assetTag: 'IT-2' });
    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.amend-asset',
        assetId: second,
        expectedVersion: 1,
        serialNumber: 'SN-1',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'conflict', reason: 'serial_number_taken' });
  });

  it('moves through the lifecycle, and refuses a move the table does not permit', async () => {
    const harness = harnessFor();
    const assetId = await givenAsset(harness);

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.change-asset-status',
        assetId,
        expectedVersion: 1,
        status: 'available',
      }),
    );

    const found = await harness.as(STOREKEEPER, () =>
      ask<AssetView>(harness, { queryName: 'assets.read-asset', assetId }),
    );

    expect(found.status).toBe('available');
    expect(found.version).toBe(2);

    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.change-asset-status',
        assetId,
        expectedVersion: 2,
        status: 'registered',
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('refuses a status that names custody', async () => {
    const harness = harnessFor();
    const assetId = await givenAsset(harness);

    for (const status of ['issued', 'in_custody', 'returned']) {
      const refused = await harness.as(STOREKEEPER, () =>
        attempt(harness, {
          commandName: 'assets.change-asset-status',
          assetId,
          expectedVersion: 1,
          status,
        }),
      );

      expect(refused.ok).toBe(false);
    }
  });

  it('refuses a stale amendment rather than silently overwriting', async () => {
    const harness = harnessFor();
    const assetId = await givenAsset(harness);

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.amend-asset',
        assetId,
        expectedVersion: 1,
        description: 'First',
      }),
    );

    await expect(
      harness.as(STOREKEEPER, () =>
        attempt(harness, {
          commandName: 'assets.amend-asset',
          assetId,
          expectedVersion: 1,
          description: 'Second, from a stale screen',
        }),
      ),
    ).rejects.toThrow(/modified by someone else/);
  });
});

describe('reading the inventory', () => {
  it('narrows by category and by status, and never by tenant', async () => {
    const harness = harnessFor();
    const laptops = await givenCategory(harness, { code: 'laptop', sequence: 10 });
    const chairs = await givenCategory(harness, { code: 'chair', sequence: 20 });

    await givenAsset(harness, { assetCategoryId: laptops, assetTag: 'IT-1' });
    await givenAsset(harness, { assetCategoryId: chairs, assetTag: 'FUR-1' });

    const byCategory = await harness.as(STOREKEEPER, () =>
      ask<AssetPageView>(harness, {
        queryName: 'assets.search-assets',
        assetCategoryId: chairs,
      }),
    );

    expect(byCategory.total).toBe(1);
    expect(byCategory.items[0]?.assetTag).toBe('FUR-1');

    const byStatus = await harness.as(STOREKEEPER, () =>
      ask<AssetPageView>(harness, { queryName: 'assets.search-assets', status: 'retired' }),
    );

    expect(byStatus.total).toBe(0);
  });

  it('bounds the page size, so no caller can ask for an entire inventory at once', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);

    for (const index of [1, 2, 3]) {
      await givenAsset(harness, { assetCategoryId, assetTag: `IT-${String(index)}` });
    }

    const page = await harness.as(STOREKEEPER, () =>
      ask<AssetPageView>(harness, {
        queryName: 'assets.search-assets',
        page: 1,
        pageSize: 2,
      }),
    );

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);

    const enormous = await harness.as(STOREKEEPER, () =>
      ask<AssetPageView>(harness, {
        queryName: 'assets.search-assets',
        page: 1,
        pageSize: 100_000,
      }),
    );

    expect(enormous.items.length).toBeLessThanOrEqual(200);
  });

  it('answers not found for an item that does not exist, never forbidden', async () => {
    const harness = harnessFor();
    const refused = await harness.as(STOREKEEPER, () =>
      tryAsk(harness, {
        queryName: 'assets.read-asset',
        assetId: '01940000-0000-7000-8000-0000000000ff',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'not_found', resource: 'asset' });
  });

  /**
   * No read here writes anything, and there is no access-trail table to write into.
   *
   * An asset register is a list of laptops and names nobody. Auditing every read of one would bury
   * the reads that matter under reads that never mattered — the mechanism D-5.2-05 rejected.
   */
  it('writes nothing when it reads', async () => {
    const harness = harnessFor();
    const assetId = await givenAsset(harness);
    const before = JSON.stringify([...harness.stores.assetRows.values()]);

    await harness.as(STOREKEEPER, () =>
      ask<AssetView>(harness, { queryName: 'assets.read-asset', assetId }),
    );
    await harness.as(STOREKEEPER, () =>
      ask<AssetPageView>(harness, { queryName: 'assets.search-assets' }),
    );

    expect(JSON.stringify([...harness.stores.assetRows.values()])).toBe(before);
    expect(Object.keys(harness.stores)).not.toContain('accessRows');
  });
});
