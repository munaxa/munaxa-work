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
import type { AssetCustodyView, CustodyPageView, CustodySummaryView } from '../contracts/views.js';

/**
 * What the custody reads report, and what they refuse to report.
 *
 * The arithmetic itself is proved in `custody-ageing.test.ts`. This suite proves the things only the
 * handlers can be wrong about: that the date a figure was measured against is the date the response
 * says it was, that a caller cannot get a figure measured against a date they cannot see, and that the
 * tenant-wide summary and a custody's own ageing never disagree.
 */

let harness: Harness;

beforeEach(() => {
  harness = harnessFor();
});

const readAsset = (assetId: string, asAt?: string): Promise<AssetCustodyView> =>
  harness.as(STOREKEEPER, () =>
    ask<AssetCustodyView>(harness, {
      queryName: 'assets.asset-custody',
      assetId,
      ...(asAt === undefined ? {} : { asAt }),
    }),
  );

const readSummary = (asAt?: string): Promise<CustodySummaryView> =>
  harness.as(ADMINISTRATOR, () =>
    ask<CustodySummaryView>(harness, {
      queryName: 'assets.custody-summary',
      ...(asAt === undefined ? {} : { asAt }),
    }),
  );

describe('a custody reports how long it has been out', () => {
  it('ages an open custody against the date the caller named, and echoes that date', () => {
    return (async () => {
      const { assetId } = await givenCustody(harness, { issuedOn: '2026-08-01' });
      const read = await readAsset(assetId, '2026-08-23');

      expect(read.asAt).toBe('2026-08-23');
      expect(read.current?.daysOutstanding).toBe(22);
    })();
  });

  /**
   * The default is the server's own day, and it is echoed for exactly the same reason a supplied one
   * is: a figure whose measurement date the caller cannot see is a figure they cannot check.
   */
  it('falls back to the server’s day when no date is given, and still says which day that was', async () => {
    const { assetId } = await givenCustody(harness, { issuedOn: '2026-08-20' });
    const read = await readAsset(assetId);

    expect(read.asAt).toBe('2026-08-23');
    expect(read.current?.daysOutstanding).toBe(3);
  });

  it('publishes a closed span once the asset comes back, and no outstanding figure', async () => {
    const { assetId, assetCustodyId } = await givenCustody(harness, { issuedOn: '2026-08-01' });

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-11',
      }),
    );

    const read = await readAsset(assetId, '2026-12-31');
    const closed = read.history.items[0];

    expect(read.current).toBeUndefined();
    expect(closed?.daysHeld).toBe(10);
    expect(closed).not.toHaveProperty('daysOutstanding');
  });

  it('reports nothing at all for a date before the custody was issued', async () => {
    const { assetId } = await givenCustody(harness, { issuedOn: '2026-08-20' });
    const read = await readAsset(assetId, '2026-08-19');

    expect(read.current).not.toHaveProperty('daysOutstanding');
  });

  /**
   * A date the module could not parse is refused rather than replaced with today. A quietly
   * substituted date produces a report that is internally consistent and answers a different question
   * than the one asked, which is the failure mode nobody notices.
   */
  it('refuses a malformed date rather than quietly using today', async () => {
    const { assetId } = await givenCustody(harness);
    const refused = await harness.as(STOREKEEPER, () =>
      tryAsk(harness, { queryName: 'assets.asset-custody', assetId, asAt: '23-08-2026' }),
    );

    expect(refused.ok).toBe(false);
    expect(refused.ok ? undefined : refused.error).toMatchObject({ kind: 'rejected' });
  });

  it('refuses a malformed date on the employment read too, not only on one of them', async () => {
    const refused = await harness.as(STOREKEEPER, () =>
      tryAsk(harness, {
        queryName: 'assets.employment-custody',
        employmentId: uuidV7(),
        asAt: 'yesterday',
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('ages what one employment holds, and echoes the date on that read as well', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, { employmentId, issuedOn: '2026-08-13' });

    const page = await harness.as(STOREKEEPER, () =>
      ask<CustodyPageView>(harness, {
        queryName: 'assets.employment-custody',
        employmentId,
        openOnly: true,
        asAt: '2026-08-23',
      }),
    );

    expect(page.asAt).toBe('2026-08-23');
    expect(page.items[0]?.daysOutstanding).toBe(10);
  });
});

describe('the tenant summary', () => {
  it('is zero and dateless in a tenant that has issued nothing', async () => {
    const summary = await readSummary('2026-08-23');

    expect(summary).toEqual({ asAt: '2026-08-23', openCount: 0 });
  });

  it('counts what is open and names the oldest issue date', async () => {
    await givenCustody(harness, { issuedOn: '2026-08-01' });
    await givenCustody(harness, {
      assetId: await givenAvailableAsset(harness, { assetTag: 'IT-00418' }),
      issuedOn: '2026-08-20',
    });

    const summary = await readSummary('2026-08-23');

    expect(summary.openCount).toBe(2);
    expect(summary.oldestIssuedOn).toBe('2026-08-01');
    expect(summary.longestDaysOutstanding).toBe(22);
  });

  /**
   * The summary and the item reads are two implementations of the same question, and the whole reason
   * `longestDaysOutstanding` is derived in the application rather than computed in SQL is that they
   * must not be able to disagree. This is the assertion that would catch it if they ever did.
   */
  it('agrees exactly with the oldest custody’s own figure', async () => {
    const { assetId } = await givenCustody(harness, { issuedOn: '2026-07-04' });

    const summary = await readSummary('2026-08-23');
    const read = await readAsset(assetId, '2026-08-23');

    expect(summary.longestDaysOutstanding).toBe(read.current?.daysOutstanding);
  });

  it('stops counting a custody once it has come back', async () => {
    const { assetCustodyId } = await givenCustody(harness, { issuedOn: '2026-08-01' });

    await harness.as(STOREKEEPER, () =>
      send(harness, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-11',
      }),
    );

    expect(await readSummary('2026-08-23')).toEqual({ asAt: '2026-08-23', openCount: 0 });
  });

  /**
   * The summary is the one read here that is not narrowed to a subject, and this is what makes that
   * acceptable: it names nothing. An identifier appearing in this payload would turn a dashboard
   * number into the tenant-wide custody listing this module refuses to publish.
   */
  it('publishes no identifier of any kind', async () => {
    const employmentId = uuidV7();
    const { assetId, assetCustodyId } = await givenCustody(harness, {
      employmentId,
      issuedOn: '2026-08-01',
    });

    const rendered = JSON.stringify(await readSummary('2026-08-23'));

    for (const identifier of [employmentId, assetId, assetCustodyId]) {
      expect(rendered).not.toContain(identifier);
    }
    expect(Object.keys(await readSummary('2026-08-23')).sort()).toEqual([
      'asAt',
      'longestDaysOutstanding',
      'oldestIssuedOn',
      'openCount',
    ]);
  });

  it('reports no elapsed figure for a date before anything was issued', async () => {
    await givenCustody(harness, { issuedOn: '2026-08-20' });

    const summary = await readSummary('2026-08-01');

    expect(summary.oldestIssuedOn).toBe('2026-08-20');
    expect(summary).not.toHaveProperty('longestDaysOutstanding');
  });

  it('is refused without the custody read permission, and reveals nothing in the refusal', async () => {
    const withoutRead = harnessFor({
      permissions: Object.values(AssetsPermissions).filter(
        (permission) => permission !== AssetsPermissions.custodyRead,
      ),
    });

    const refused = await withoutRead.as(ADMINISTRATOR, () =>
      tryAsk(withoutRead, { queryName: 'assets.custody-summary' }),
    );

    expect(refused.ok).toBe(false);
  });
});

/**
 * The summary answers a question about custody, and about nothing else.
 *
 * D-5.3-01 — what should happen to a custody whose employment has ended — is open, and these reads are
 * built so they cannot answer it by accident. Nothing here asks Employment anything, so an ended
 * employment's custody is counted and aged exactly like an active one's.
 */
describe('what the reporting reads deliberately do not know', () => {
  it('ages a custody without asking Employment anything at all', async () => {
    const employmentId = uuidV7();

    await givenCustody(harness, { employmentId, issuedOn: '2026-08-01' });

    // The directory is the module's only cross-module dependency. A read that consulted it would be
    // the beginning of employment-status-aware reporting, which no decision has authorized.
    let asked = false;
    const watched = harness.employments.exists.bind(harness.employments);

    harness.employments.exists = (identifier: string): Promise<boolean> => {
      asked = true;
      return watched(identifier);
    };

    await readSummary('2026-08-23');
    await harness.as(STOREKEEPER, () =>
      ask<CustodyPageView>(harness, {
        queryName: 'assets.employment-custody',
        employmentId,
        asAt: '2026-08-23',
      }),
    );

    expect(asked).toBe(false);
  });
});
