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

  it('cannot be reached by the application role bypassing the policy', async () => {
    const role = await fixture.application.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'select rolbypassrls, rolsuper from pg_roles where rolname = current_user',
    );

    expect(role.rows[0]?.rolbypassrls).toBe(false);
    expect(role.rows[0]?.rolsuper).toBe(false);
  });

  it('has row-level security enabled and forced on both tables', async () => {
    const state = await fixture.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class where relname = any($1::text[])`,
      [ASSETS_TABLES],
    );

    expect(state.rows).toHaveLength(2);

    for (const row of state.rows) {
      expect(row.relrowsecurity).toBe(true);
      // Forced as well as enabled: without this the table's *owner* bypasses the policy, and the
      // owner is the role a migration runs as (ADR-0030).
      expect(row.relforcerowsecurity).toBe(true);
    }
  });
});
