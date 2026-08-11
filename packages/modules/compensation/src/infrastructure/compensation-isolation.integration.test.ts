import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  COMPENSATION_TABLES,
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openCompensationFixture,
  requireDatabaseInCi,
  type CompensationFixture,
} from './compensation-database.fixture.js';
import { aRecurring, anAdjustment, configuredTenant } from './compensation-fixtures.js';

/**
 * Tenant isolation, as the **unprivileged role**.
 *
 * The suite connects as a role that owns nothing and holds no `BYPASSRLS`, which is the only
 * configuration under which any of this means anything: a superuser bypasses every policy, so a
 * suite run as one would report that tenants are isolated without having checked.
 *
 * Four assertions are specifically dangerous rather than routine, and each has its own test:
 *
 * - **the as-of resolution** — a leak here puts one tenant's salary on another tenant's payroll
 *   input, which is the worst disclosure this module can make;
 * - **the set-based payroll read** — a set-based query that lost its tenant clause fails silently
 *   rather than loudly, because it simply returns more rows;
 * - **the overlap constraint** — one tenant's assignment must not be able to block another's;
 * - **the cross-tenant employment reference** — and this one records a finding rather than a
 *   guarantee.
 */

requireDatabaseInCi('Compensation isolation');

describe.skipIf(CONNECTION === undefined)('tenant isolation', () => {
  let fixture: CompensationFixture;

  beforeAll(async () => {
    fixture = await openCompensationFixture('compensation_fixture');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('protects every one of the fourteen tables', async () => {
    const protectedTables = await fixture.admin.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public' and tablename = any($1::text[])
          and rowsecurity = true`,
      [COMPENSATION_TABLES],
    );

    expect(protectedTables.rows).toHaveLength(COMPENSATION_TABLES.length);
  });

  it('forces row-level security, so even a table owner is subject to it', async () => {
    const forced = await fixture.admin.query<{ relname: string }>(
      `select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[]) and c.relforcerowsecurity`,
      [COMPENSATION_TABLES],
    );

    expect(forced.rows).toHaveLength(COMPENSATION_TABLES.length);
  });

  it("hides one tenant's compensation from another, by identifier", async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const recordId = await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);
      const record = aRecurring(TENANT_A, employmentId, componentId, planId);

      await fixture.stores.recurring.insert(transaction, record);
      return record.id;
    });

    const seen = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.recurring.byId(transaction, recordId),
    );

    expect(seen).toBeUndefined();
  });

  it('hides it from a search as well as from a lookup', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, componentId, planId),
      );
    });

    const page = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.recurring.search(transaction, { limit: 50, offset: 0 }),
    );

    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  it('scopes the as-of resolution — the worst leak this module could make', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, componentId, planId),
      );
    });

    const seen = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.recurring.inForceOn(transaction, employmentId, '2026-06-01'),
    );

    expect(seen).toHaveLength(0);
  });

  it('scopes the set-based payroll read, which would otherwise fail silently', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, componentId, planId),
      );
    });

    const seen = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.recurring.overlappingPeriod(transaction, {
        employmentIds: [employmentId],
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      }),
    );

    expect(seen).toHaveLength(0);
  });

  it('scopes the reconciliation read', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentId, componentId, planId),
      );
    });

    const seen = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.recurring.recordedAfter(
        transaction,
        new Date('2020-01-01T00:00:00Z'),
        { from: '2020-01-01', to: '2030-12-31' },
        50,
      ),
    );

    expect(seen).toHaveLength(0);
  });

  it('scopes the overlap constraint, so one tenant cannot block another', async () => {
    const employmentA = await fixture.seedEmployment(TENANT_A);
    const employmentB = await fixture.seedEmployment(TENANT_B);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_A, employmentA, componentId, planId),
      );
    });

    // Tenant B writes the same shape of row over the same dates. The constraint carries `tenant_id`,
    // so this is not a conflict.
    await fixture.asTenant(TENANT_B, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_B);

      await fixture.stores.recurring.insert(
        transaction,
        aRecurring(TENANT_B, employmentB, componentId, planId),
      );

      const mine = await fixture.stores.recurring.forEmployment(transaction, employmentB);

      expect(mine).toHaveLength(1);
    });
  });

  it('hides an adjustment and its written reason', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const { componentId } = await configuredTenant(transaction, fixture.stores, TENANT_A);

      await fixture.stores.adjustments.insert(
        transaction,
        anAdjustment(TENANT_A, employmentId, componentId),
      );
    });

    const page = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.adjustments.search(transaction, { limit: 50, offset: 0 }),
    );

    expect(page.items).toHaveLength(0);
  });

  it('hides the configuration tables too', async () => {
    await fixture.asTenant(TENANT_A, async (transaction) => {
      await configuredTenant(transaction, fixture.stores, TENANT_A);
    });

    await fixture.asTenant(TENANT_B, async (transaction) => {
      expect(await fixture.stores.plans.all(transaction)).toHaveLength(0);
      expect(await fixture.stores.components.all(transaction)).toHaveLength(0);
      expect(await fixture.stores.grades.all(transaction)).toHaveLength(0);
    });
  });

  /**
   * The finding, recorded rather than papered over.
   *
   * PostgreSQL runs a referential integrity check as the *table owner* with row-level security
   * suspended, so a foreign key does not enforce the tenant: a compensation record in tenant B
   * referencing an employment in tenant A **is accepted by the database**. What stops it in
   * production is the application — the employment port reads as the current tenant, and an
   * employment it cannot see is an employment it refuses to price.
   *
   * Both halves are asserted here rather than one, because a test that claimed the foreign key
   * refused it would be asserting something false.
   */
  it('does not have its tenant enforced by the foreign key — and hides the row anyway', async () => {
    const employmentInA = await fixture.seedEmployment(TENANT_A);
    const recordId = await fixture.asTenant(TENANT_B, async (transaction) => {
      const { planId, componentId } = await configuredTenant(transaction, fixture.stores, TENANT_B);
      const record = aRecurring(TENANT_B, employmentInA, componentId, planId);

      // Accepted: the FK check runs with RLS suspended and finds the row in the other tenant.
      await fixture.stores.recurring.insert(transaction, record);
      return record.id;
    });

    // And invisible to the tenant whose employment it points at, which is what limits the damage.
    const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.recurring.byId(transaction, recordId),
    );

    expect(seenByA).toBeUndefined();
  });
});
