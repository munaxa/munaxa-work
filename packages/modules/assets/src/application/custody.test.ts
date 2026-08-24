import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  STOREKEEPER,
  ask,
  attempt,
  givenAsset,
  givenAvailableAsset,
  givenCustody,
  harnessFor,
  send,
} from './assets-test-harness.js';
import type { AssetCustodyView, AssetView } from '../contracts/views.js';

/**
 * Custody through the real dispatcher and the real handlers.
 *
 * Nothing is stubbed but the database and Employment's one boolean. What is asserted is what a
 * storekeeper actually experiences: which issues succeed, which are refused and by what name, what a
 * read returns, and what the register says afterwards.
 */

describe('issuing an asset', () => {
  it('opens a custody against an employment Employment recognises', async () => {
    const harness = harnessFor();
    const { assetId, assetCustodyId } = await givenCustody(harness);
    const found = await harness.as(STOREKEEPER, () =>
      ask<AssetCustodyView>(harness, { queryName: 'assets.asset-custody', assetId }),
    );

    expect(found.current?.assetCustodyId).toBe(assetCustodyId);
    expect(found.current?.state).toBe('open');
    expect(found.current?.returnedOn).toBeUndefined();
    expect(found.history.total).toBe(1);
  });

  /**
   * An identifier a command supplies is an identifier a command can invent.
   *
   * An employment Employment does not recognise is refused as **not found** — the same answer another
   * tenant's employment gets, so the command cannot be used to enumerate a workforce.
   */
  it('refuses an employment Employment does not recognise', async () => {
    const harness = harnessFor();
    const assetId = await givenAvailableAsset(harness);
    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.issue-custody',
        assetId,
        employmentId: uuidV7(),
        issuedOn: '2026-08-20',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'not_found', resource: 'employment' });
  });

  it('writes nothing when the employment is refused', async () => {
    const harness = harnessFor();
    const assetId = await givenAvailableAsset(harness);

    await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.issue-custody',
        assetId,
        employmentId: uuidV7(),
        issuedOn: '2026-08-20',
      }),
    );

    expect(harness.stores.custodyRows.size).toBe(0);
  });

  it('refuses an asset that is already in somebody’s custody', async () => {
    const harness = harnessFor();
    const { assetId } = await givenCustody(harness);
    const second = uuidV7();

    harness.employments.add(second);

    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.issue-custody',
        assetId,
        employmentId: second,
        issuedOn: '2026-08-21',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'conflict', reason: 'asset_already_in_custody' });
  });

  /**
   * A custody may open only from `available`.
   *
   * Refused by name for each of the three ineligible statuses, because issuing a laptop that is under
   * repair, not yet in service, or retired records a handover that could not have happened.
   */
  it('refuses an asset that is not available', async () => {
    const harness = harnessFor();
    const employmentId = uuidV7();

    harness.employments.add(employmentId);

    const registered = await givenAsset(harness);
    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.issue-custody',
        assetId: registered,
        employmentId,
        issuedOn: '2026-08-20',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'conflict', reason: 'asset_not_available' });

    const repairing = await givenAvailableAsset(harness, { assetTag: 'IT-2' });

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.change-asset-status',
        assetId: repairing,
        expectedVersion: 2,
        status: 'under_repair',
      }),
    );

    const alsoRefused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.issue-custody',
        assetId: repairing,
        employmentId,
        issuedOn: '2026-08-20',
      }),
    );

    expect(alsoRefused.ok).toBe(false);
  });

  it('answers not found for an asset that does not exist', async () => {
    const harness = harnessFor();
    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.issue-custody',
        assetId: '01940000-0000-7000-8000-0000000000ff',
        employmentId: uuidV7(),
        issuedOn: '2026-08-20',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'not_found', resource: 'asset' });
  });

  /**
   * **The asset's own status does not move**, and this is Checkpoint 1's settled decision holding
   * under the capability that could most easily have broken it.
   *
   * An asset somebody is holding is still `available` — in service. Whether it is *held* is the
   * custody table's answer, and a copy on `asset` would be a second one that goes stale.
   */
  it('leaves the asset available, because in-custody is not a status', async () => {
    const harness = harnessFor();
    const { assetId } = await givenCustody(harness);
    const asset = await harness.as(STOREKEEPER, () =>
      ask<AssetView>(harness, { queryName: 'assets.read-asset', assetId }),
    );

    expect(asset.status).toBe('available');
    expect(Object.keys(asset)).not.toContain('currentCustodyId');
    expect(Object.keys(asset)).not.toContain('employmentId');
  });
});

describe('returning an asset', () => {
  it('closes the custody and leaves the asset holdable again', async () => {
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

    const found = await harness.as(STOREKEEPER, () =>
      ask<AssetCustodyView>(harness, { queryName: 'assets.asset-custody', assetId }),
    );

    expect(found.current).toBeUndefined();
    expect(found.history.total).toBe(1);
    expect(found.history.items[0]?.state).toBe('returned');
    expect(found.history.items[0]?.returnedOn).toBe('2026-08-22');

    const next = uuidV7();

    harness.employments.add(next);

    const reissued = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.issue-custody',
        assetId,
        employmentId: next,
        issuedOn: '2026-08-23',
      }),
    );

    expect(reissued.ok).toBe(true);
  });

  it('accumulates a history of periods, newest first', async () => {
    const harness = harnessFor();
    const { assetId, assetCustodyId } = await givenCustody(harness);

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-21',
      }),
    );
    await givenCustody(harness, { assetId, issuedOn: '2026-08-22' });

    const found = await harness.as(STOREKEEPER, () =>
      ask<AssetCustodyView>(harness, { queryName: 'assets.asset-custody', assetId }),
    );

    expect(found.history.total).toBe(2);
    expect(found.history.items[0]?.issuedOn).toBe('2026-08-22');
    expect(found.current?.issuedOn).toBe('2026-08-22');
  });

  it('refuses a second return of the same custody', async () => {
    const harness = harnessFor();
    const { assetCustodyId } = await givenCustody(harness);

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-22',
      }),
    );

    const again = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 2,
        returnedOn: '2026-08-23',
      }),
    );

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toMatchObject({ kind: 'rejected' });
  });

  it('answers not found for a custody that does not exist', async () => {
    const harness = harnessFor();
    const refused = await harness.as(STOREKEEPER, () =>
      attempt(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId: '01940000-0000-7000-8000-0000000000ff',
        expectedVersion: 1,
        returnedOn: '2026-08-22',
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'not_found', resource: 'asset_custody' });
  });

  /**
   * A second return never reaches the store, and the row moves exactly once.
   *
   * The domain refuses `custody_not_open` before the version predicate is consulted, which is the
   * better of the two refusals: the caller gets a sentence rather than a concurrency error. The
   * version predicate is still what settles a genuine *simultaneous* pair, and that is proved against
   * two real PostgreSQL connections rather than here — a map cannot contend with itself.
   */
  it('moves the row exactly once, however many returns are attempted', async () => {
    const harness = harnessFor();
    const { assetCustodyId } = await givenCustody(harness);

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-22',
      }),
    );

    for (const expectedVersion of [1, 2, 3]) {
      const again = await harness.as(STOREKEEPER, () =>
        attempt(harness, {
          commandName: 'assets.return-custody',
          assetCustodyId,
          expectedVersion,
          returnedOn: '2026-08-23',
        }),
      );

      expect(again.ok).toBe(false);
    }

    const held = harness.stores.custodyRows.get(assetCustodyId);

    expect(held?.version).toBe(2);
    expect(held?.returnedOn).toBe('2026-08-22');
  });
});
