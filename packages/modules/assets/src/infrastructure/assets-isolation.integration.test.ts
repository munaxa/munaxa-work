import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  ASSETS_TABLES,
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openAssetsFixture,
  requireDatabaseInCi,
  type AssetsFixture,
} from './assets-database.fixture.js';

/**
 * Row-level security over both tables, against real PostgreSQL, as an **unprivileged role**.
 *
 * The role holds no `BYPASSRLS` and owns nothing. That is the whole point: a suite run as a superuser
 * would report that one organisation cannot read another's inventory without having checked.
 *
 * **Every isolation assertion confirms the other tenant's row exists.** A "0 rows" that came from a
 * row never written proves nothing; a "0 rows" over a row the admin connection can see is a policy
 * doing its job. And it is asserted in **both directions**, because a policy that filtered one way
 * only would pass a one-directional test.
 */

requireDatabaseInCi('Assets isolation');

describe.skipIf(CONNECTION === undefined)('assets, across tenants', () => {
  let fixture: AssetsFixture;

  beforeAll(async () => {
    fixture = await openAssetsFixture('assets_isolation_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const givenCategory = (tenantId: string, code: string): Promise<string> =>
    fixture.asTenant(tenantId, async (transaction) => {
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

  const givenAsset = (tenantId: string, categoryId: string, tag: string): Promise<string> =>
    fixture.asTenant(tenantId, async (transaction) => {
      const id = uuidV7();

      await fixture.stores.assets.insert(transaction, {
        assetId: id,
        assetCategoryId: categoryId,
        assetTag: tag,
        status: 'registered',
        version: 1,
      });
      return id;
    });

  const givenCustodyFor = (
    tenantId: string,
    assetId: string,
    employmentId: string,
    issuedOn: string,
  ): Promise<void> =>
    fixture.asTenant(tenantId, (transaction) =>
      fixture.stores.custodies.insert(transaction, {
        assetCustodyId: uuidV7(),
        assetId,
        employmentId,
        issuedOn,
        state: 'open',
        version: 1,
      }),
    );

  const givenCustody = (tenantId: string, assetId: string, issuedOn: string): Promise<void> =>
    fixture.asTenant(tenantId, (transaction) =>
      fixture.stores.custodies.insert(transaction, {
        assetCustodyId: uuidV7(),
        assetId,
        employmentId: uuidV7(),
        issuedOn,
        state: 'open',
        version: 1,
      }),
    );

  it('shows a tenant its own catalogue and none of its neighbour’s', async () => {
    const mine = await givenCategory(TENANT_A, 'laptop');
    const theirs = await givenCategory(TENANT_B, 'vehicle');

    const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.categories.all(transaction, true),
    );
    const seenByB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.categories.all(transaction, true),
    );

    expect(seenByA.map((entry) => entry.assetCategoryId)).toEqual([mine]);
    expect(seenByB.map((entry) => entry.assetCategoryId)).toEqual([theirs]);

    // Both rows genuinely exist — so the two "not visible" results above are a policy, not an
    // absence.
    const all = await fixture.admin.query<{ id: string }>('select id from asset_category');

    expect(all.rows).toHaveLength(2);
  });

  it('answers “not found” for a neighbour’s asset, in both directions', async () => {
    const categoryA = await givenCategory(TENANT_A, 'laptop');
    const categoryB = await givenCategory(TENANT_B, 'laptop');
    const assetA = await givenAsset(TENANT_A, categoryA, 'A-1');
    const assetB = await givenAsset(TENANT_B, categoryB, 'B-1');

    const aReadingB = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assets.byId(transaction, assetB),
    );
    const bReadingA = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.assets.byId(transaction, assetA),
    );

    expect(aReadingB).toBeUndefined();
    expect(bReadingA).toBeUndefined();

    const seenByAdmin = await fixture.admin.query('select id from asset');

    expect(seenByAdmin.rows).toHaveLength(2);
  });

  /**
   * Identity is per tenant, not global.
   *
   * Two organisations may both label a laptop `IT-00417`, and both may hold the same manufacturer's
   * serial number if they bought from the same reseller's stock list by mistake. The unique indexes
   * are keyed on `(tenant_id, …)`, and this proves the tenant is genuinely part of the key.
   */
  it('lets two tenants use the same tag, the same serial number and the same code', async () => {
    const categoryA = await givenCategory(TENANT_A, 'laptop');
    const categoryB = await givenCategory(TENANT_B, 'laptop');

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.assets.insert(transaction, {
        assetId: uuidV7(),
        assetCategoryId: categoryA,
        assetTag: 'IT-00417',
        serialNumber: 'SN-1',
        status: 'registered',
        version: 1,
      }),
    );

    await expect(
      fixture.asTenant(TENANT_B, (transaction) =>
        fixture.stores.assets.insert(transaction, {
          assetId: uuidV7(),
          assetCategoryId: categoryB,
          assetTag: 'IT-00417',
          serialNumber: 'SN-1',
          status: 'registered',
          version: 1,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * The tenant-wide summary is the one read in this module that names no subject, and that is exactly
   * why its isolation is proved here rather than assumed from the others.
   *
   * A count is the easiest read to get wrong: `select count(*)` over a table whose policy did not
   * apply returns a number with no row to point at, so nothing about the result looks suspicious. The
   * assertion is therefore in both directions and against a known total the admin connection can see.
   */
  it('counts only its own tenant’s open custody, in both directions', async () => {
    const categoryA = await givenCategory(TENANT_A, 'laptop');
    const categoryB = await givenCategory(TENANT_B, 'laptop');
    const assetA = await givenAsset(TENANT_A, categoryA, 'A-1');
    const assetB1 = await givenAsset(TENANT_B, categoryB, 'B-1');
    const assetB2 = await givenAsset(TENANT_B, categoryB, 'B-2');

    await givenCustody(TENANT_A, assetA, '2026-07-01');
    await givenCustody(TENANT_B, assetB1, '2026-01-15');
    await givenCustody(TENANT_B, assetB2, '2026-08-01');

    const summaryA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.custodies.openSummary(transaction),
    );
    const summaryB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.custodies.openSummary(transaction),
    );

    expect(summaryA).toEqual({ openCount: 1, oldestIssuedOn: '2026-07-01' });
    expect(summaryB).toEqual({ openCount: 2, oldestIssuedOn: '2026-01-15' });

    // Three rows genuinely exist, so neither count above is a policy hiding an empty table. And
    // neither tenant's oldest date is the other's, which is what a leaking `min` would produce.
    const all = await fixture.admin.query('select id from asset_custody');

    expect(all.rows).toHaveLength(3);
  });

  /**
   * The date comes back as the civil date it was written as, not as an instant a timezone moved.
   *
   * `min(issued_on)` over a `date` column returns a driver `Date` unless it is projected with
   * `to_char`, and a server an hour west of UTC would then report the previous day. The elapsed
   * figures are computed from this string, so a shift here is a wrong number on a dashboard.
   */
  it('projects the oldest issue date as a civil date, never as an instant', async () => {
    const category = await givenCategory(TENANT_A, 'laptop');
    const asset = await givenAsset(TENANT_A, category, 'A-1');

    await givenCustody(TENANT_A, asset, '2026-01-01');

    const summary = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.custodies.openSummary(transaction),
    );

    expect(summary.oldestIssuedOn).toBe('2026-01-01');
    expect(typeof summary.oldestIssuedOn).toBe('string');
  });

  it('reports an empty tenant as zero with no date at all', async () => {
    expect(
      await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.custodies.openSummary(transaction),
      ),
    ).toEqual({ openCount: 0 });
  });

  /**
   * The clearance read, isolated in both directions against real PostgreSQL.
   *
   * This is the read a future Offboarding will pull, and the failure that matters is the quiet one:
   * a leaked row makes another organisation's employment look blocked, and a wrongly-filtered count
   * makes a genuinely blocked one look **clear** — which is the direction that lets an asset walk out
   * of the building with the paperwork signed.
   *
   * The join is exercised too, not just the count: `assetTag` comes from `asset`, so a policy that
   * covered `asset_custody` and not `asset` would surface here rather than in production.
   */
  it('answers clearance from its own tenant only, in both directions', async () => {
    const employmentId = uuidV7();
    const categoryA = await givenCategory(TENANT_A, 'laptop');
    const categoryB = await givenCategory(TENANT_B, 'laptop');
    const assetA = await givenAsset(TENANT_A, categoryA, 'A-1');
    const assetB = await givenAsset(TENANT_B, categoryB, 'B-1');

    // The *same* employment identifier holds an asset in each tenant — the strongest form of the
    // question, because a leak here cannot be explained away as a different subject.
    await givenCustodyFor(TENANT_A, assetA, employmentId, '2026-07-01');
    await givenCustodyFor(TENANT_B, assetB, employmentId, '2026-01-15');

    const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.custodies.outstandingForEmployment(transaction, employmentId, 200),
    );
    const seenByB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.custodies.outstandingForEmployment(transaction, employmentId, 200),
    );

    expect(seenByA.total).toBe(1);
    expect(seenByB.total).toBe(1);
    expect(seenByA.items.map((item) => item.assetTag)).toEqual(['A-1']);
    expect(seenByB.items.map((item) => item.assetTag)).toEqual(['B-1']);

    // Both rows genuinely exist, so neither answer is a policy hiding an empty table.
    const all = await fixture.admin.query('select id from asset_custody');

    expect(all.rows).toHaveLength(2);
  });

  it('reports an employment that holds nothing here as holding nothing', async () => {
    const outstanding = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.custodies.outstandingForEmployment(transaction, uuidV7(), 200),
    );

    expect(outstanding).toEqual({ total: 0, items: [] });
  });

  it('cannot be reached by the application role bypassing the policy', async () => {
    const role = await fixture.application.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'select rolbypassrls, rolsuper from pg_roles where rolname = current_user',
    );

    expect(role.rows[0]?.rolbypassrls).toBe(false);
    expect(role.rows[0]?.rolsuper).toBe(false);
  });

  /**
   * Every table this module owns, protected — asserted by name rather than by count.
   *
   * The assertion used to say "both tables" and expect two. Custody made that stale, and the
   * replacement is stricter rather than merely larger: it reconciles the protected set against
   * `ASSETS_TABLES` in **both directions**, so a table added later without `app_protect_table` fails
   * here instead of shipping unprotected.
   */
  it('has row-level security enabled and forced on every table this module owns', async () => {
    const state = await fixture.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class where relname = any($1::text[])`,
      [ASSETS_TABLES],
    );

    expect(state.rows.map((row) => row.relname).sort()).toEqual([...ASSETS_TABLES].sort());
    expect(ASSETS_TABLES).toContain('asset_custody');

    for (const row of state.rows) {
      expect(row.relrowsecurity).toBe(true);
      // Forced as well as enabled: without this the table's *owner* bypasses the policy, and the
      // owner is the role a migration runs as (ADR-0030).
      expect(row.relforcerowsecurity).toBe(true);
    }
  });
});
