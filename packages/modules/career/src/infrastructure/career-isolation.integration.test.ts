import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CAREER_TABLES,
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openCareerFixture,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  insertAssessment,
  insertDevelopmentItem,
  insertDevelopmentPlan,
  insertMembership,
  insertMobility,
  insertPath,
  insertPlan,
  insertPool,
  insertReadinessLevel,
  insertStage,
  insertSuccessionPlan,
  insertSuccessor,
} from './career-rows.js';

/**
 * Tenant isolation across all twelve tables, as an unprivileged role, in both directions.
 *
 * **The role owns nothing and holds no `BYPASSRLS`.** That is the only configuration under which any
 * of this means anything: a superuser bypasses every policy, so a suite run as one would pass
 * whether or not isolation worked — and here that would mean reporting that one tenant cannot read
 * another's succession bench without ever having checked.
 *
 * **Both directions, and the counts too.** A policy that isolates A from B and not B from A is a
 * policy somebody wrote once and tested once. And a `count(*)` that included another tenant's rows
 * would leak their existence through a total even while hiding every row — "our competitor has
 * eleven people benched against their CFO" is information, and a hidden row that still increments a
 * total has not been hidden.
 *
 * **What this does not prove**, stated rather than left to be assumed: row-level security isolates
 * *tenants*. "Employee A must not read employee B's readiness assessment" is not a tenant property —
 * a policy would have to know which employment the caller is, and this product has no
 * principal-to-employment resolution (ADR-0032). That guarantee is the application's, and it is
 * stated as absent here rather than implied by a green RLS suite.
 *
 * **A foreign key is not isolation either.** Career's foreign keys couple rows *within* the module.
 * PostgreSQL's referential check runs without consulting a policy, so no FK anywhere in this schema
 * contributes to what is asserted below.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career isolation suite');

suite('career isolation', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_isolation_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** One row in every table this module owns, written by one tenant. */
  const seed = async (tenantId: string): Promise<{ planId: string; assessmentId: string }> => {
    return fixture.asTenant(tenantId, async (client) => {
      const pathId = await insertPath(client, tenantId);

      await insertStage(client, tenantId, pathId, 1);
      await insertPlan(client, tenantId);

      const poolId = await insertPool(client, tenantId);

      await insertMembership(client, tenantId, poolId);

      const levelId = await insertReadinessLevel(client, tenantId);
      const planId = await insertSuccessionPlan(client, tenantId);

      await insertSuccessor(client, tenantId, planId);

      const assessmentId = await insertAssessment(client, tenantId, levelId);
      const developmentPlanId = await insertDevelopmentPlan(client, tenantId);

      await insertDevelopmentItem(client, tenantId, developmentPlanId);
      await insertMobility(client, tenantId);
      return { planId, assessmentId };
    });
  };

  const countIn = (tenantId: string, table: string): Promise<number> =>
    fixture.asTenant(tenantId, async (client) => {
      const counted = await client.query<{ total: string }>(
        `select count(*) as total from ${table}`,
      );

      return Number(counted.rows[0]?.total ?? '0');
    });

  it('shows a tenant its own rows in every table it owns', async () => {
    await seed(TENANT_A);

    for (const table of CAREER_TABLES) {
      expect(await countIn(TENANT_A, table), table).toBe(1);
    }
  });

  it('hides every row from the other tenant, in both directions', async () => {
    await seed(TENANT_A);

    for (const table of CAREER_TABLES) {
      expect(await countIn(TENANT_B, table), table).toBe(0);
    }

    await seed(TENANT_B);

    for (const table of CAREER_TABLES) {
      expect(await countIn(TENANT_A, table), table).toBe(1);
      expect(await countIn(TENANT_B, table), table).toBe(1);
    }
  });

  it('hides a row addressed by its exact identifier', async () => {
    const { planId } = await seed(TENANT_A);

    const found = await fixture.asTenant(TENANT_B, (client) =>
      client.query(`select id from career_succession_plan where id = $1`, [planId]),
    );

    expect(found.rows).toHaveLength(0);
  });

  it('refuses a write that would land in another tenant', async () => {
    await expect(
      fixture.asTenant(TENANT_A, (client) => insertPath(client, TENANT_B, { code: 'smuggled' })),
    ).rejects.toThrow(/row-level security/i);
  });

  it('refuses an update that would move a row into another tenant', async () => {
    await seed(TENANT_A);

    await expect(
      fixture.asTenant(TENANT_A, (client) =>
        client.query(`update career_plan set tenant_id = $1`, [TENANT_B]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('changes nothing in another tenant through an unqualified update or delete', async () => {
    await seed(TENANT_A);
    await seed(TENANT_B);

    const touched = await fixture.asTenant(TENANT_B, async (client) => {
      const updated = await client.query(`update career_talent_pool set status = 'closed'`);
      const deleted = await client.query(`delete from career_pool_membership`);

      return { updated: updated.rowCount, deleted: deleted.rowCount };
    });

    expect(touched).toEqual({ updated: 1, deleted: 1 });
    expect(await countIn(TENANT_A, 'career_pool_membership')).toBe(1);

    const survived = await fixture.asTenant(TENANT_A, (client) =>
      client.query<{ status: string }>(`select status from career_talent_pool`),
    );

    expect(survived.rows[0]?.status).toBe('active');
  });

  /**
   * With no tenant set at all — the state a pooled connection is in between transactions.
   *
   * `app_current_tenant()` returns null, the policy compares every row against null, and nothing
   * matches. A schema that leaked here would leak to any code path that forgot to set the context,
   * which is the failure mode a policy exists to make impossible rather than unlikely.
   */
  it('shows nothing when no tenant is set', async () => {
    await seed(TENANT_A);

    const client = await fixture.application.connect();

    try {
      const counted = await client.query<{ total: string }>(
        `select count(*) as total from career_readiness_assessment`,
      );

      expect(Number(counted.rows[0]?.total ?? '-1')).toBe(0);
    } finally {
      client.release();
    }
  });

  /**
   * The premise of every assertion above, checked rather than assumed.
   *
   * If the role this suite connects as were a superuser or held `BYPASSRLS`, every test here would
   * pass by bypassing the thing it claims to prove.
   */
  it('runs as a role that can neither bypass nor own its way past a policy', async () => {
    const role = await fixture.asTenant(TENANT_A, (client) =>
      client.query<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }>(
        `select rolsuper, rolbypassrls, current_user from pg_roles where rolname = current_user`,
      ),
    );

    expect(role.rows[0]?.rolsuper).toBe(false);
    expect(role.rows[0]?.rolbypassrls).toBe(false);
    expect(role.rows[0]?.current_user).toBe('career_isolation_role');
  });

  /**
   * `force row level security` is what makes the policy apply to the table's *owner* too. Without
   * it, the migration user reads every tenant's rows, and any future job or repair script that ran
   * as the owner would silently be exempt.
   */
  it('has row-level security enabled and forced on all twelve tables', async () => {
    const protection = await fixture.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*) from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c
        where c.relname = any($1::text[])`,
      [CAREER_TABLES],
    );

    expect(protection.rows).toHaveLength(CAREER_TABLES.length);
    for (const row of protection.rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      expect(row.relforcerowsecurity, row.relname).toBe(true);
      expect(Number(row.policies), row.relname).toBe(1);
    }
  });
});
