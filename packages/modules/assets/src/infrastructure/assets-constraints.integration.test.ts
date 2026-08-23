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
 * What the database itself refuses, proved against real PostgreSQL.
 *
 * Every assertion here is written as **raw SQL through the admin connection**, deliberately
 * bypassing the domain. An invariant that only the TypeScript enforces is an invariant that holds
 * until somebody opens `psql`, and the ones in this file — a closed status vocabulary, a code shape,
 * two uniqueness rules and a foreign key — are the ones a bulk import would meet first.
 */

requireDatabaseInCi('Assets constraints');

describe.skipIf(CONNECTION === undefined)('what the schema refuses', () => {
  let fixture: AssetsFixture;

  beforeAll(async () => {
    fixture = await openAssetsFixture('assets_constraints_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const AUDIT = `now(), 'user:test', now(), 'user:test', 1`;

  const insertCategory = async (code: string, sequence = 10): Promise<string> => {
    const id = uuidV7();

    await fixture.admin.query(
      `insert into asset_category
         (id, tenant_id, code, name, sequence, active,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, '{"en":"Laptop","ar":"حاسوب"}'::jsonb, $4, true, ${AUDIT})`,
      [id, TENANT_A, code, sequence],
    );
    return id;
  };

  const insertAsset = (
    categoryId: string,
    tag: string,
    overrides: { readonly serialNumber?: string | null; readonly status?: string } = {},
  ): Promise<unknown> =>
    fixture.admin.query(
      `insert into asset
         (id, tenant_id, asset_category_id, asset_tag, serial_number, status,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, $4, $5, $6, ${AUDIT})`,
      [
        uuidV7(),
        TENANT_A,
        categoryId,
        tag,
        overrides.serialNumber ?? null,
        overrides.status ?? 'registered',
      ],
    );

  const refusalFrom = async (work: Promise<unknown>): Promise<string> => {
    try {
      await work;
    } catch (error: unknown) {
      return String(error);
    }
    throw new Error('The database accepted a row it should have refused.');
  };

  it('closes the status vocabulary against SQL nobody wrote in TypeScript', async () => {
    const categoryId = await insertCategory('laptop');

    for (const status of ['issued', 'in_custody', 'returned', 'lost', 'assigned', 'disposed']) {
      const refusal = await refusalFrom(insertAsset(categoryId, `IT-${status}`, { status }));

      expect(refusal).toContain('asset_status_check');
    }
  });

  it('accepts exactly the four statuses the domain knows', async () => {
    const categoryId = await insertCategory('laptop');

    for (const status of ['registered', 'available', 'under_repair', 'retired']) {
      await expect(insertAsset(categoryId, `IT-${status}`, { status })).resolves.toBeDefined();
    }
  });

  it('enforces the repository’s code shape on a catalogue entry', async () => {
    for (const code of ['Laptop', '-laptop', 'laptop-', 'lap top', 'laptop_']) {
      const refusal = await refusalFrom(insertCategory(code));

      expect(refusal).toContain('asset_category_code_shape_check');
    }
  });

  it('refuses a blank tag and a blank serial number', async () => {
    const categoryId = await insertCategory('laptop');

    expect(await refusalFrom(insertAsset(categoryId, '   '))).toContain('asset_tag_shape_check');
    expect(await refusalFrom(insertAsset(categoryId, 'IT-1', { serialNumber: '  ' }))).toContain(
      'asset_serial_shape_check',
    );
  });

  it('refuses an asset pointing at a category that is not there', async () => {
    const refusal = await refusalFrom(insertAsset(uuidV7(), 'IT-1'));

    expect(refusal).toContain('asset_category_fk');
  });

  it('refuses a duplicate tag within one tenant', async () => {
    const categoryId = await insertCategory('laptop');

    await insertAsset(categoryId, 'IT-00417');

    expect(await refusalFrom(insertAsset(categoryId, 'IT-00417'))).toContain('asset_tag_idx');
  });

  it('refuses a duplicate serial number within one tenant', async () => {
    const categoryId = await insertCategory('laptop');

    await insertAsset(categoryId, 'IT-1', { serialNumber: 'SN-1' });

    expect(await refusalFrom(insertAsset(categoryId, 'IT-2', { serialNumber: 'SN-1' }))).toContain(
      'asset_serial_idx',
    );
  });

  /**
   * Many items have no serial number, and none of them collides with any other.
   *
   * This is why the index is partial rather than plain: in SQL a null never equals another null, but
   * a plain unique index over a nullable column is a trap the moment somebody stores `''` instead —
   * which the shape CHECK above also refuses, so the two rules cover each other.
   */
  it('lets any number of items carry no serial number', async () => {
    const categoryId = await insertCategory('laptop');

    for (const tag of ['FUR-1', 'FUR-2', 'FUR-3']) {
      await expect(insertAsset(categoryId, tag)).resolves.toBeDefined();
    }
  });

  /**
   * A soft-deleted row does not block its replacement — the indexes are partial for exactly that.
   *
   * A tag written on a sticker gets reused when the sticker outlives the laptop, and a tenant that
   * could never reuse one would be forced to invent a numbering scheme around the software.
   */
  it('lets a tag and a serial number be reused once the holder is soft-deleted', async () => {
    const categoryId = await insertCategory('laptop');

    await insertAsset(categoryId, 'IT-00417', { serialNumber: 'SN-1' });
    await fixture.admin.query(
      `update asset set deleted_at = now(), deleted_by = 'user:test' where asset_tag = 'IT-00417'`,
    );

    await expect(
      insertAsset(categoryId, 'IT-00417', { serialNumber: 'SN-1' }),
    ).resolves.toBeDefined();
  });

  it('refuses a duplicate catalogue code within one tenant', async () => {
    await insertCategory('laptop');

    expect(await refusalFrom(insertCategory('laptop'))).toContain('asset_category_code_idx');
  });

  it('refuses a negative ordering', async () => {
    expect(await refusalFrom(insertCategory('laptop', -1))).toContain(
      'asset_category_sequence_check',
    );
  });

  /**
   * Neither table is immutable, and that is asserted rather than assumed.
   *
   * AD-003's immutability is about *custody history*. Reading it across to a catalogue and an
   * inventory would freeze them the day they were typed, including their typos — so a description is
   * correctable, and this proves the database agrees.
   */
  it('permits an update, because a catalogue and an inventory are mutable by design', async () => {
    const categoryId = await insertCategory('laptop');

    await insertAsset(categoryId, 'IT-1');

    await expect(
      fixture.admin.query(`update asset set description = 'Corrected' where asset_tag = 'IT-1'`),
    ).resolves.toBeDefined();
    await expect(
      fixture.admin.query(`update asset_category set sequence = 20 where id = $1`, [categoryId]),
    ).resolves.toBeDefined();
  });

  /**
   * No immutability trigger exists on either table, and none is expected until custody arrives.
   *
   * Asserted by name so that a later checkpoint adding one to `asset_custody` cannot quietly add one
   * here as well — which would break the amendment path this checkpoint depends on.
   */
  it('has no trigger on either table', async () => {
    const triggers = await fixture.admin.query<{ tgname: string }>(
      `select tgname from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where c.relname in ('asset', 'asset_category') and not t.tgisinternal`,
    );

    expect(triggers.rows).toEqual([]);
  });

  /**
   * No column on either table holds a person, an employment or an amount.
   *
   * Read from the catalogue rather than from the migration text, so it is true of the database that
   * exists rather than of the file somebody thinks was applied.
   */
  it('holds no custody column, no person and no money', async () => {
    const columns = await fixture.admin.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name in ('asset', 'asset_category')`,
    );
    const names = columns.rows.map((row) => row.column_name);

    for (const absent of [
      'employment_id',
      'person_id',
      'custodian_id',
      'holder_id',
      'issued_to',
      'issued_on',
      'returned_on',
      'condition',
      'condition_at_issue',
      'value',
      'amount',
      'cost',
      'purchase_price',
      'depreciation',
      'document_id',
    ]) {
      expect(names).not.toContain(absent);
    }

    // And no numeric column of any kind: Finance owns value, and this domain owns custody.
    expect(columns.rows.filter((row) => row.data_type === 'numeric')).toEqual([]);
  });
});
