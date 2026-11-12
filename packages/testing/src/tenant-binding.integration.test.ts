import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * WK-01 at the database, where the control lives (ADR-0080).
 *
 * `app_bound_memberships_of(sub, issuer, organisation)` is the only path a request takes from a
 * verified token to a tenant. These tests prove, against a real PostgreSQL and as roles that are
 * **not** superusers, that it returns only memberships of the Work tenant bound to the token's
 * organisation; that the binding is one-to-one; that the runtime role cannot rewrite it; and that a
 * tenant cannot read another tenant's binding. The deployed runtime grant file
 * (`deploy/aws/runtime-grants.sql`) is applied verbatim to a `work_app` role, so the privilege test
 * is about the file a deployment runs and not a copy of it.
 */

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const PROVISIONER = 'work_binding_provisioner_test';
const RUNTIME = 'work_app';
const PASSWORD = 'probe';
const ISSUER = 'https://identity.binding-test.invalid';
const OTHER_ISSUER = 'https://identity.elsewhere.invalid';

const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const person = (suffix: string): string => `binding-test-${stamp}-${suffix}`;
const org = (suffix: string): string => `org-${stamp}-${suffix}`;

const GRANTS = fileURLToPath(new URL('../../../deploy/aws/runtime-grants.sql', import.meta.url));

if (CONNECTION === undefined && process.env.CI !== undefined) {
  throw new Error(
    'Tenant binding tests require a database. Set TEST_DATABASE_URL. Refusing to skip in CI.',
  );
}

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

/** A fresh UUID v7 per tenant, so runs never share a tenant. */
const tenantId = async (client: Client): Promise<string> =>
  (await client.query<{ id: string }>('select app_uuid_v7() as id')).rows[0]?.id ?? '';

