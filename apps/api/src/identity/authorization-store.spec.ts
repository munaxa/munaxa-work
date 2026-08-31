import { unsafeId, type TenantId, type UserId } from '@munaxa/types';
import { assertIsolationEnforced } from '@work/persistence';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  B_MEMBER,
  CONNECTION,
  MEMBER,
  OTHER_MEMBER,
  TENANT_A,
  TENANT_B,
  openSecurityBoundary,
  requireDatabaseInCi,
  type SecurityFixture,
} from './security.fixture.js';

/**
 * The two authorization tables, against the database's own policies rather than against the
 * queries that read them.
 *
 * A security table whose isolation is only in its `where` clause is a security table one typo away
 * from serving another tenant's grants, so every claim here is made through an **unprivileged
 * role** with row-level security forced on. The cross-tenant attempts are explicit: the suite asks
 * for tenant A's rows while in tenant B's context and asserts it is given nothing, rather than
 * asserting that a function it wrote filtered correctly.
 */

const tenant = (value: string): TenantId => unsafeId<TenantId>(value);
const subject = (value: string): UserId => unsafeId<UserId>(value);

requireDatabaseInCi('The authorization store isolation suite');

describe.skipIf(CONNECTION === undefined)('the Work-held authorization store', () => {
  let fixture: SecurityFixture;

  beforeAll(async () => {
    fixture = await openSecurityBoundary();
  }, 60_000);

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.reset();
  });

  it('runs as a role row-level security can actually refuse', async () => {
    const diagnostics = await assertIsolationEnforced(fixture.pool);

    expect(diagnostics.canBypassRowLevelSecurity).toBe(false);
    expect(diagnostics.isSuperuser).toBe(false);
  });

  it('protects both tables with a forced policy, applied by the migration that created them', async () => {
    const { rows } = await fixture.owner.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: number;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
         from pg_class c
        where c.relname in ('tenant_role', 'tenant_role_assignment')
        order by c.relname`,
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
      expect(row.policies).toBeGreaterThan(0);
    }
  });

  describe('tenant isolation', () => {
    it('does not show one tenant’s roles to another', async () => {
      await fixture.grant(TENANT_A, MEMBER, ['workflow:approval:read-own'], 'reader');

      const inB = await fixture.pool.query('select 1 from tenant_role where role_id = $1', [
        'reader',
      ]);

      // No tenant context at all: the policy answers with no rows rather than with everything.
      expect(inB.rowCount).toBe(0);
    });

    it('resolves nothing for a membership of another tenant', async () => {
      await fixture.grant(TENANT_A, MEMBER, ['workflow:approval:read-own'], 'reader');

      const acrossTenants = await fixture.authorization.forMembership(
        tenant(TENANT_B),
        subject(MEMBER),
      );

      expect(acrossTenants).toEqual([]);
    });

    it('refuses to write a row into another tenant', async () => {
      const client = await fixture.pool.connect();

      try {
        await client.query('begin');
        await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_B]);
        await expect(
          client.query(
            `insert into tenant_role
               (tenant_id, role_id, name, permissions, inherits, system,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, 'smuggled', 'Smuggled', '{}', '{}', false,
                     now(), 'test', now(), 'test', 1)`,
            [TENANT_A],
          ),
          // `with check` governs what a statement may write. Without it, a tenant could plant a
          // role in another tenant that its own administrators would never see.
        ).rejects.toThrow(/row-level security/i);
      } finally {
        await client.query('rollback');
        client.release();
      }
    });
  });

  describe('membership isolation', () => {
    it('does not lend one membership’s grant to another in the same tenant', async () => {
      await fixture.grant(TENANT_A, MEMBER, ['workflow:approval:read-own'], 'reader');

      expect(await fixture.authorization.forMembership(tenant(TENANT_A), subject(MEMBER))).toEqual([
        'workflow:approval:read-own',
      ]);
      expect(
        await fixture.authorization.forMembership(tenant(TENANT_A), subject(OTHER_MEMBER)),
      ).toEqual([]);
    });

    it('refuses an assignment to a membership that does not exist', async () => {
      await fixture.authorization.defineRole({
        id: 'reader',
        tenantId: tenant(TENANT_A),
        name: 'Reader',
        permissions: ['workflow:approval:read-own'],
      });

      await expect(
        fixture.authorization.assign({
          tenantId: tenant(TENANT_A),
          userId: subject('01931111-0000-7000-8000-0000000000ff'),
          roleId: 'reader',
          assignedAt: Date.now(),
        }),
      ).rejects.toThrow(/foreign key/i);
    });

    it('refuses an assignment to a membership belonging to another tenant', async () => {
      await fixture.authorization.defineRole({
        id: 'reader',
        tenantId: tenant(TENANT_A),
        name: 'Reader',
        permissions: ['workflow:approval:read-own'],
      });

      // The membership exists, and it is tenant B's. The composite foreign key is what refuses
      // the row: its subject has to be a member of the tenant doing the granting.
      await expect(
        fixture.authorization.assign({
          tenantId: tenant(TENANT_A),
          userId: subject(B_MEMBER),
          roleId: 'reader',
          assignedAt: Date.now(),
        }),
      ).rejects.toThrow(/foreign key/i);
    });
  });

  describe('what a grant is worth', () => {
    it('confers nothing once the assignment has expired', async () => {
      await fixture.authorization.defineRole({
        id: 'reader',
        tenantId: tenant(TENANT_A),
        name: 'Reader',
        permissions: ['workflow:approval:read-own'],
      });
      await fixture.authorization.assign({
        tenantId: tenant(TENANT_A),
        userId: subject(MEMBER),
        roleId: 'reader',
        assignedAt: Date.now() - 2_000,
        expiresAt: Date.now() - 1_000,
      });

      expect(await fixture.authorization.forMembership(tenant(TENANT_A), subject(MEMBER))).toEqual(
        [],
      );
    });

    it('confers nothing once the role has been removed', async () => {
      await fixture.grant(TENANT_A, MEMBER, ['workflow:approval:read-own'], 'reader');
      await fixture.authorization.removeRole(tenant(TENANT_A), 'reader');

      expect(await fixture.authorization.forMembership(tenant(TENANT_A), subject(MEMBER))).toEqual(
        [],
      );
    });

    it('withdraws one scope of a role without withdrawing the others', async () => {
      await fixture.authorization.defineRole({
        id: 'reader',
        tenantId: tenant(TENANT_A),
        name: 'Reader',
        permissions: ['workflow:approval:read-own'],
      });
      for (const scope of ['finance', 'operations']) {
        await fixture.authorization.assign({
          tenantId: tenant(TENANT_A),
          userId: subject(MEMBER),
          roleId: 'reader',
          assignedAt: Date.now(),
          scope,
        });
      }

      await fixture.authorization.revoke(tenant(TENANT_A), subject(MEMBER), 'reader', 'finance');

      expect(await fixture.authorization.forMembership(tenant(TENANT_A), subject(MEMBER))).toEqual([
        'workflow:approval:read-own:operations',
      ]);
    });

    it('refuses a malformed grant at the platform’s validator and at the table', async () => {
      await expect(
        fixture.authorization.defineRole({
          id: 'broken',
          tenantId: tenant(TENANT_A),
          name: 'Broken',
          permissions: ['Workflow.Approval.Read'],
        }),
      ).rejects.toThrow(/Invalid permission/);

      const client = await fixture.pool.connect();

      try {
        await client.query('begin');
        await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);
        await expect(
          client.query(
            `insert into tenant_role
               (tenant_id, role_id, name, permissions, inherits, system,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, 'broken', 'Broken', '{"Workflow.Approval.Read"}', '{}', false,
                     now(), 'test', now(), 'test', 1)`,
            [TENANT_A],
          ),
        ).rejects.toThrow(/tenant_role_permission_grammar_check/);
      } finally {
        await client.query('rollback');
        client.release();
      }
    });
  });

  describe('auditability and concurrency', () => {
    it('records who assigned a grant and when, without being told', async () => {
      await fixture.grant(TENANT_A, MEMBER, ['workflow:approval:read-own'], 'reader');

      const client = await fixture.pool.connect();

      try {
        await client.query('begin');
        await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);

        const { rows } = await client.query<{ created_by: string; version: number }>(
          `select created_by, version from tenant_role_assignment where membership_id = $1`,
          [MEMBER],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]?.created_by).not.toBe('');
        expect(rows[0]?.version).toBe(1);
      } finally {
        await client.query('rollback');
        client.release();
      }
    });

    it('assigns the same role twice without producing two grants', async () => {
      for (const _ of [1, 2]) {
        await fixture.grant(TENANT_A, MEMBER, ['workflow:approval:read-own'], 'reader');
      }

      const client = await fixture.pool.connect();

      try {
        await client.query('begin');
        await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);

        const { rows } = await client.query<{ count: string }>(
          `select count(*) from tenant_role_assignment
            where membership_id = $1 and deleted_at is null`,
          [MEMBER],
        );

        // A select-then-insert would produce two rows under concurrency. The unique index and the
        // upsert make the second assignment the same assignment.
        expect(rows[0]?.count).toBe('1');
      } finally {
        await client.query('rollback');
        client.release();
      }
    });
  });
});
