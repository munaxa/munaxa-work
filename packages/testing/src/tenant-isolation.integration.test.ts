import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Proves row-level security actually isolates tenants (ADR-0030).
 *
 * This runs against a real PostgreSQL because the property under test belongs to the database,
 * not to our code: a mock would only prove that our mock does what we told it to. It creates a
 * throwaway table, applies the same procedure the migrations use, and then tries — as an
 * unprivileged application role — to do every cross-tenant thing an application bug could do.
 *
 * Skipped when no database is reachable, so a developer without one is not blocked — but never
 * skipped in CI. A suite that quietly skips itself on the machine that gates merges is worse
 * than no suite: it reports success for a property nobody checked.
 */

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const TENANT_A = '01920000-0000-7000-8000-0000000000aa';
const TENANT_B = '01920000-0000-7000-8000-0000000000bb';

const policySql = readFileSync(
  fileURLToPath(
    new URL('../../../prisma/migrations/00000000000000_foundation/migration.sql', import.meta.url),
  ),
  'utf8',
);

type QueryRow = Record<string, unknown>;

interface Diagnostics {
  readonly role_name: string;
  readonly is_superuser: boolean;
  readonly can_bypass_rls: boolean;
}

if (CONNECTION === undefined && process.env.CI !== undefined) {
  throw new Error(
    'Tenant isolation tests require a database. Set TEST_DATABASE_URL. Refusing to skip in CI.',
  );
}

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('row-level security', () => {
  let admin: Client;
  let application: Client;

  const asTenant = async (tenantId: string, sql: string): Promise<QueryRow[]> => {
    await application.query('begin');
    await application.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    try {
      const result = await application.query<QueryRow>(sql);
      await application.query('commit');
      return result.rows;
    } catch (error) {
      await application.query('rollback');
      throw error;
    }
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: CONNECTION });
    await admin.connect();

    await admin.query(policySql);
    await admin.query('drop table if exists isolation_probe');
    await admin.query(`
      create table isolation_probe (
        id uuid primary key,
        tenant_id uuid not null,
        secret text not null
      )`);
    await admin.query(`call app_protect_table('isolation_probe')`);

    await admin.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'work_app_test') then
          create role work_app_test login nosuperuser password 'probe';
        end if;
      end $$`);
    await admin.query('grant select, insert, update, delete on isolation_probe to work_app_test');
    await admin.query(
      `insert into isolation_probe values ($1, $2, 'tenant a secret'), ($3, $4, 'tenant b secret')`,
      [
        '01920000-0000-7000-8000-000000000001',
        TENANT_A,
        '01920000-0000-7000-8000-000000000002',
        TENANT_B,
      ],
    );

    const url = new URL(CONNECTION ?? '');
    url.username = 'work_app_test';
    url.password = 'probe';
    application = new Client({ connectionString: url.toString() });
    await application.connect();
  });

  afterAll(async () => {
    await application?.end();
    await admin?.query('drop table if exists isolation_probe');
    await admin?.end();
  });

  it('shows a tenant only its own rows', async () => {
    const rows = await asTenant(TENANT_A, 'select secret from isolation_probe');

    expect(rows).toEqual([{ secret: 'tenant a secret' }]);
  });

  it('shows the other tenant only its own rows', async () => {
    const rows = await asTenant(TENANT_B, 'select secret from isolation_probe');

    expect(rows).toEqual([{ secret: 'tenant b secret' }]);
  });

  it('returns nothing when no tenant is set — it fails closed, never open', async () => {
    const result = await application.query<QueryRow>(
      'select count(*)::int as count from isolation_probe',
    );

    expect(result.rows).toEqual([{ count: 0 }]);
  });

  it('refuses to insert a row belonging to another tenant', async () => {
    await expect(
      asTenant(
        TENANT_A,
        `insert into isolation_probe values ('01920000-0000-7000-8000-00000000000f', '${TENANT_B}', 'smuggled')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update another tenant is rows', async () => {
    await asTenant(TENANT_A, `update isolation_probe set secret = 'hijacked'`);
    const rows = await asTenant(TENANT_B, 'select secret from isolation_probe');

    expect(rows).toEqual([{ secret: 'tenant b secret' }]);
  });

  it('cannot delete another tenant is rows', async () => {
    await asTenant(TENANT_A, 'delete from isolation_probe');
    const rows = await asTenant(TENANT_B, 'select secret from isolation_probe');

    expect(rows).toEqual([{ secret: 'tenant b secret' }]);
  });

  it('reports that the application role cannot bypass isolation', async () => {
    const result = await application.query<Diagnostics>(
      'select * from app_isolation_diagnostics()',
    );
    const [diagnostics] = result.rows;

    expect(diagnostics?.is_superuser).toBe(false);
    expect(diagnostics?.can_bypass_rls).toBe(false);
  });

  it('detects a superuser connection, the misconfiguration that disables every policy', async () => {
    const result = await admin.query<Diagnostics>('select * from app_isolation_diagnostics()');
    const [diagnostics] = result.rows;

    // The admin connection is exactly what the application must never be. Startup refuses it.
    expect(diagnostics?.can_bypass_rls).toBe(true);
  });
});
