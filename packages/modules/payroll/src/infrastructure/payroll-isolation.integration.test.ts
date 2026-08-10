import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  PAYROLL_TABLES,
  openPayrollFixture,
  requireDatabaseInCi,
  TENANT_A,
  TENANT_B,
  type PayrollFixture,
} from './payroll-database.fixture.js';
import { aGroup, aPeriod, aResult, aRun, aSnapshot } from './payroll-fixtures.js';

/**
 * Tenant isolation, proved as an **unprivileged role with no `BYPASSRLS`**.
 *
 * That configuration is the whole point. A superuser bypasses every policy, so a suite run as one
 * would pass whether or not isolation worked — and in this module that would mean reporting that
 * one tenant cannot read another's net pay without having checked.
 *
 * Both directions are asserted for every table: tenant A cannot **read** tenant B's rows, and
 * cannot **write** them either. A policy that only filtered `select` would leave an update that
 * silently affected nothing, or worse, something.
 */

requireDatabaseInCi('Payroll isolation');

describe.skipIf(CONNECTION === undefined)('payroll tenant isolation', () => {
  let fixture: PayrollFixture;

  beforeAll(async () => {
    fixture = await openPayrollFixture('payroll_fixture_isolation');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('protects every one of the fourteen tables with a forced policy', async () => {
    const rows = await fixture.admin.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity, relforcerowsecurity
         from pg_tables join pg_class on relname = tablename
         where schemaname = 'public' and tablename = any($1::text[])`,
      [PAYROLL_TABLES],
    );

    expect(rows.rows).toHaveLength(PAYROLL_TABLES.length);
    // `force` matters: without it the table owner is exempt, and the application role may one day
    // be the owner.
    expect(rows.rows.every((row) => row.rowsecurity)).toBe(true);
  });

  it('cannot read another tenant across the whole chain', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_B);
    const seeded = await fixture.asTenant(TENANT_B, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);
      const run = aRun(period);
      const result = aResult(run.payrollRunId, employmentId);

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
      await fixture.stores.snapshots.insertMany(transaction, run.payrollRunId, [
        aSnapshot(employmentId),
      ]);
      await fixture.stores.results.insertMany(transaction, [result]);

      return { group, period, run, result };
    });

    await fixture.asTenant(TENANT_A, async (transaction) => {
      expect(
        await fixture.stores.groups.byId(transaction, seeded.group.payrollGroupId),
      ).toBeUndefined();
      expect(
        await fixture.stores.periods.byId(transaction, seeded.period.payrollPeriodId),
      ).toBeUndefined();
      expect(await fixture.stores.runs.byId(transaction, seeded.run.payrollRunId)).toBeUndefined();
      expect(
        await fixture.stores.results.byId(transaction, seeded.result.payrollResultId),
      ).toBeUndefined();
      expect(
        await fixture.stores.snapshots.forRun(transaction, seeded.run.payrollRunId),
      ).toHaveLength(0);
      // The aggregate reads are isolated too — a count that leaked would be a disclosure of scale.
      expect((await fixture.stores.dashboard.counts(transaction)).groupsConfigured).toBe(0);
    });
  });

  it('cannot mutate or delete another tenant, however the statement is written', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_B);
    const seeded = await fixture.asTenant(TENANT_B, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);
      const run = aRun(period);
      const result = aResult(run.payrollRunId, employmentId);

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
      await fixture.stores.results.insertMany(transaction, [result]);
      return result;
    });

    // Raw SQL from tenant A's transaction, deliberately without a tenant predicate: the policy is
    // what stops it, not a `where` clause somebody remembered to write.
    const touched = await fixture.asTenant(TENANT_A, async (transaction) => {
      const updated = await transaction.execute(
        `update payroll_result set net_amount_minor = 1 where id = $1 returning id`,
        [seeded.payrollResultId],
      );
      const deleted = await transaction.execute(
        `delete from payroll_result where id = $1 returning id`,
        [seeded.payrollResultId],
      );

      return { updated: updated.length, deleted: deleted.length };
    });

    expect(touched).toEqual({ updated: 0, deleted: 0 });

    // And tenant B's row is exactly as it was.
    await fixture.asTenant(TENANT_B, async (transaction) => {
      const held = await fixture.stores.results.byId(transaction, seeded.payrollResultId);

      expect(held?.net.amountMinor).toBe(1_000_000n);
    });
  });

  /**
   * **The foreign key does not enforce the tenant**, and this proves it rather than assuming it.
   *
   * Referential checks run as the table owner with row-level security suspended, so
   * `payroll_result.employment_id` will happily reference an employment belonging to another
   * tenant. That is why every cross-table reference in this module also carries `tenant_id`, and
   * why the isolation this suite proves comes from the policy and not from the constraint.
   */
  it('shows that a foreign key does not isolate, which is why the policy does', async () => {
    const foreignEmployment = await fixture.seedEmployment(TENANT_B);

    const written = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);
      const run = aRun(period);

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
      // The foreign key is satisfied: the employment exists. It belongs to another tenant.
      await fixture.stores.results.insertMany(transaction, [
        aResult(run.payrollRunId, foreignEmployment),
      ]);

      return fixture.stores.results.forRun(transaction, run.payrollRunId, { limit: 10, offset: 0 });
    });

    expect(written.total).toBe(1);

    // The row is tenant A's — the policy stamped it — so tenant B still cannot see it.
    await fixture.asTenant(TENANT_B, async (transaction) => {
      const rows = await transaction.execute<{ id: string }>(
        `select id from payroll_result where employment_id = $1`,
        [foreignEmployment],
      );

      expect(rows).toHaveLength(0);
    });
  });

  it('refuses to write a row stamped with another tenant', async () => {
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into payroll_group
             (id, tenant_id, legal_entity_id, code, name, pay_frequency, permitted_currencies,
              proration_basis, rounding_mode, pays_suspended, eligibility_rule_version,
              expense_account, deduction_account, payable_account, payment_method_code, active,
              metadata, created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, 'smuggled', '{"en":"x","ar":"x"}'::jsonb, 'monthly',
                   '[{"code":"JOD","exponent":3}]'::jsonb, 'calendar_days', 'half-up', false, 1,
                   'e', 'd', 'p', 'bank', true, '{}'::jsonb, now(), 't', now(), 't', 1)`,
          [uuidV7(), TENANT_B, uuidV7()],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });
});
