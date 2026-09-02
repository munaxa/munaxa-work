import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Proves that membership resolution works under the privilege model a real deployment has, and
 * that the reach it needs did not become a general way around row-level security (ADR-0077).
 *
 * The defect this guards against is invisible rather than loud. `app_memberships_of` is
 * `security definer` over tables carrying `force row level security`, and FORCE applies to the
 * table owner too — so before ADR-0077 the function ran subject to `tenant_isolation` with no
 * tenant in context, matched nothing, and returned zero rows. Tenant resolution then found no
 * membership and every authenticated request answered 401 with nothing in any log to say why. CI
 * never saw it because migrations there run as a superuser, whom FORCE does not apply to.
 *
 * So these tests are deliberately run against **roles that are not superusers**, created here, and
 * every assertion is made through the same function the request pipeline calls. A suite that
 * connected as the owner would reproduce CI's blind spot rather than the deployment's behaviour.
 */

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const APPLICATION = 'work_app_resolution_test';
const PASSWORD = 'probe';
const RESOLVER = 'work_membership_resolver';

/** Distinct per run, so a suite that failed midway cannot poison the next one. */
const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const person = (suffix: string): string => `resolution-test-${stamp}-${suffix}`;

const TENANT_A = '01920000-0000-7000-8000-0000000a0001';
const TENANT_B = '01920000-0000-7000-8000-0000000b0002';

interface Membership {
  readonly tenant_id: string;
  readonly platform_user_id: string;
}

