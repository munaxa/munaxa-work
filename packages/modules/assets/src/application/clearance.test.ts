import { uuidV7 } from '@work/kernel';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  STOREKEEPER,
  ask,
  givenAvailableAsset,
  givenCustody,
  harnessFor,
  send,
  tryAsk,
  type Harness,
} from './assets-test-harness.js';
import { AssetsPermissions } from './assets-permissions.js';
import type { AssetClearanceView } from '../contracts/views.js';

/**
 * What Assets contributes to an offboarding clearance — AD-006, under approved D-5.3-01(a).
 *
 * The rule under test is two lines: an open custody is outstanding, a returned one is not. Everything
 * here is an edge of that — the wrong employment, the wrong tenant, a returned row, a bound that
 * truncates — plus the assertions that keep this read from growing into the clearance *decision*,
 * which belongs to Offboarding and not to this module.
 */

let harness: Harness;

beforeEach(() => {
  harness = harnessFor();
});

const clearanceOf = (employmentId: string, asAt?: string): Promise<AssetClearanceView> =>
  harness.as(STOREKEEPER, () =>
    ask<AssetClearanceView>(harness, {
      queryName: 'assets.employment-clearance',
      employmentId,
      ...(asAt === undefined ? {} : { asAt }),
    }),
  );

describe('whether company assets block a clearance', () => {
  it('reports an employment holding nothing as clear', async () => {
    const clearance = await clearanceOf(uuidV7(), '2026-08-23');

    expect(clearance.assetsClear).toBe(true);
    expect(clearance.outstandingCount).toBe(0);
    expect(clearance.blockers).toEqual([]);
  });

  it('reports one open custody as one blocker, named well enough to act on', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, { employmentId, issuedOn: '2026-08-01' });

    const clearance = await clearanceOf(employmentId, '2026-08-23');

    expect(clearance.assetsClear).toBe(false);
    expect(clearance.outstandingCount).toBe(1);
    expect(clearance.blockers).toHaveLength(1);
    expect(clearance.blockers[0]?.assetTag).toBe('IT-00417');
    expect(clearance.blockers[0]?.issuedOn).toBe('2026-08-01');
    expect(clearance.blockers[0]?.daysOutstanding).toBe(22);
  });

  it('reports every open custody, not just the first', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, { employmentId, issuedOn: '2026-08-01' });
    await givenCustody(harness, {
      employmentId,
      assetId: await givenAvailableAsset(harness, { assetTag: 'IT-00418' }),
      issuedOn: '2026-08-10',
    });

    const clearance = await clearanceOf(employmentId, '2026-08-23');

    expect(clearance.outstandingCount).toBe(2);
    // Oldest first: the item held longest is where a clearance conversation starts.
    expect(clearance.blockers.map((blocker) => blocker.assetTag)).toEqual(['IT-00417', 'IT-00418']);
  });

  /**
   * The one transition that clears a blocker, and the only one there is.
   *
   * Nothing resolves a blocker automatically — not an employment ending, not a job, not a timer. A
   * person returns the asset through the ordinary command, and the same read then reports clear.
   */
  it('stops blocking once a human records the return, and only then', async () => {
    const employmentId = uuidV7();
    const { assetCustodyId } = await givenCustody(harness, {
      employmentId,
      issuedOn: '2026-08-01',
    });

    expect((await clearanceOf(employmentId, '2026-08-23')).assetsClear).toBe(false);

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-20',
      }),
    );

    const after = await clearanceOf(employmentId, '2026-08-23');

    expect(after.assetsClear).toBe(true);
    expect(after.outstandingCount).toBe(0);
    expect(after.blockers).toEqual([]);
  });

  it('does not let one employment’s custody block another’s clearance', async () => {
    const holder = uuidV7();
    const somebodyElse = uuidV7();

    await givenCustody(harness, { employmentId: holder, issuedOn: '2026-08-01' });

    expect((await clearanceOf(holder, '2026-08-23')).assetsClear).toBe(false);
    expect((await clearanceOf(somebodyElse, '2026-08-23')).assetsClear).toBe(true);
  });
});

/**
 * The approved rule, asserted as behaviour rather than trusted as prose.
 *
 * D-5.3-01(a): *"An employment ending does not automatically close, cancel, transfer, or alter an open
 * asset custody period."* Assets never learns that an employment ended (D-5.3-11), so the way to prove
 * the rule holds is to prove the read never asks — an answer that cannot depend on employment status
 * cannot change when it changes.
 */
describe('the approved D-5.3-01(a) semantics', () => {
  it('answers without asking Employment anything at all', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, { employmentId, issuedOn: '2026-08-01' });

    let asked = false;
    const watched = harness.employments.exists.bind(harness.employments);

    harness.employments.exists = (identifier: string): Promise<boolean> => {
      asked = true;
      return watched(identifier);
    };

    const clearance = await clearanceOf(employmentId, '2026-08-23');

    expect(asked).toBe(false);
    expect(clearance.assetsClear).toBe(false);
  });

  /**
   * The consequence the approval states explicitly, and it is intentional.
   *
   * An employment Employment no longer recognises at all — the strongest form of "ended" this module
   * can observe — still blocks, because the custody row is the truth and nothing closed it.
   */
  it('keeps blocking for an employment Assets can no longer confirm exists', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, { employmentId, issuedOn: '2026-08-01' });

    // The directory forgets it entirely. Nothing about the custody changes.
    harness.employments.exists = (): Promise<boolean> => Promise.resolve(false);

    const clearance = await clearanceOf(employmentId, '2026-08-23');

    expect(clearance.assetsClear).toBe(false);
    expect(clearance.outstandingCount).toBe(1);
    expect(harness.stores.custodyRows.size).toBe(1);
    expect([...harness.stores.custodyRows.values()][0]?.state).toBe('open');
  });

  it('changes nothing it reads on — the read is a read', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, { employmentId, issuedOn: '2026-08-01' });

    const before = structuredClone([...harness.stores.custodyRows.values()]);

    await clearanceOf(employmentId, '2026-08-23');
    await clearanceOf(employmentId, '2027-01-01');

    expect([...harness.stores.custodyRows.values()]).toEqual(before);
    expect([...harness.stores.assetRows.values()].map((asset) => asset.status)).toEqual([
      'available',
    ]);
  });
});

