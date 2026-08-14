import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  WORKFLOW_TABLES,
  openWorkflowFixture,
  requireDatabaseInCi,
  type PoolLike,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedDecision, seedHistory, seedInstance } from './workflow-seed.js';

/**
 * Tenant isolation, proved by trying rather than by reading the policy.
 *
 * The suite runs as a role with `rolsuper = false` and `rolbypassrls = false`, asserted by the
 * fixture before anything rests on it. Under a superuser every assertion below passes whether or not
 * a single policy exists.
 *
 * **Counts are asserted as well as rows.** A count computed without the tenant predicate discloses
 * how many approvals are open elsewhere even when no row comes back, and for an approvals engine
 * that number is itself a fact about another company's operations.
 *
 * Both tenants are seeded at the same volume every time, so an empty answer is a policy excluding
 * rows rather than a database that had nothing to exclude.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's isolation suite");

const countIn = async (client: PoolLike, table: string): Promise<number> => {
  const { rows } = await client.query<{ total: string }>(
    `select count(*)::text as total from ${table}`,
  );

  return Number(rows[0]?.total ?? '-1');
};

suite('Workflow tenant isolation', () => {
  let fixture: WorkflowFixture;
  let inA: Awaited<ReturnType<typeof seedInstance>>;
  let inB: Awaited<ReturnType<typeof seedInstance>>;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_isolation_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    inA = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedInstance(client, TENANT_A);

      await seedDecision(client, TENANT_A, seeded);
      await seedHistory(client, TENANT_A, seeded.instanceId);
      return seeded;
    });
    inB = await fixture.asTenant(TENANT_B, async (client) => {
      const seeded = await seedInstance(client, TENANT_B);

      await seedDecision(client, TENANT_B, seeded);
      await seedHistory(client, TENANT_B, seeded.instanceId);
      return seeded;
    });
  });

  it('shows each tenant its own rows on every table, and only those', async () => {
    for (const table of WORKFLOW_TABLES) {
      const seenByA = await fixture.asTenant(TENANT_A, (client) => countIn(client, table));
      const seenByB = await fixture.asTenant(TENANT_B, (client) => countIn(client, table));

      // Both seeded identically, so equal non-zero counts prove each sees one tenant's worth.
      expect([table, seenByA > 0, seenByA === seenByB]).toStrictEqual([table, true, true]);
    }
  });

  it('hides the other tenant’s rows and the other tenant’s totals', async () => {
    const crossing = await fixture.asTenant(TENANT_A, async (client) => ({
      instance: await client.query(`select id from workflow_instance where id = $1`, [
        inB.instanceId,
      ]),
      step: await client.query(`select id from workflow_step where id = $1`, [inB.stepIds[0]]),
      byTenant: await client.query<{ total: string }>(
        `select count(*)::text as total from workflow_instance where tenant_id = $1`,
        [TENANT_B],
      ),
    }));

    expect(crossing.instance.rows).toStrictEqual([]);
    expect(crossing.step.rows).toStrictEqual([]);
    // Naming the other tenant explicitly does not widen anything: the policy is ANDed with the
    // predicate, so a caller who guesses a tenant identifier learns nothing.
    expect(crossing.byTenant.rows[0]?.total).toBe('0');
  });

  it('refuses to insert a row into another tenant', async () => {
    const outcome = await fixture.asTenant(TENANT_A, async (client) => {
      try {
        await client.query(
          `insert into workflow_history
             (tenant_id, instance_id, event, occurred_at, created_at, created_by, updated_at,
              updated_by, version)
           values ($1, $2, 'instance-started', now(), now(), 'user:test', now(), 'user:test', 1)`,
          [TENANT_B, inB.instanceId],
        );
        return 'accepted';
      } catch (error: unknown) {
        return error instanceof Error ? error.message : 'unknown';
      }
    });

    // `with check` is what refuses this. Without it a tenant could write a row it could never read.
    expect(outcome).toMatch(/row-level security/i);
  });

  it('cannot move a row to another tenant', async () => {
    const outcome = await fixture.asTenant(TENANT_A, async (client) => {
      try {
        await client.query(`update workflow_instance set tenant_id = $1 where id = $2`, [
          TENANT_B,
          inA.instanceId,
        ]);
        return 'accepted';
      } catch (error: unknown) {
        return error instanceof Error ? error.message : 'unknown';
      }
    });

    expect(outcome).toMatch(/row-level security/i);

    const stillA = await fixture.asTenant(TENANT_A, (client) =>
      client.query(`select id from workflow_instance where id = $1`, [inA.instanceId]),
    );

    expect(stillA.rows).toHaveLength(1);
  });

  it('confines an unqualified update to the current tenant', async () => {
    await fixture.asTenant(TENANT_A, (client) =>
      client.query(`update workflow_instance set updated_by = 'user:sweeper'`),
    );

    const touched = await fixture.asTenant(TENANT_B, (client) =>
      client.query<{ updated_by: string }>(`select updated_by from workflow_instance`),
    );

    expect(touched.rows.every((row) => row.updated_by === 'user:test')).toBe(true);
  });

  it('confines an unqualified delete to the current tenant', async () => {
    // `workflow_step_template`, because it is the one table nothing references. A decision or a
    // history entry refuses every delete by trigger, and a step is referenced by both — so either
    // choice would prove the trigger or the foreign key rather than the policy.
    await fixture.asTenant(TENANT_A, (client) =>
      client.query(`delete from workflow_step_template`),
    );

    const table = 'workflow_step_template';
    const remaining = await fixture.asTenant(TENANT_B, (client) => countIn(client, table));
    const gone = await fixture.asTenant(TENANT_A, (client) => countIn(client, table));

    expect([gone, remaining > 0]).toStrictEqual([0, true]);
  });

  it('shows nothing at all with no tenant context', async () => {
    // `app_current_tenant()` returns null when the setting is unset, and `tenant_id = null` is
    // never true — so the failure direction is closed rather than open.
    for (const table of WORKFLOW_TABLES) {
      const seen = await fixture.withoutTenant((client) => countIn(client, table));

      expect([table, seen]).toStrictEqual([table, 0]);
    }
  });

  it('has exactly one tenant_isolation policy per table, over every command', async () => {
    const { rows } = await fixture.admin.query<{
      tablename: string;
      policyname: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
      permissive: string;
      roles: string;
    }>(
      `select tablename, policyname, cmd, qual, with_check, permissive, roles::text as roles
         from pg_policies where tablename = any($1::text[]) order by tablename`,
      [WORKFLOW_TABLES],
    );

    // PostgreSQL ORs permissive policies together, so a second well-meaning policy on one table
    // widens it silently and no read-only isolation test would notice.
    expect(rows).toHaveLength(WORKFLOW_TABLES.length);

    for (const row of rows) {
      expect([row.tablename, row.policyname, row.cmd, row.permissive, row.roles]).toStrictEqual([
        row.tablename,
        'tenant_isolation',
        'ALL',
        'PERMISSIVE',
        '{public}',
      ]);
      expect(row.qual).toBe('(tenant_id = app_current_tenant())');
      expect(row.with_check).toBe('(tenant_id = app_current_tenant())');
    }
  });

  it('has row-level security enabled and forced on all seven tables', async () => {
    const { rows } = await fixture.admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
        where relname = any($1::text[]) and relkind = 'r' order by relname`,
      [WORKFLOW_TABLES],
    );

    expect(rows).toHaveLength(WORKFLOW_TABLES.length);
    // FORCE matters as much as ENABLE: without it the table's owner is exempt from its own policies.
    expect(rows.filter((row) => !row.relrowsecurity || !row.relforcerowsecurity)).toStrictEqual([]);
  });

  it('runs as a role that cannot bypass any of it', async () => {
    const { rows } = await fixture.admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolsuper, rolbypassrls from pg_roles where rolname = $1`,
      [fixture.roleName],
    );

    expect(rows[0]).toStrictEqual({ rolsuper: false, rolbypassrls: false });
  });
});
