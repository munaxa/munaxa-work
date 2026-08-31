import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Proves `pnpm db:bootstrap` makes a migrated database operable, and does so without becoming a
 * way in.
 *
 * It runs the real command as a child process against a real PostgreSQL, as the unprivileged
 * application role, because every property under test belongs to the database rather than to our
 * code: whether the row-level security policies permit the writes at all, whether the records
 * resolve through the product's own membership lookup, and whether the tenant they create is
 * isolated from every other. A double would only prove the double agrees with itself.
 *
 * Skipped when no database is reachable, so a developer without one is not blocked — but never
 * skipped in CI, for the reason `tenant-isolation.integration.test.ts` gives.
 */

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ROLE = 'work_app_bootstrap_test';
const PASSWORD = 'probe';

/** Distinct per run, so a suite that failed midway cannot poison the next one. */
const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const platformUser = (suffix: string): string => `bootstrap-test-${stamp}-${suffix}`;

const run = promisify(execFile);

const SCRIPT = fileURLToPath(new URL('../../../scripts/bootstrap-tenant.mjs', import.meta.url));

interface Membership {
  readonly tenant_id: string;
  readonly membership_id: string;
  readonly workforce_user_id: string;
}

if (CONNECTION === undefined && process.env.CI !== undefined) {
  throw new Error(
    'Bootstrap tests require a database. Set TEST_DATABASE_URL. Refusing to skip in CI.',
  );
}

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('pnpm db:bootstrap', () => {
  let admin: Client;
  let application: Client;
  let applicationUrl: string;

  /** Runs the command exactly as an operator would, and reports both streams and the exit code. */
  const bootstrap = async (
    ...args: readonly string[]
  ): Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number }> => {
    try {
      const { stdout, stderr } = await run('node', [SCRIPT, ...args], {
        env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: applicationUrl },
      });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
        code: failure.code ?? 1,
      };
    }
  };

  const membershipsOf = async (platformUserId: string): Promise<readonly Membership[]> => {
    const found = await admin.query<Membership>(
      'select tenant_id, membership_id, workforce_user_id from app_memberships_of($1)',
      [platformUserId],
    );
    return found.rows;
  };

  /** What one tenant can see of `tenant_membership`, through the ordinary application path. */
  const membershipsVisibleTo = async (tenantId: string): Promise<number> => {
    await application.query('begin');
    await application.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const seen = await application.query<{ count: number }>(
      'select count(*)::int as count from tenant_membership',
    );
    await application.query('commit');
    return seen.rows[0]?.count ?? 0;
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: CONNECTION });
    await admin.connect();

    await admin.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
          create role ${ROLE} login nosuperuser password '${PASSWORD}';
        end if;
      end $$`);
    await admin.query(`grant usage on schema public to ${ROLE}`);
    await admin.query(
      `grant select, insert, update, delete on workforce_user, tenant_membership to ${ROLE}`,
    );
    // No grant for `app_memberships_of`: EXECUTE is PUBLIC by default and stays that way, and
    // since ADR-0077 the function is owned by `work_membership_resolver`, so a migration role
    // could not grant on it anyway.
    await admin.query(`grant execute on function app_current_tenant() to ${ROLE}`);

    const url = new URL(CONNECTION ?? '');
    url.username = ROLE;
    url.password = PASSWORD;
    applicationUrl = url.toString();
    application = new Client({ connectionString: applicationUrl });
    await application.connect();
  });

  afterAll(async () => {
    await application?.end();
    // Only this run's rows, named by the stamp: a suite that truncated the tables would take a
    // developer's own database with it.
    await admin?.query(
      `delete from tenant_membership m
         using workforce_user u
        where u.id = m.workforce_user_id and u.platform_user_id like $1`,
      [`bootstrap-test-${stamp}-%`],
    );
    await admin?.query('delete from workforce_user where platform_user_id like $1', [
      `bootstrap-test-${stamp}-%`,
    ]);
    await admin?.end();
  });

  describe('against a freshly migrated database', () => {
    it('creates the workforce user and the membership that make a tenant operable', async () => {
      const person = platformUser('fresh');
      const result = await bootstrap('--platform-user-id', person);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Bootstrapped tenant');

      const memberships = await membershipsOf(person);

      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.tenant_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('creates an active membership of an active user, which is what resolution requires', async () => {
      const person = platformUser('statuses');
      await bootstrap('--platform-user-id', person);

      const state = await admin.query<{ user_status: string; membership_status: string }>(
        `select u.status as user_status, m.status as membership_status
           from workforce_user u join tenant_membership m on m.workforce_user_id = u.id
          where u.platform_user_id = $1`,
        [person],
      );

      expect(state.rows).toEqual([{ user_status: 'active', membership_status: 'active' }]);
    });

    it('accepts a tenant identifier the operator chose', async () => {
      const person = platformUser('chosen');
      const tenantId = '01920000-0000-7000-8000-00000000b007';
      await bootstrap('--platform-user-id', person, '--tenant-id', tenantId);

      expect((await membershipsOf(person))[0]?.tenant_id).toBe(tenantId);
    });

    it('writes no tenant settings, because a tenant without them uses the deployment defaults', async () => {
      // ADR-0036: `StoredTenantSettings` falls back rather than failing. Writing a row here would
      // freeze this deployment's defaults into the tenant as though somebody had chosen them.
      const person = platformUser('settings');
      await bootstrap('--platform-user-id', person);
      const tenantId = (await membershipsOf(person))[0]?.tenant_id;

      const settings = await admin.query('select 1 from tenant_settings where tenant_id = $1', [
        tenantId,
      ]);

      expect(settings.rowCount).toBe(0);
    });
  });

  describe('run a second time', () => {
    it('reports what it found and writes nothing', async () => {
      const person = platformUser('idempotent');
      const first = await bootstrap('--platform-user-id', person);
      const second = await bootstrap('--platform-user-id', person);

      expect(first.stdout).toContain('Bootstrapped tenant');
      expect(second.code).toBe(0);
      expect(second.stdout).toContain('Already bootstrapped');
      expect(second.stdout).toContain('Nothing was written');
    });

    it('creates no duplicate user, membership or tenant', async () => {
      const person = platformUser('no-duplicates');
      await bootstrap('--platform-user-id', person);
      const after = await membershipsOf(person);
      await bootstrap('--platform-user-id', person);
      await bootstrap('--platform-user-id', person);

      expect(await membershipsOf(person)).toEqual(after);

      const users = await admin.query<{ count: number }>(
        'select count(*)::int as count from workforce_user where platform_user_id = $1',
        [person],
      );

      expect(users.rows[0]?.count).toBe(1);
    });

    it('does not move the tenant when a different one is named', async () => {
      // The membership already decides which tenant this person acts in. Honouring a new
      // `--tenant-id` would silently move them, which is the kind of change nobody asked for.
      const person = platformUser('stable-tenant');
      await bootstrap('--platform-user-id', person);
      const original = (await membershipsOf(person))[0]?.tenant_id;

      await bootstrap(
        '--platform-user-id',
        person,
        '--tenant-id',
        '01920000-0000-7000-8000-0000000000ff',
      );

      expect((await membershipsOf(person))[0]?.tenant_id).toBe(original);
    });
  });

  describe('refuses rather than guesses', () => {
    it('will not run without a Platform account to admit', async () => {
      const result = await bootstrap();

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('--platform-user-id');
    });

    it('will not accept a tenant identifier that is not a UUID v7', async () => {
      const result = await bootstrap(
        '--platform-user-id',
        platformUser('v4'),
        '--tenant-id',
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('UUID v7');
    });

    it('will not accept a malformed tenant identifier', async () => {
      const result = await bootstrap(
        '--platform-user-id',
        platformUser('malformed'),
        '--tenant-id',
        'not-a-uuid',
      );

      expect(result.code).toBe(1);
    });

    it('writes nothing when it refuses', async () => {
      const person = platformUser('refused');
      await bootstrap('--platform-user-id', person, '--tenant-id', 'not-a-uuid');

      expect(await membershipsOf(person)).toEqual([]);
    });
  });

  describe('the Platform boundary', () => {
    it('creates no credential, no token and no permission — only the two Work records', async () => {
      const person = platformUser('boundary');
      const result = await bootstrap('--platform-user-id', person);

      // The whole of what bootstrap writes. Nothing here is a secret, and nothing authorizes.
      const state = await admin.query<{ table_name: string }>(
        `select 'workforce_user' as table_name from workforce_user where platform_user_id = $1
         union all
         select 'tenant_membership' from tenant_membership m
           join workforce_user u on u.id = m.workforce_user_id
          where u.platform_user_id = $1`,
        [person],
      );

      expect(state.rows.map((row) => row.table_name).sort()).toEqual([
        'tenant_membership',
        'workforce_user',
      ]);
      expect(result.stdout).toContain('No permission was granted');
    });

    it('stores the Platform account as an identifier and nothing more', async () => {
      const person = platformUser('identifier-only');
      await bootstrap('--platform-user-id', person);

      const stored = await admin.query<Record<string, unknown>>(
        'select * from workforce_user where platform_user_id = $1',
        [person],
      );
      const row = stored.rows[0] ?? {};

      // No column exists that could hold a credential, and none is invented: the row is the
      // Platform identifier, a lifecycle status and audit columns.
      expect(Object.keys(row).sort()).toEqual([
        'created_at',
        'created_by',
        'deleted_at',
        'deleted_by',
        'id',
        'platform_user_id',
        'status',
        'updated_at',
        'updated_by',
        'version',
      ]);
      expect(row.platform_user_id).toBe(person);
    });

    it('names a system actor in the audit columns, never a person', async () => {
      const person = platformUser('actor');
      await bootstrap('--platform-user-id', person);

      const audit = await admin.query<{ created_by: string }>(
        'select created_by from workforce_user where platform_user_id = $1',
        [person],
      );

      expect(audit.rows[0]?.created_by).toBe('system:bootstrap');
    });
  });

  describe('the tenant it created', () => {
    it('is isolated from every other tenant, through the ordinary application path', async () => {
      const first = platformUser('isolation-a');
      const second = platformUser('isolation-b');
      await bootstrap('--platform-user-id', first);
      await bootstrap('--platform-user-id', second);

      const tenantA = (await membershipsOf(first))[0]?.tenant_id ?? '';
      const tenantB = (await membershipsOf(second))[0]?.tenant_id ?? '';

      expect(tenantA).not.toBe(tenantB);
      expect(await membershipsVisibleTo(tenantA)).toBe(1);
      expect(await membershipsVisibleTo(tenantB)).toBe(1);
    });

    it('resolves each person to their own tenant and to no other', async () => {
      const first = platformUser('resolution-a');
      const second = platformUser('resolution-b');
      await bootstrap('--platform-user-id', first);
      await bootstrap('--platform-user-id', second);

      const tenantB = (await membershipsOf(second))[0]?.tenant_id;

      expect((await membershipsOf(first)).map((m) => m.tenant_id)).not.toContain(tenantB);
    });

    it('leaves the application role unable to bypass isolation', async () => {
      const diagnostics = await application.query<{
        is_superuser: boolean;
        can_bypass_rls: boolean;
      }>('select is_superuser, can_bypass_rls from app_isolation_diagnostics()');

      expect(diagnostics.rows[0]).toEqual({ is_superuser: false, can_bypass_rls: false });
    });

    it('leaves every row-level security policy exactly as the migrations left it', async () => {
      const policies = await admin.query<{ count: number }>(
        `select count(*)::int as count from pg_policies
          where schemaname = 'public' and policyname in ('tenant_isolation', 'tenant_reachability')`,
      );
      const forced = await admin.query<{ count: number }>(
        `select count(*)::int as count from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and c.relrowsecurity and c.relforcerowsecurity`,
      );

      // Every protected table still forces row-level security, and every policy is still there.
      expect(policies.rows[0]?.count).toBe(forced.rows[0]?.count);
    });
  });
});
