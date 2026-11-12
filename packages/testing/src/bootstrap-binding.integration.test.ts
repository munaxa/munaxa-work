import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The binding half of the bootstrap suite (ADR-0080), split from `bootstrap-tenant.integration.test.ts`
 * for length; the setup is the same.
 *
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
const stamp = `b${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const platformUser = (suffix: string): string => `bootstrap-test-${stamp}-${suffix}`;

const run = promisify(execFile);

const ISSUER = 'https://identity.bootstrap-test.invalid';
const organisationOf = (platformUserId: string): string => `org-${platformUserId}`;

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

describeWithDatabase('pnpm db:bootstrap binds the tenant to its organisation (ADR-0080)', () => {
  let admin: Client;
  let application: Client;
  let applicationUrl: string;

  /** Runs the command exactly as an operator would, and reports both streams and the exit code. */
  const bootstrap = async (
    ...args: readonly string[]
  ): Promise<{ readonly stdout: string; readonly stderr: string; readonly code: number }> => {
    // Every run names an organisation unless the test is about leaving it out: one per person, so
    // the one-organisation-one-tenant rule (ADR-0080) holds across the suite.
    const userIndex = args.indexOf('--platform-user-id');
    const withOrganisation =
      userIndex === -1 ||
      args.includes('--platform-tenant-id') ||
      args.includes('--no-organisation')
        ? args.filter((arg) => arg !== '--no-organisation')
        : [...args, '--platform-tenant-id', organisationOf(args[userIndex + 1] ?? '')];
    try {
      const { stdout, stderr } = await run('node', [SCRIPT, ...withOrganisation], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DATABASE_URL: applicationUrl,
          PLATFORM_AUTH_ISSUER: ISSUER,
        },
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
      `grant select, insert, update, delete on workforce_user, tenant_membership, tenant_platform_binding to ${ROLE}`,
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
    await admin?.query('delete from tenant_platform_binding where platform_tenant_id like $1', [
      `org-bootstrap-test-${stamp}-%`,
    ]);
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

  describe('the tenant-to-organisation binding (ADR-0080)', () => {
    const bindingsOf = async (tenantId: string | undefined) =>
      (
        await admin.query<{ platform_issuer: string; platform_tenant_id: string }>(
          'select platform_issuer, platform_tenant_id from tenant_platform_binding where tenant_id = $1',
          [tenantId],
        )
      ).rows;
    const resolvesFor = async (person: string, organisation: string) =>
      (
        await admin.query('select tenant_id from app_bound_memberships_of($1, $2, $3)', [
          person,
          ISSUER,
          organisation,
        ])
      ).rows.length;

    it('binds the new tenant to the named organisation, so the person resolves with its tokens only', async () => {
      const person = platformUser('bound');
      const result = await bootstrap('--platform-user-id', person);
      expect(result.code).toBe(0);
      const tenantId = (await membershipsOf(person))[0]?.tenant_id;

      expect(await bindingsOf(tenantId)).toEqual([
        { platform_issuer: ISSUER, platform_tenant_id: organisationOf(person) },
      ]);
      expect(await resolvesFor(person, organisationOf(person))).toBe(1);
      expect(await resolvesFor(person, 'org-somebody-else')).toBe(0);
    });

    it('will not run without an organisation, and writes nothing', async () => {
      const person = platformUser('no-org');
      const result = await bootstrap('--platform-user-id', person, '--no-organisation');

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('--platform-tenant-id');
      expect(await membershipsOf(person)).toEqual([]);
    });

    it('refuses an organisation already bound to another tenant, and writes nothing', async () => {
      const first = platformUser('org-owner');
      await bootstrap('--platform-user-id', first);
      const second = platformUser('org-thief');
      const result = await bootstrap(
        '--platform-user-id',
        second,
        '--platform-tenant-id',
        organisationOf(first),
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('already bound');
      expect(await membershipsOf(second)).toEqual([]);
    });

    it('refuses to re-bind an existing tenant to a different organisation', async () => {
      const person = platformUser('rebind');
      await bootstrap('--platform-user-id', person);
      const tenantId = (await membershipsOf(person))[0]?.tenant_id;

      const result = await bootstrap(
        '--platform-user-id',
        person,
        '--platform-tenant-id',
        'org-bootstrap-test-hijack',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('will not re-bind');
      expect(await bindingsOf(tenantId)).toEqual([
        { platform_issuer: ISSUER, platform_tenant_id: organisationOf(person) },
      ]);
    });

    it('binds a tenant bootstrapped before bindings existed, on its next run', async () => {
      const person = platformUser('legacy');
      await bootstrap('--platform-user-id', person);
      const tenantId = (await membershipsOf(person))[0]?.tenant_id;
      await admin.query('delete from tenant_platform_binding where tenant_id = $1', [tenantId]);
      expect(await resolvesFor(person, organisationOf(person))).toBe(0);

      const result = await bootstrap('--platform-user-id', person);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Bound the tenant');
      expect(await resolvesFor(person, organisationOf(person))).toBe(1);
    });
  });
});
