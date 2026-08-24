import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  STOREKEEPER,
  ask,
  attempt,
  givenAvailableAsset,
  givenCustody,
  harnessFor,
  send,
  tryAsk,
} from './assets-test-harness.js';
import type { AssetCustodyView, AssetView, CustodyPageView } from '../contracts/views.js';

/**
 * What the custody register says, and what it refuses to let happen to an asset that is still out.
 *
 * Split from `custody.test.ts` when the two together passed the 400-line file budget — split at the
 * seam that was already there rather than exempted: one file is about issuing and returning, this one
 * about the register those two produce.
 */

describe('retiring an asset somebody is holding', () => {
  /**
   * D-5.3-09, approved: an asset in open custody cannot be retired.
   *
   * Retiring an item that is still out would remove it from the register while the obligation stands
   * — and the register of open custodies is exactly what offboarding clearance will read.
   */
  it('is refused while the custody is open', async () => {
    const harness = harnessFor();
    const { assetId } = await givenCustody(harness);
    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.change-asset-status',
        assetId,
        expectedVersion: 2,
        status: 'retired',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'conflict', reason: 'asset_in_custody' });
  });

  it('is permitted once the asset has come back', async () => {
    const harness = harnessFor();
    const { assetId, assetCustodyId } = await givenCustody(harness);

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-22',
      }),
    );

    const retired = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.change-asset-status',
        assetId,
        expectedVersion: 2,
        status: 'retired',
      }),
    );

    expect(retired.ok).toBe(true);
  });

  /**
   * The rule is a retirement rule and nothing wider.
   *
   * An asset in custody can still go for repair: that is a fact about the item, not a disposal, and
   * refusing it would be inventing a rule nobody approved.
   */
  it('does not block any other status move', async () => {
    const harness = harnessFor();
    const { assetId } = await givenCustody(harness);
    const moved = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.change-asset-status',
        assetId,
        expectedVersion: 2,
        status: 'under_repair',
      }),
    );

    expect(moved.ok).toBe(true);
  });

  /** Nothing closes the custody on the caller's behalf. The refusal is an invariant, not a workflow. */
  it('closes no custody and changes nothing when it refuses', async () => {
    const harness = harnessFor();
    const { assetId, assetCustodyId } = await givenCustody(harness);

    await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.change-asset-status',
        assetId,
        expectedVersion: 2,
        status: 'retired',
      }),
    );

    expect(harness.stores.custodyRows.get(assetCustodyId)?.state).toBe('open');
    expect(harness.stores.assetRows.get(assetId)?.status).toBe('available');
  });
});

describe('reading custody', () => {
  it('answers what one employment holds, and narrows to what is still out', async () => {
    const harness = harnessFor();
    const employmentId = uuidV7();

    harness.employments.add(employmentId);

    const first = await givenCustody(harness, { employmentId });
    const second = await givenCustody(harness, {
      employmentId,
      assetId: await givenAvailableAsset(harness, { assetTag: 'IT-2' }),
    });

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId: first.assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-22',
      }),
    );

    const all = await harness.as(STOREKEEPER, () =>
      ask<CustodyPageView>(harness, { queryName: 'assets.employment-custody', employmentId }),
    );
    const outstanding = await harness.as(STOREKEEPER, () =>
      ask<CustodyPageView>(harness, {
        queryName: 'assets.employment-custody',
        employmentId,
        openOnly: true,
      }),
    );

    expect(all.total).toBe(2);
    expect(outstanding.total).toBe(1);
    expect(outstanding.items[0]?.assetCustodyId).toBe(second.assetCustodyId);
  });

  it('bounds the page size, so no caller can ask for an entire register at once', async () => {
    const harness = harnessFor();
    const employmentId = uuidV7();

    harness.employments.add(employmentId);

    for (const tag of ['IT-1', 'IT-2', 'IT-3']) {
      await givenCustody(harness, {
        employmentId,
        assetId: await givenAvailableAsset(harness, { assetTag: tag }),
      });
    }

    const page = await harness.as(STOREKEEPER, () =>
      ask<CustodyPageView>(harness, {
        queryName: 'assets.employment-custody',
        employmentId,
        page: 1,
        pageSize: 2,
      }),
    );
    const enormous = await harness.as(STOREKEEPER, () =>
      ask<CustodyPageView>(harness, {
        queryName: 'assets.employment-custody',
        employmentId,
        pageSize: 100_000,
      }),
    );

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(enormous.items.length).toBeLessThanOrEqual(200);
  });

  it('answers not found for an asset that does not exist', async () => {
    const harness = harnessFor();
    const refused = await harness.as(STOREKEEPER, () =>
      tryAsk(harness, {
        queryName: 'assets.asset-custody',
        assetId: '01940000-0000-7000-8000-0000000000ff',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'not_found', resource: 'asset' });
  });

  /**
   * An employment nobody has issued anything to holds nothing.
   *
   * Answering with an empty page rather than a refusal is deliberate: a read that distinguished "no
   * such employment" from "holds nothing" would be an existence oracle for the workforce.
   */
  it('answers an unknown employment with an empty page rather than a refusal', async () => {
    const harness = harnessFor();
    const found = await harness.as(STOREKEEPER, () =>
      ask<CustodyPageView>(harness, {
        queryName: 'assets.employment-custody',
        employmentId: uuidV7(),
      }),
    );

    expect(found.total).toBe(0);
    expect(found.items).toEqual([]);
  });

  it('writes nothing when it reads', async () => {
    const harness = harnessFor();
    const { assetId } = await givenCustody(harness);
    const before = JSON.stringify([...harness.stores.custodyRows.values()]);

    await harness.as(STOREKEEPER, () =>
      ask<AssetCustodyView>(harness, { queryName: 'assets.asset-custody', assetId }),
    );

    expect(JSON.stringify([...harness.stores.custodyRows.values()])).toBe(before);
    expect(Object.keys(harness.stores)).not.toContain('accessRows');
  });

  /** Custody names an employment; the inventory read must not, or the permission split is decorative. */
  it('keeps the employment out of the asset read', async () => {
    const harness = harnessFor();
    const { assetId } = await givenCustody(harness);
    const asset = await harness.as(STOREKEEPER, () =>
      ask<AssetView>(harness, { queryName: 'assets.read-asset', assetId }),
    );

    expect(JSON.stringify(asset)).not.toContain('employment');
  });
});