/**
 * The property the whole shape is arranged around.
 *
 * `assetsClear` follows `outstandingCount`, never `blockers.length`. The list is bounded and the count
 * is not, so the only way this read can be wrong is in the safe direction: it may under-report *which*
 * items block, and it can never report a blocked employment as clear.
 *
 * Seeded through the stores rather than through six hundred commands — the command path is proved
 * elsewhere, and what is under test here is the read's arithmetic at its bound.
 */
describe('the bound on the blocker list', () => {
  const seedOutstanding = (employmentId: string, count: number): void => {
    const assetCategoryId = uuidV7();

    for (let index = 0; index < count; index += 1) {
      const assetId = uuidV7();
      const assetCustodyId = uuidV7();

      harness.stores.assetRows.set(assetId, {
        assetId,
        assetCategoryId,
        assetTag: `IT-${String(index).padStart(5, '0')}`,
        status: 'available',
        version: 1,
      });
      harness.stores.custodyRows.set(assetCustodyId, {
        assetCustodyId,
        assetId,
        employmentId,
        issuedOn: '2026-08-01',
        state: 'open',
        version: 1,
      });
    }
  };

  it('truncates the list without ever reporting the employment as clear', async () => {
    const employmentId = uuidV7();

    seedOutstanding(employmentId, 250);

    const clearance = await clearanceOf(employmentId, '2026-08-23');

    expect(clearance.assetsClear).toBe(false);
    expect(clearance.outstandingCount).toBe(250);
    // Bounded, and the truncation is visible to the caller rather than silent: the count exceeds the
    // list, which is exactly how somebody reading the response learns there is more.
    expect(clearance.blockers).toHaveLength(200);
    expect(clearance.outstandingCount).toBeGreaterThan(clearance.blockers.length);
  });

  it('never publishes more blockers than it counts', async () => {
    const employmentId = uuidV7();

    for (const count of [0, 1, 199, 200, 201]) {
      harness = harnessFor();
      seedOutstanding(employmentId, count);

      const clearance = await clearanceOf(employmentId, '2026-08-23');

      expect(clearance.outstandingCount).toBe(count);
      expect(clearance.blockers.length).toBeLessThanOrEqual(clearance.outstandingCount);
      expect(clearance.assetsClear).toBe(count === 0);
    }
  });
});

describe('what the clearance read publishes, and what it refuses to', () => {
  /**
   * `assetsClear`, never `clear`.
   *
   * Offboarding (Phase 11.2) decides whether a person is cleared, across domains this module knows
   * nothing about. A field called `clear` here would be read as the whole answer and would be wrong
   * the first time anything outside Assets blocked an exit.
   */
  it('claims only what Assets knows, and pins the exact shape', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, { employmentId, issuedOn: '2026-08-01' });

    const clearance = await clearanceOf(employmentId, '2026-08-23');

    expect(Object.keys(clearance).sort()).toEqual([
      'asAt',
      'assetsClear',
      'blockers',
      'employmentId',
      'outstandingCount',
    ]);
    expect(clearance).not.toHaveProperty('clear');
    expect(Object.keys(clearance.blockers[0] ?? {}).sort()).toEqual([
      'assetCategoryId',
      'assetCustodyId',
      'assetId',
      'assetTag',
      'daysOutstanding',
      'issuedOn',
    ]);
  });

  it('carries no tenant, no actor, no note and no employment status', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, {
      employmentId,
      issuedOn: '2026-08-01',
      issueNote: 'handed over at the front desk',
    });

    const rendered = JSON.stringify(await clearanceOf(employmentId, '2026-08-23'));

    for (const absent of ['tenant', 'actor', 'front desk', 'issueNote', 'status', 'personId']) {
      expect(rendered).not.toContain(absent);
    }
  });

  it('refuses a malformed date rather than quietly using today', async () => {
    const refused = await harness.as(STOREKEEPER, () =>
      tryAsk(harness, {
        queryName: 'assets.employment-clearance',
        employmentId: uuidV7(),
        asAt: '23-08-2026',
      }),
    );

    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.error).toMatchObject({ kind: 'rejected' });
  });

  it('is refused without the custody read permission', async () => {
    const withoutRead = harnessFor({
      permissions: Object.values(AssetsPermissions).filter(
        (permission) => permission !== AssetsPermissions.custodyRead,
      ),
    });

    const refused = await withoutRead.as(ADMINISTRATOR, () =>
      tryAsk(withoutRead, { queryName: 'assets.employment-clearance', employmentId: uuidV7() }),
    );

    expect(refused.ok).toBe(false);
  });

  it('needs no permission of its own — clearance is a projection of custody', () => {
    expect(Object.values(AssetsPermissions)).toHaveLength(7);

    for (const absent of ['assets.clearance.read', 'assets.clearance', 'assets.offboarding.read']) {
      expect(Object.values(AssetsPermissions) as readonly string[]).not.toContain(absent);
    }
  });
});
