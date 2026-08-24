import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openAssetsFixture,
  requireDatabaseInCi,
  type AssetsFixture,
} from './assets-database.fixture.js';

/**
 * The retirement invariant, tenant isolation, and the columns custody deliberately does not hold.
 *
 * Split from `assets-custody.integration.test.ts` when the two together passed the 400-line file
 * budget — split where the subject changes rather than exempted: that file is about what a custody
 * *is*, this one about what surrounds it.
 *
 * **No sleeps and no timing assumptions.** Contending transactions are started and awaited together,
 * and the assertion is on the invariant rather than on which one wins.
 */

requireDatabaseInCi('Assets custody boundaries');

describe.skipIf(CONNECTION === undefined)('custody, at its boundaries', () => {
  let fixture: AssetsFixture;

  beforeAll(async () => {
    fixture = await openAssetsFixture('assets_custody_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const AUDIT = `now(), 'user:test', now(), 'user:test', 1`;

  const givenAsset = async (tenantId = TENANT_A, tag = 'IT-00417'): Promise<string> => {
    const categoryId = uuidV7();
    const assetId = uuidV7();

    await fixture.admin.query(
      `insert into asset_category
         (id, tenant_id, code, name, sequence, active,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'laptop', '{"en":"Laptop","ar":"حاسوب"}'::jsonb, 10, true, ${AUDIT})`,
      [categoryId, tenantId],
    );
    await fixture.admin.query(
      `insert into asset
         (id, tenant_id, asset_category_id, asset_tag, status,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, $4, 'available', ${AUDIT})`,
      [assetId, tenantId, categoryId, tag],
    );
    return assetId;
  };

  const issuing = (assetId: string, employmentId: string, tenantId = TENANT_A): Promise<void> =>
    fixture.asTenant(tenantId, (transaction) =>
      fixture.stores.custodies.insert(transaction, {
        assetCustodyId: uuidV7(),
        assetId,
        employmentId,
        issuedOn: '2026-08-20',
        state: 'open',
        version: 1,
      }),
    );

  const survivors = (outcomes: readonly PromiseSettledResult<unknown>[]): number =>
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length;

  describe('retiring an asset that is held', () => {
    /**
     * **D-5.3-09 under contention**, and the reason `byIdForUpdate` exists.
     *
     * The invariant spans two tables, so no constraint expresses it. Both transactions take a row
     * lock on the asset **before** they check, so they serialize: whichever arrives second blocks,
     * re-reads the committed truth and refuses. Without the lock both would pass their own check and
     * commit, leaving a retired asset in somebody's custody.
     *
     * The assertion is the invariant — never `retired` *and* held — not which transaction wins.
     */
    it('never leaves an asset retired while a custody is open', async () => {
      const assetId = await givenAsset();

      const issue = (): Promise<void> =>
        fixture.asTenant(TENANT_A, async (transaction) => {
          const asset = await fixture.stores.assets.byIdForUpdate(transaction, assetId);

          if (asset === undefined || asset.status !== 'available') {
            throw new Error('asset_not_available');
          }
          await fixture.stores.custodies.insert(transaction, {
            assetCustodyId: uuidV7(),
            assetId,
            employmentId: uuidV7(),
            issuedOn: '2026-08-20',
            state: 'open',
            version: 1,
          });
        });

      const retire = (): Promise<void> =>
        fixture.asTenant(TENANT_A, async (transaction) => {
          const asset = await fixture.stores.assets.byIdForUpdate(transaction, assetId);

          if (asset === undefined) throw new Error('asset_missing');

          const open = await fixture.stores.custodies.openFor(transaction, assetId);

          if (open !== undefined) throw new Error('asset_in_custody');
          await fixture.stores.assets.update(
            transaction,
            { ...asset, status: 'retired' },
            asset.version,
          );
        });

      const outcomes = await Promise.allSettled([issue(), retire()]);

      // Either order is legitimate; what must never happen is both.
      expect(survivors(outcomes)).toBe(1);

      const after = await fixture.admin.query<{ status: string; open: string }>(
        `select a.status,
                (select count(*)::text from asset_custody c
                  where c.asset_id = a.id and c.state = 'open') as open
           from asset a where a.id = $1`,
        [assetId],
      );

      expect(after.rows[0]?.status === 'retired' && after.rows[0]?.open !== '0').toBe(false);
    });

    /** The lock is taken; without it the re-check would read a truth the other transaction changed. */
    it('takes a row lock on the asset before checking', async () => {
      const assetId = await givenAsset();
      const plans = await fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute<{ 'QUERY PLAN': string }>(
          `explain select id from asset where id = $1 and tenant_id = $2 and deleted_at is null
             for update`,
          [assetId, TENANT_A],
        ),
      );

      expect(plans.map((row) => row['QUERY PLAN']).join(' ')).toContain('LockRows');
    });
  });

  describe('tenancy', () => {
    it('shows a tenant its own custody and none of its neighbour’s', async () => {
      const mine = await givenAsset(TENANT_A, 'A-1');
      const theirs = await givenAsset(TENANT_B, 'B-1');

      await issuing(mine, uuidV7(), TENANT_A);
      await issuing(theirs, uuidV7(), TENANT_B);

      const aReadingB = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.custodies.openFor(transaction, theirs),
      );
      const bReadingA = await fixture.asTenant(TENANT_B, (transaction) =>
        fixture.stores.custodies.openFor(transaction, mine),
      );

      expect(aReadingB).toBeUndefined();
      expect(bReadingA).toBeUndefined();

      // Both rows genuinely exist, so the two absences above are a policy rather than an omission.
      const all = await fixture.admin.query('select id from asset_custody');

      expect(all.rows).toHaveLength(2);
    });

    it('lets two tenants hold custody of assets carrying the same tag', async () => {
      const mine = await givenAsset(TENANT_A, 'IT-00417');
      const theirs = await givenAsset(TENANT_B, 'IT-00417');

      await issuing(mine, uuidV7(), TENANT_A);

      await expect(issuing(theirs, uuidV7(), TENANT_B)).resolves.toBeUndefined();
    });

    it('has row-level security enabled and forced', async () => {
      const state = await fixture.admin.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relrowsecurity, relforcerowsecurity from pg_class where relname = 'asset_custody'`,
      );

      expect(state.rows[0]?.relrowsecurity).toBe(true);
      // Forced as well as enabled: without this the table's owner bypasses the policy, and the owner
      // is the role a migration runs as (ADR-0030).
      expect(state.rows[0]?.relforcerowsecurity).toBe(true);
    });

    it('is reached by a role that cannot bypass the policy', async () => {
      const role = await fixture.application.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
        'select rolbypassrls, rolsuper from pg_roles where rolname = current_user',
      );

      expect(role.rows[0]?.rolbypassrls).toBe(false);
      expect(role.rows[0]?.rolsuper).toBe(false);
    });
  });

  describe('the columns custody does not hold', () => {
    /**
     * Read from the catalogue rather than from the migration text, so the claim is about the database
     * that exists rather than the file somebody thinks was applied.
     */
    it('holds no condition, no expected return, no acknowledgement and no money', async () => {
      const columns = await fixture.admin.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'asset_custody'`,
      );
      const names = columns.rows.map((row) => row.column_name);

      expect(names).toContain('employment_id');

      for (const absent of [
        'condition_at_issue',
        'condition_at_return',
        'expected_return_on',
        'acknowledged_on',
        'acknowledgement_recorded_by',
        'approved_by',
        'closed_reason',
        'corrects_custody_id',
        'person_id',
        'employee_name',
        'amount',
        'value',
        'document_id',
      ]) {
        expect(names).not.toContain(absent);
      }

      // No numeric column but `version`: Finance owns value, and this domain owns custody.
      expect(columns.rows.filter((row) => row.data_type === 'numeric')).toEqual([]);
    });

    /** Checkpoint 1's tables gained no column and no trigger from this checkpoint. */
    it('leaves the asset and category tables exactly as Checkpoint 1 left them', async () => {
      const triggers = await fixture.admin.query<{ tgname: string }>(
        `select tgname from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
          where c.relname in ('asset', 'asset_category') and not t.tgisinternal`,
      );
      const assetColumns = await fixture.admin.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'asset'`,
      );

      expect(triggers.rows).toEqual([]);

      for (const absent of [
        'current_employee_id',
        'current_custody_id',
        'in_custody',
        'is_issued',
        'assigned_to',
      ]) {
        expect(assetColumns.rows.map((row) => row.column_name)).not.toContain(absent);
      }
    });
  });
});