if (CONNECTION === undefined && process.env.CI !== undefined) {
  throw new Error(
    'Membership resolution tests require a database. Set TEST_DATABASE_URL. Refusing to skip in CI.',
  );
}

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('membership resolution under force row level security', () => {
  let admin: Client;
  let application: Client;

  /**
   * Writes one person and one membership, as the application role, under the tenant's own policy.
   *
   * Identifiers are generated rather than read back, for the reason the bootstrap command has the
   * same shape: `returning` is a select, and `workforce_user`'s reachability policy refuses one
   * until the membership that makes the row reachable exists.
   */
  const workforceIds = new Map<string, string>();

  const admit = async (
    platformUserId: string,
    tenantId: string,
    userStatus = 'active',
    membershipStatus = 'active',
  ): Promise<string> => {
    const known = workforceIds.get(platformUserId);
    const generated = await application.query<{ u: string; m: string }>(
      'select app_uuid_v7() as u, app_uuid_v7() as m',
    );
    const userId = known ?? generated.rows[0]?.u ?? '';
    const membershipId = generated.rows[0]?.m ?? '';

    await application.query('begin');
    try {
      await application.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);

      if (known === undefined) {
        await application.query(
          `insert into workforce_user
             (id, platform_user_id, status, created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, now(), 'test', now(), 'test', 1)`,
          [userId, platformUserId, userStatus],
        );
      }
      await application.query(
        `insert into tenant_membership
           (id, tenant_id, workforce_user_id, status, joined_at,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, now(), now(), 'test', now(), 'test', 1)`,
        [membershipId, tenantId, userId, membershipStatus],
      );
      await application.query('commit');
    } catch (error) {
      await application.query('rollback');
      throw error;
    }
    workforceIds.set(platformUserId, userId);
    return userId;
  };

  /** Resolution exactly as the request pipeline performs it: as the application role. */
  const resolve = async (platformUserId: string): Promise<readonly Membership[]> => {
    const found = await application.query<Membership>(
      'select tenant_id, platform_user_id from app_memberships_of($1) order by tenant_id',
      [platformUserId],
    );
    return found.rows;
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: CONNECTION });
    await admin.connect();

    await admin.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = '${APPLICATION}') then
          create role ${APPLICATION} login nosuperuser nobypassrls password '${PASSWORD}';
        end if;
      end $$`);
    await admin.query(`grant usage on schema public to ${APPLICATION}`);
    await admin.query(
      `grant select, insert, update, delete on all tables in schema public to ${APPLICATION}`,
    );
    await admin.query(`grant execute on all functions in schema public to ${APPLICATION}`);

    const url = new URL(CONNECTION ?? '');
    url.username = APPLICATION;
    url.password = PASSWORD;
    application = new Client({ connectionString: url.toString() });
    await application.connect();
  });

  afterAll(async () => {
    await application?.end();
    await admin?.query(
      `delete from tenant_membership m using workforce_user u
        where u.id = m.workforce_user_id and u.platform_user_id like $1`,
      [`resolution-test-${stamp}-%`],
    );
    await admin?.query('delete from workforce_user where platform_user_id like $1', [
      `resolution-test-${stamp}-%`,
    ]);
    await admin?.end();
  });

  describe('the role matrix a deployment actually has', () => {
    it('runs the application as a role that is neither superuser nor able to bypass isolation', async () => {
      const diagnostics = await application.query<{
        is_superuser: boolean;
        can_bypass_rls: boolean;
      }>('select is_superuser, can_bypass_rls from app_isolation_diagnostics()');

      expect(diagnostics.rows[0]).toEqual({ is_superuser: false, can_bypass_rls: false });
    });

    it('owns the resolution function with a role that cannot log in', async () => {
      const owner = await admin.query<{ rolname: string; rolcanlogin: boolean }>(
        `select r.rolname, r.rolcanlogin
           from pg_proc p join pg_roles r on r.oid = p.proowner
          where p.proname = 'app_memberships_of'`,
      );

      expect(owner.rows[0]).toEqual({ rolname: RESOLVER, rolcanlogin: false });
    });

    it('gives that role no privilege attribute of any kind', async () => {
      const attributes = await admin.query<Record<string, boolean>>(
        `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication
           from pg_roles where rolname = $1`,
        [RESOLVER],
      );

      expect(Object.values(attributes.rows[0] ?? {})).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
    });

    it('limits its reach to reading exactly two tables', async () => {
      const privileges = await admin.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.table_privileges
          where grantee = $1 order by table_name, privilege_type`,
        [RESOLVER],
      );

      expect(privileges.rows).toEqual([
        { table_name: 'tenant_membership', privilege_type: 'SELECT' },
        { table_name: 'workforce_user', privilege_type: 'SELECT' },
      ]);
    });

    it('reaches those rows through a policy naming it, not through a role privilege', async () => {
      const policies = await admin.query<{ tablename: string; cmd: string; roles: string }>(
        `select tablename, cmd, roles::text from pg_policies
          where policyname = 'membership_resolution' order by tablename`,
      );

      expect(policies.rows).toEqual([
        { tablename: 'tenant_membership', cmd: 'SELECT', roles: `{${RESOLVER}}` },
        { tablename: 'workforce_user', cmd: 'SELECT', roles: `{${RESOLVER}}` },
      ]);
    });

    it('does not let the application role become the resolver', async () => {
      const member = await admin.query<{ has: boolean }>('select pg_has_role($1, $2, $3) as has', [
        APPLICATION,
        RESOLVER,
        'MEMBER',
      ]);

      expect(member.rows[0]?.has).toBe(false);
    });

    it('leaves row-level security forced on every protected table', async () => {
      const forced = await admin.query<{ count: number }>(
        `select count(*)::int as count from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and c.relrowsecurity and not c.relforcerowsecurity`,
      );

      expect(forced.rows[0]?.count).toBe(0);
    });

    it('needs no role in the deployment to hold BYPASSRLS', async () => {
      // The application role and the resolver are the two this product provisions. Neither holds
      // it, which is the property ADR-0033 wanted and ADR-0077 finally delivers.
      const holders = await admin.query<{ rolname: string }>(
        'select rolname from pg_roles where rolbypassrls and rolname in ($1, $2)',
        [APPLICATION, RESOLVER],
      );

      expect(holders.rows).toEqual([]);
    });
  });

  describe('what resolution answers', () => {
    it('resolves a person to their own active membership', async () => {
      const alice = person('alice');
      await admit(alice, TENANT_A);

      expect(await resolve(alice)).toEqual([{ tenant_id: TENANT_A, platform_user_id: alice }]);
    });

    it('resolves both tenants for somebody who belongs to two, and no others', async () => {
      const consultant = person('consultant');
      await admit(consultant, TENANT_A);
      await admit(consultant, TENANT_B);

      expect((await resolve(consultant)).map((row) => row.tenant_id)).toEqual([TENANT_A, TENANT_B]);
    });

    it('resolves nothing for a suspended person', async () => {
      const suspended = person('suspended-user');
      await admit(suspended, TENANT_A, 'suspended');

      expect(await resolve(suspended)).toEqual([]);
    });

    it('resolves nothing for a suspended membership', async () => {
      const ended = person('suspended-membership');
      await admit(ended, TENANT_A, 'active', 'suspended');

      expect(await resolve(ended)).toEqual([]);
    });

    it('resolves nothing for somebody no tenant has admitted', async () => {
      expect(await resolve(person('stranger'))).toEqual([]);
    });

    it('answers about the person asked for and nobody else', async () => {
      const alice = person('discovery-alice');
      const bob = person('discovery-bob');
      await admit(alice, TENANT_A);
      await admit(bob, TENANT_B);

      const answered = await resolve(alice);

      expect(answered.every((row) => row.platform_user_id === alice)).toBe(true);
      expect(answered.map((row) => row.tenant_id)).not.toContain(TENANT_B);
    });

    it('takes a Platform identity and nothing else — no tenant can be supplied to it', async () => {
      const signature = await admin.query<{ args: string }>(
        `select pg_get_function_arguments(oid) as args from pg_proc where proname = 'app_memberships_of'`,
      );

      // A caller cannot name a tenant here, so no argument can widen what they reach.
      expect(signature.rows[0]?.args).toBe('p_platform_user_id character varying');
    });
  });

  describe('the reach the resolver has does not leak', () => {
    it('leaves the application role seeing only the tenant it is acting in', async () => {
      const alice = person('isolation-alice');
      const bob = person('isolation-bob');
      await admit(alice, TENANT_A);
      await admit(bob, TENANT_B);

      await application.query('begin');
      await application.query('select set_config($1, $2, true)', ['app.tenant_id', TENANT_A]);
      const own = await application.query<{ count: number }>(
        'select count(*)::int as count from tenant_membership where tenant_id = $1',
        [TENANT_A],
      );
      const other = await application.query<{ count: number }>(
        'select count(*)::int as count from tenant_membership where tenant_id = $1',
        [TENANT_B],
      );
      await application.query('commit');

      expect(own.rows[0]?.count).toBeGreaterThan(0);
      expect(other.rows[0]?.count).toBe(0);
    });

    it('leaves the application role seeing nothing with no tenant in context', async () => {
      await admit(person('fail-closed'), TENANT_A);
      const seen = await application.query<{ count: number }>(
        'select count(*)::int as count from tenant_membership',
      );

      expect(seen.rows[0]?.count).toBe(0);
    });

    it('leaves a workforce user unreadable from a tenant that has not admitted them', async () => {
      const stranger = person('reachability');
      await admit(stranger, TENANT_A);

      await application.query('begin');
      await application.query('select set_config($1, $2, true)', ['app.tenant_id', TENANT_B]);
      const seen = await application.query<{ count: number }>(
        'select count(*)::int as count from workforce_user where platform_user_id = $1',
        [stranger],
      );
      await application.query('commit');

      expect(seen.rows[0]?.count).toBe(0);
    });
  });
});