describeWithDatabase('tenant-to-organisation binding (WK-01)', () => {
  let admin: Client;
  let provisioner: Client;
  let runtime: Client;
  const workforce = new Map<string, string>();
  const tenants: string[] = [];

  const urlFor = (role: string): string => {
    const url = new URL(CONNECTION ?? '');
    url.username = role;
    url.password = PASSWORD;
    return url.toString();
  };

  const inTenant = async <T>(
    client: Client,
    tenant: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    await client.query('begin');
    try {
      await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenant]);
      const result = await work();
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  };

  const admit = async (platformUserId: string, tenant: string): Promise<void> => {
    const ids = await provisioner.query<{ u: string; m: string }>(
      'select app_uuid_v7() as u, app_uuid_v7() as m',
    );
    const known = workforce.get(platformUserId);
    const userId = known ?? ids.rows[0]?.u ?? '';
    await inTenant(provisioner, tenant, async () => {
      if (known === undefined) {
        await provisioner.query(
          `insert into workforce_user
             (id, platform_user_id, status, created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, 'active', now(), 'test', now(), 'test', 1)`,
          [userId, platformUserId],
        );
      }
      await provisioner.query(
        `insert into tenant_membership
           (id, tenant_id, workforce_user_id, status, joined_at,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, 'active', now(), now(), 'test', now(), 'test', 1)`,
        [ids.rows[0]?.m, tenant, userId],
      );
    });
    workforce.set(platformUserId, userId);
  };

  const bind = (client: Client, tenant: string, organisation: string, issuer = ISSUER) =>
    inTenant(client, tenant, () =>
      client.query(
        `insert into tenant_platform_binding
           (tenant_id, platform_issuer, platform_tenant_id,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, now(), 'test', now(), 'test', 1)`,
        [tenant, issuer, organisation],
      ),
    );

  /** Resolution exactly as the request pipeline performs it: as the runtime role. */
  const resolve = async (platformUserId: string, organisation: string, issuer = ISSUER) =>
    (
      await runtime.query<{ tenant_id: string }>(
        'select tenant_id from app_bound_memberships_of($1, $2, $3) order by tenant_id',
        [platformUserId, issuer, organisation],
      )
    ).rows.map((row) => row.tenant_id);

  const newTenant = async (): Promise<string> => {
    const id = await tenantId(admin);
    tenants.push(id);
    return id;
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: CONNECTION });
    await admin.connect();

    for (const role of [PROVISIONER, RUNTIME]) {
      await admin.query(`
        do $$ begin
          if not exists (select 1 from pg_roles where rolname = '${role}') then
            create role ${role} login nosuperuser nobypassrls password '${PASSWORD}';
          end if;
        end $$`);
      await admin.query(`alter role ${role} login nosuperuser nobypassrls password '${PASSWORD}'`);
    }
    // The provisioner stands for the owner role bootstrap runs as: it may write all three tables.
    await admin.query(`grant usage on schema public to ${PROVISIONER}`);
    await admin.query(
      `grant select, insert, update, delete on workforce_user, tenant_membership, tenant_platform_binding to ${PROVISIONER}`,
    );
    await admin.query(`grant execute on all functions in schema public to ${PROVISIONER}`);
    // The runtime role gets exactly what a deployment gives it.
    await admin.query(readFileSync(GRANTS, 'utf8'));

    provisioner = new Client({ connectionString: urlFor(PROVISIONER) });
    runtime = new Client({ connectionString: urlFor(RUNTIME) });
    await provisioner.connect();
    await runtime.connect();
  });

  afterAll(async () => {
    await provisioner?.end();
    await runtime?.end();
    if (tenants.length > 0) {
      await admin?.query('delete from tenant_platform_binding where tenant_id = any($1::uuid[])', [
        tenants,
      ]);
      await admin?.query('delete from tenant_membership where tenant_id = any($1::uuid[])', [
        tenants,
      ]);
    }
    await admin?.query('delete from workforce_user where platform_user_id like $1', [
      `binding-test-${stamp}-%`,
    ]);
    await admin?.end();
  });

  describe('resolution', () => {
    it('a member of two tenants resolves, per token organisation, to that organisation’s tenant only', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const orgA = org('a1');
      const orgB = org('b1');
      await bind(provisioner, a, orgA);
      await bind(provisioner, b, orgB);
      const consultant = person('consultant');
      await admit(consultant, a);
      await admit(consultant, b);

      expect(await resolve(consultant, orgA)).toEqual([a]);
      expect(await resolve(consultant, orgB)).toEqual([b]);
    });

    it('resolves nothing for an organisation bound to no tenant, or under another issuer', async () => {
      const a = await newTenant();
      const orgA = org('a2');
      await bind(provisioner, a, orgA);
      const alice = person('alice');
      await admit(alice, a);

      expect(await resolve(alice, org('unbound'))).toEqual([]);
      expect(await resolve(alice, orgA, OTHER_ISSUER)).toEqual([]);
      // The Work tenant id itself is not an organisation id.
      expect(await resolve(alice, a)).toEqual([]);
    });

    it('resolves nothing for a membership in a tenant that has no binding (fail closed)', async () => {
      const unbound = await newTenant();
      const bob = person('bob');
      await admit(bob, unbound);

      expect(await resolve(bob, org('anything'))).toEqual([]);
      // The unrestricted function still sees the membership: only the bound path is used by requests.
      const raw = await runtime.query('select tenant_id from app_memberships_of($1)', [bob]);
      expect(raw.rows).toHaveLength(1);
    });

    it('resolves nothing once the binding is soft-deleted', async () => {
      const a = await newTenant();
      const orgA = org('a3');
      await bind(provisioner, a, orgA);
      const carol = person('carol');
      await admit(carol, a);
      expect(await resolve(carol, orgA)).toEqual([a]);

      await inTenant(provisioner, a, () =>
        provisioner.query(
          `update tenant_platform_binding set deleted_at = now(), deleted_by = 'test' where tenant_id = $1`,
          [a],
        ),
      );
      expect(await resolve(carol, orgA)).toEqual([]);
    });

    it('resolves nothing for a suspended membership, even in the bound tenant', async () => {
      const a = await newTenant();
      const orgA = org('a4');
      await bind(provisioner, a, orgA);
      const dave = person('dave');
      await admit(dave, a);
      await inTenant(provisioner, a, () =>
        provisioner.query(
          `update tenant_membership set status = 'suspended' where tenant_id = $1`,
          [a],
        ),
      );
      expect(await resolve(dave, orgA)).toEqual([]);
    });
  });

  describe('the binding is one-to-one', () => {
    it('refuses binding one organisation to a second tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const shared = org('shared');
      await bind(provisioner, a, shared);

      await expect(bind(provisioner, b, shared)).rejects.toMatchObject({
        code: '23505',
        constraint: 'tenant_platform_binding_organisation_key',
      });
    });

    it('refuses a second binding for one tenant', async () => {
      const a = await newTenant();
      await bind(provisioner, a, org('first'));

      await expect(bind(provisioner, a, org('second'))).rejects.toMatchObject({
        code: '23505',
        constraint: 'tenant_platform_binding_tenant_key',
      });
    });

    it('refuses a binding written into another tenant (row-level security with check)', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await expect(
        inTenant(provisioner, a, () =>
          provisioner.query(
            `insert into tenant_platform_binding
               (tenant_id, platform_issuer, platform_tenant_id,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, $3, now(), 'test', now(), 'test', 1)`,
            [b, ISSUER, org('smuggled')],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  describe('the runtime role', () => {
    it('may read its own tenant’s binding and no other', async () => {
      const a = await newTenant();
      const b = await newTenant();
      await bind(provisioner, a, org('ra'));
      await bind(provisioner, b, org('rb'));

      const seen = await inTenant(runtime, a, () =>
        runtime.query<{ tenant_id: string }>('select tenant_id from tenant_platform_binding'),
      );
      expect(seen.rows.map((row) => row.tenant_id)).toEqual([a]);

      const none = await runtime.query('select count(*)::int as n from tenant_platform_binding');
      expect(none.rows[0]).toEqual({ n: 0 });
    });

    it('cannot insert, update, delete or truncate a binding, even inside its own tenant', async () => {
      const a = await newTenant();
      await bind(provisioner, a, org('locked'));

      for (const statement of [
        `insert into tenant_platform_binding
           (tenant_id, platform_issuer, platform_tenant_id,
            created_at, created_by, updated_at, updated_by, version)
         values (app_current_tenant(), '${ISSUER}', 'org-attacker', now(), 'x', now(), 'x', 1)`,
        `update tenant_platform_binding set platform_tenant_id = 'org-attacker'`,
        'delete from tenant_platform_binding',
        'truncate tenant_platform_binding',
      ]) {
        await expect(inTenant(runtime, a, () => runtime.query(statement))).rejects.toMatchObject({
          code: '42501',
        });
      }

      const after = await inTenant(provisioner, a, () =>
        provisioner.query<{ platform_tenant_id: string }>(
          'select platform_tenant_id from tenant_platform_binding',
        ),
      );
      expect(after.rows).toEqual([{ platform_tenant_id: org('locked') }]);
    });

    it('is not a member of the resolver role, and the function is owned by the resolver', async () => {
      const member = await admin.query<{ has: boolean }>(
        "select pg_has_role($1, 'work_membership_resolver', 'MEMBER') as has",
        [RUNTIME],
      );
      expect(member.rows[0]?.has).toBe(false);
      const owner = await admin.query<{ rolname: string }>(
        `select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner
          where p.proname = 'app_bound_memberships_of'`,
      );
      expect(owner.rows).toEqual([{ rolname: 'work_membership_resolver' }]);
    });
  });
});
