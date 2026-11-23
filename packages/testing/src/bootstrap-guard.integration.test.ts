import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_ISSUER as ISSUER,
  Organisations,
  operatorArguments,
  runBootstrap,
} from './bootstrap.fixture.js';

/**
 * The bootstrap guard (MW-005): a wrong issuer or organisation is refused before anything is
 * written, a tenant is never re-bound, and --dry-run checks everything and commits nothing. Runs
 * the real script against a real PostgreSQL as the unprivileged application role, like the other
 * bootstrap suites. Never skipped in CI.
 */

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const ROLE = 'work_app_bootstrap_test';
const PASSWORD = 'probe';

const stamp = `g${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const platformUser = (suffix: string): string => `bootstrap-test-${stamp}-${suffix}`;

const organisations = new Organisations();

/** Nothing listens here: a refusal that names the guard's reason proves no connection was made. */
const UNREACHABLE = 'postgresql://nobody:nothing@127.0.0.1:1/none';

if (CONNECTION === undefined && process.env.CI !== undefined) {
  throw new Error(
    'Bootstrap tests require a database. Set TEST_DATABASE_URL. Refusing to skip in CI.',
  );
}

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('pnpm db:bootstrap guard (MW-005)', () => {
  let admin: Client;
  let applicationUrl: string;

  const bootstrap = async (...args: readonly string[]) =>
    runBootstrap(operatorArguments(args, organisations), applicationUrl);

  const tenantsOf = async (person: string): Promise<readonly string[]> =>
    (
      await admin.query<{ tenant_id: string }>('select tenant_id from app_memberships_of($1)', [
        person,
      ])
    ).rows.map((row) => row.tenant_id);

  const usersNamed = async (person: string): Promise<number> =>
    (
      await admin.query<{ count: number }>(
        'select count(*)::int as count from workforce_user where platform_user_id = $1',
        [person],
      )
    ).rows[0]?.count ?? -1;

  const bindingsFor = async (organisation: string) =>
    (
      await admin.query<{ tenant_id: string; platform_issuer: string }>(
        'select tenant_id, platform_issuer from tenant_platform_binding where platform_tenant_id = $1',
        [organisation],
      )
    ).rows;

  /** The whole of what a refused or rehearsed run must leave behind for this person: nothing. */
  const expectNothingWritten = async (person: string): Promise<void> => {
    expect(await tenantsOf(person)).toEqual([]);
    expect(await usersNamed(person)).toBe(0);
    expect(await bindingsFor(organisations.of(person))).toEqual([]);
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
    await admin.query(`grant execute on function app_current_tenant() to ${ROLE}`);
    const url = new URL(CONNECTION ?? '');
    url.username = ROLE;
    url.password = PASSWORD;
    applicationUrl = url.toString();
  });

  afterAll(async () => {
    await admin?.query('delete from tenant_platform_binding where platform_tenant_id = any($1)', [
      organisations.all(),
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

  describe('the issuer', () => {
    it('refuses an --issuer that is not the running PLATFORM_AUTH_ISSUER, and writes nothing', async () => {
      const person = platformUser('issuer-mismatch');
      const result = await bootstrap(
        '--platform-user-id',
        person,
        '--issuer',
        'https://identity.somewhere-else.invalid',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('is not this deployment');
      await expectNothingWritten(person);
    });

    it('compares character for character: a trailing slash is a different issuer', async () => {
      const person = platformUser('issuer-slash');
      const result = await bootstrap('--platform-user-id', person, '--issuer', `${ISSUER}/`);

      expect(result.code).toBe(1);
      await expectNothingWritten(person);
    });

    it('requires --issuer even when PLATFORM_AUTH_ISSUER is set', async () => {
      const person = platformUser('issuer-missing');
      const result = await bootstrap('--platform-user-id', person, '--no-issuer');

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Give --issuer');
      await expectNothingWritten(person);
    });

    it('refuses when the environment has no PLATFORM_AUTH_ISSUER to check against', async () => {
      const person = platformUser('issuer-unset');
      const result = await runBootstrap(
        operatorArguments(['--platform-user-id', person], organisations),
        applicationUrl,
        { PLATFORM_AUTH_ISSUER: undefined },
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('PLATFORM_AUTH_ISSUER is not set');
      await expectNothingWritten(person);
    });

    it('refuses a plain-http issuer in production', async () => {
      const issuer = 'http://identity.bootstrap-test.invalid';
      const result = await runBootstrap(
        operatorArguments(
          [
            '--platform-user-id',
            platformUser('issuer-http'),
            '--issuer',
            issuer,
            '--allow-production',
          ],
          organisations,
        ),
        UNREACHABLE,
        { NODE_ENV: 'production', PLATFORM_AUTH_ISSUER: issuer },
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('https');
    });

    it('still accepts the earlier --platform-issuer spelling', async () => {
      const person = platformUser('issuer-alias');
      const result = await bootstrap('--platform-user-id', person, '--platform-issuer', ISSUER);

      expect(result.code).toBe(0);
      expect(await tenantsOf(person)).toHaveLength(1);
    });
  });

  describe('the organisation', () => {
    for (const malformed of ['munaxa-group', 'root', '7F0E6C1A-1B2C-4D3E-8F40-123456789ABC']) {
      it(`refuses "${malformed}", which is not an Identity organisation id`, async () => {
        const person = platformUser(`org-${malformed.slice(0, 6).toLowerCase()}`);
        const result = await bootstrap(
          '--platform-user-id',
          person,
          '--platform-tenant-id',
          malformed,
        );

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('not an Identity organisation id');
        await expectNothingWritten(person);
      });
    }

    it('requires the organisation to be confirmed', async () => {
      const person = platformUser('org-unconfirmed');
      const result = await bootstrap('--platform-user-id', person, '--no-confirm');

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('--confirm-organisation=');
      await expectNothingWritten(person);
    });

    it('refuses a confirmation that names a different organisation', async () => {
      const person = platformUser('org-mismatch');
      const result = await bootstrap(
        '--platform-user-id',
        person,
        `--confirm-organisation=${organisations.fresh()}`,
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('does not repeat');
      await expectNothingWritten(person);
    });

    it('refuses before connecting to the database', async () => {
      const result = await runBootstrap(
        operatorArguments(
          ['--platform-user-id', platformUser('no-connect'), '--platform-tenant-id', 'root'],
          organisations,
        ),
        UNREACHABLE,
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('not an Identity organisation id');
      expect(result.stderr).not.toContain('Bootstrap failed');
    });
  });

  describe('a bound tenant', () => {
    it('is never re-bound to another organisation', async () => {
      const person = platformUser('rebind-org');
      expect((await bootstrap('--platform-user-id', person)).code).toBe(0);
      const other = organisations.fresh();

      const result = await bootstrap('--platform-user-id', person, '--platform-tenant-id', other);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('will not re-bind');
      expect(await bindingsFor(other)).toEqual([]);
      expect(await bindingsFor(organisations.of(person))).toHaveLength(1);
    });

    it('is never re-bound to another issuer, even one the environment agrees with', async () => {
      const person = platformUser('rebind-issuer');
      expect((await bootstrap('--platform-user-id', person)).code).toBe(0);
      const issuer = 'https://identity.other-issuer.invalid';

      const result = await runBootstrap(
        operatorArguments(['--platform-user-id', person, '--issuer', issuer], organisations),
        applicationUrl,
        { PLATFORM_AUTH_ISSUER: issuer },
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('will not re-bind');
      expect(await bindingsFor(organisations.of(person))).toEqual([
        { tenant_id: (await tenantsOf(person))[0], platform_issuer: ISSUER },
      ]);
    });
  });

  describe('--dry-run', () => {
    it('checks everything, prints the planned writes and writes nothing', async () => {
      const person = platformUser('dry-fresh');
      const result = await bootstrap('--platform-user-id', person, '--dry-run');

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Dry run: every check passed; nothing was committed.');
      expect(result.stdout).toContain('tenant_platform_binding');
      expect(result.stdout).toContain('workforce_user');
      expect(result.stdout).toContain('tenant_membership');
      await expectNothingWritten(person);

      expect((await bootstrap('--platform-user-id', person)).code).toBe(0);
      expect(await tenantsOf(person)).toHaveLength(1);
    });

    it('reports no writes for a tenant already bootstrapped and bound', async () => {
      const person = platformUser('dry-again');
      await bootstrap('--platform-user-id', person);
      const result = await bootstrap('--platform-user-id', person, '--dry-run');

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('no writes needed');
    });

    it('finds an organisation already bound to another tenant, and writes nothing', async () => {
      const owner = platformUser('dry-owner');
      await bootstrap('--platform-user-id', owner);
      const person = platformUser('dry-thief');

      const result = await bootstrap(
        '--platform-user-id',
        person,
        '--platform-tenant-id',
        organisations.of(owner),
        '--dry-run',
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('already bound to another Work tenant');
      expect(await tenantsOf(person)).toEqual([]);
      expect(await usersNamed(person)).toBe(0);
    });

    it('refuses a misspelt --dry-run instead of writing', async () => {
      const person = platformUser('dry-typo');
      const result = await bootstrap('--platform-user-id', person, '--dryrun');

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Unknown option --dryrun');
      await expectNothingWritten(person);
    });

    it('refuses an option given twice', async () => {
      const person = platformUser('twice');
      const result = await bootstrap(
        '--platform-user-id',
        person,
        '--platform-user-id',
        platformUser('twice-b'),
      );

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('given twice');
      await expectNothingWritten(person);
    });
  });

  it('connects with DATABASE_MIGRATION_URL, as the work-migrate task provides it', async () => {
    const person = platformUser('migration-url');
    const result = await runBootstrap(
      operatorArguments(['--platform-user-id', person], organisations),
      UNREACHABLE,
      { DATABASE_URL: undefined, DATABASE_MIGRATION_URL: applicationUrl },
    );

    expect(result.code).toBe(0);
    expect(await tenantsOf(person)).toHaveLength(1);
  });
});
