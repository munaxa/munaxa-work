import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  STOREKEEPER,
  ask,
  attempt,
  givenCategory,
  harnessFor,
  send,
} from './assets-test-harness.js';
import type { AssetCategoryView } from '../contracts/views.js';

/**
 * The catalogue, through the real dispatcher and the real handlers.
 *
 * The inventory is next door in `assets-inventory.test.ts`; the two were split when they passed the
 * 400-line file budget together, at the seam that was already there rather than by exemption.
 *
 * Nothing is stubbed except the database. What is asserted is what a caller actually experiences:
 * which commands succeed, which are refused and by what name, what a read returns, and what a read
 * does not return.
 */

describe('the catalogue, end to end', () => {
  it('defines an entry and lists it', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);
    const listed = await harness.as(STOREKEEPER, () =>
      ask<readonly AssetCategoryView[]>(harness, { queryName: 'assets.categories' }),
    );

    expect(listed).toHaveLength(1);
    expect(listed[0]?.assetCategoryId).toBe(assetCategoryId);
    expect(listed[0]?.code).toBe('laptop');
    expect(listed[0]?.active).toBe(true);
  });

  it('orders by sequence, then code — never by insertion or alphabetically', async () => {
    const harness = harnessFor();

    await givenCategory(harness, { code: 'zebra-crossing', sequence: 1 });
    await givenCategory(harness, { code: 'monitor', sequence: 20 });
    await givenCategory(harness, { code: 'access-card', sequence: 20 });

    const listed = await harness.as(STOREKEEPER, () =>
      ask<readonly AssetCategoryView[]>(harness, { queryName: 'assets.categories' }),
    );

    expect(listed.map((entry) => entry.code)).toEqual(['zebra-crossing', 'access-card', 'monitor']);
  });

  it('refuses a second entry with the same code, readably', async () => {
    const harness = harnessFor();

    await givenCategory(harness);

    const second = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'assets.define-category',
        code: 'laptop',
        name: { en: 'Laptop again', ar: 'حاسوب' },
        sequence: 20,
      }),
    );

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatchObject({ kind: 'conflict', reason: 'category_code_taken' });
  });

  it('hides deactivated entries by default and shows them on request', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'assets.amend-category',
        assetCategoryId,
        expectedVersion: 1,
        active: false,
      }),
    );

    const byDefault = await harness.as(STOREKEEPER, () =>
      ask<readonly AssetCategoryView[]>(harness, { queryName: 'assets.categories' }),
    );
    const including = await harness.as(STOREKEEPER, () =>
      ask<readonly AssetCategoryView[]>(harness, {
        queryName: 'assets.categories',
        includeInactive: true,
      }),
    );

    expect(byDefault).toHaveLength(0);
    expect(including).toHaveLength(1);
  });

  it('re-checks every invariant on amendment, so an amendment cannot do what a definition could not', async () => {
    const harness = harnessFor();
    const assetCategoryId = await givenCategory(harness);
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'assets.amend-category',
        assetCategoryId,
        expectedVersion: 1,
        sequence: -1,
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'rejected' });
  });

  it('answers not found for an entry that does not exist, never forbidden', async () => {
    const harness = harnessFor();
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'assets.amend-category',
        assetCategoryId: '01940000-0000-7000-8000-0000000000ff',
        expectedVersion: 1,
        sequence: 5,
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'not_found', resource: 'asset_category' });
  });
});
