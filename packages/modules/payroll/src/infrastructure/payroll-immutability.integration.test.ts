import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  openPayrollFixture,
  requireDatabaseInCi,
  TENANT_A,
  type PayrollFixture,
} from './payroll-database.fixture.js';
import { aGroup, aPeriod, aResult, aRun, aSnapshot, jod } from './payroll-fixtures.js';

/**
 * **Finalized payroll cannot be mutated by any path** — the guarantee ADR-0066 exists for, checked
 * against the mechanism that actually provides it.
 *
 * The application predicate `where finalized_at is null` protects the code path that remembers to
 * write it. The trigger protects the *table*, which is what matters here: every attempt below goes
 * around the application entirely, and the last one is raw SQL in an authorized transaction — the
 * three-in-the-morning fix that a predicate would not have stopped.
 */

requireDatabaseInCi('Payroll immutability');

interface Frozen {
  readonly runId: string;
  readonly resultId: string;
  readonly employmentId: string;
}

describe.skipIf(CONNECTION === undefined)('finalized payroll immutability', () => {
  let fixture: PayrollFixture;

  beforeAll(async () => {
    fixture = await openPayrollFixture('payroll_fixture_immutability');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** A run with a result, a line and a snapshot — then finalized, which is what freezes them. */
  const finalized = async (): Promise<Frozen> => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    return fixture.asTenant(TENANT_A, async (transaction) => {
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
      await fixture.stores.earnings.insertMany(transaction, run.payrollRunId, [
        {
          resultId: result.payrollResultId,
          line: {
            earningLineId: result.payrollResultId,
            employmentId,
            sequence: 0,
            earningSource: 'compensation_recurring',
            componentCode: 'salary',
            payrollTreatmentCode: 'ordinary',
            amount: jod(1_000_000n),
            calculationReason: 'full_period',
            detail: { roundingMode: 'half-up' },
          },
        },
      ]);
      await fixture.stores.runs.finalize(transaction, run.payrollRunId, new Date());

      return { runId: run.payrollRunId, resultId: result.payrollResultId, employmentId };
    });
  };

  it('refuses an update of a finalized result, and names why', async () => {
    const frozen = await finalized();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update payroll_result set net_amount_minor = 1 where id = $1`, [
          frozen.resultId,
        ]),
      ),
    ).rejects.toThrow(/payroll_finalized_immutable/);
  });

  it('refuses a delete of a finalized result, which a delete-only guard would have missed', async () => {
    const frozen = await finalized();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`delete from payroll_result where id = $1`, [frozen.resultId]),
      ),
    ).rejects.toThrow(/payroll_finalized_immutable/);
  });

  it('refuses a soft delete, which is a disguised update', async () => {
    const frozen = await finalized();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update payroll_result set deleted_at = now() where id = $1`, [
          frozen.resultId,
        ]),
      ),
    ).rejects.toThrow(/payroll_finalized_immutable/);
  });

  it('refuses through the repository, which is the path that has the predicate', async () => {
    const frozen = await finalized();

    // `clearRun` carries `finalized_at is null`, so it affects no rows rather than raising — the
    // predicate and the trigger agree, and the result survives either way.
    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.results.clearRun(transaction, frozen.runId),
    );

    const survived = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.results.byId(transaction, frozen.resultId),
    );

    expect(survived?.net.amountMinor).toBe(1_000_000n);
  });

  it('refuses an update of a finalized earning line', async () => {
    const frozen = await finalized();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update payroll_earning_line set amount_minor = 1 where payroll_run_id = $1`,
          [frozen.runId],
        ),
      ),
    ).rejects.toThrow(/payroll_finalized_immutable/);
  });

  it('refuses an update of a finalized snapshot, so a historical explanation cannot be rewritten', async () => {
    const frozen = await finalized();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update payroll_input_snapshot set compensation_facts = '{}'::jsonb
             where payroll_run_id = $1`,
          [frozen.runId],
        ),
      ),
    ).rejects.toThrow(/payroll_finalized_immutable/);
  });

  /**
   * **The path a predicate cannot cover.**
   *
   * Raw SQL, in an authorized transaction, with no reference to any repository — the shape of an
   * ad-hoc fix run to unblock a payroll. The trigger reads the old row and refuses; nothing in the
   * application was consulted.
   */
  it('refuses raw SQL in an authorized transaction, with no application code in the path', async () => {
    await finalized();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update payroll_result
             set gross_amount_minor = gross_amount_minor + 1,
                 net_amount_minor = net_amount_minor + 1
             where tenant_id = $1`,
          [TENANT_A],
        ),
      ),
    ).rejects.toThrow(/payroll_finalized_immutable/);
  });

  it('leaves a non-finalized row freely writable, so the guard is the state and not the table', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    const rewritten = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);
      const run = aRun(period);
      const result = aResult(run.payrollRunId, employmentId);

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
      await fixture.stores.results.insertMany(transaction, [result]);
      // Not finalized: a recalculation may replace it, which is exactly what this permits.
      await fixture.stores.results.clearRun(transaction, run.payrollRunId);

      return fixture.stores.results.forRun(transaction, run.payrollRunId, { limit: 10, offset: 0 });
    });

    expect(rewritten.total).toBe(0);
  });
});
