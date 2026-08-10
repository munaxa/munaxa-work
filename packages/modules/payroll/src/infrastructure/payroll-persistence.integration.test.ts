import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  openPayrollFixture,
  requireDatabaseInCi,
  TENANT_A,
  type PayrollFixture,
} from './payroll-database.fixture.js';
import {
  aDeductionDefinition,
  aGroup,
  aPeriod,
  aResult,
  aRun,
  aSnapshot,
  jod,
} from './payroll-fixtures.js';

/**
 * Persistence against real PostgreSQL: the round trips that only a real database can prove.
 *
 * The assertion this suite exists for is the **exactness** one. A `bigint` amount above 2^53
 * survives the whole path — repository, driver, column, driver, mapper, domain — because nothing on
 * it calls `Number`. In-memory tests cannot show that, because in memory the value never leaves the
 * process.
 */

requireDatabaseInCi('Payroll persistence');

describe.skipIf(CONNECTION === undefined)('payroll persistence', () => {
  let fixture: PayrollFixture;

  beforeAll(async () => {
    fixture = await openPayrollFixture('payroll_fixture_persistence');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('keeps a monetary amount exact above 2^53, all the way to the column and back', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    // 9,007,199,254,740,993 — one past the largest integer a double can represent.
    const enormous = 9_007_199_254_740_993n;

    const read = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);
      const run = aRun(period);
      const result = aResult(run.payrollRunId, employmentId, {
        gross: jod(enormous),
        totalDeductions: jod(1n),
        net: jod(enormous - 1n),
      });

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
      await fixture.stores.results.insertMany(transaction, [result]);

      return fixture.stores.results.byId(transaction, result.payrollResultId);
    });

    expect(read?.gross.amountMinor).toBe(enormous);
    expect(read?.net.amountMinor).toBe(enormous - 1n);
    // The proof that it never became a double: 2^53 + 1 as a Number is 2^53, and this is not that.
    expect(read?.gross.amountMinor).not.toBe(BigInt(Number(enormous)));
    expect(read?.currencyExponent).toBe(3);
  });

  it('round-trips a group, its rule version and its currency exponents', async () => {
    const read = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup({
        permittedCurrencies: ['JOD', 'USD'],
        currencyExponents: { JOD: 3, USD: 2 },
      });

      await fixture.stores.groups.insert(transaction, group);
      return fixture.stores.groups.byId(transaction, group.payrollGroupId);
    });

    expect(read?.permittedCurrencies).toEqual(['JOD', 'USD']);
    // Three decimal places for JOD, two for USD. A single assumed exponent is wrong for one of them.
    expect(read?.currencyExponents).toEqual({ JOD: 3, USD: 2 });
    expect(read?.eligibilityRuleVersion).toBe(1);
  });

  it('round-trips a period as civil dates, unshifted by the process time zone', async () => {
    const read = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      return fixture.stores.periods.byId(transaction, period.payrollPeriodId);
    });

    // Read as text, so a server west of UTC does not move June to the thirty-first of May.
    expect(read?.periodStart).toBe('2026-06-01');
    expect(read?.periodEnd).toBe('2026-06-30');
    expect(read?.paymentDate).toBe('2026-07-05');
  });

  it('stores the snapshot verbatim, with amounts exact through jsonb', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const enormous = 9_007_199_254_740_993n;

    const read = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);
      const run = aRun(period);
      const snapshot = aSnapshot(employmentId);
      const block = snapshot.compensation?.currencies[0];
      const component = block?.recurring[0];

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
      await fixture.stores.snapshots.insertMany(transaction, run.payrollRunId, [
        {
          ...snapshot,
          compensation: {
            ...snapshot.compensation!,
            currencies: [{ ...block!, recurring: [{ ...component!, amount: jod(enormous) }] }],
          },
        },
      ]);

      return fixture.stores.snapshots.forEmployment(transaction, run.payrollRunId, employmentId);
    });

    // `bigint` has no JSON representation, so the payload holds a decimal string and the mapper
    // parses it with BigInt. Anything else loses the last digit.
    expect(read?.compensation?.currencies[0]?.recurring[0]?.amount.amountMinor).toBe(enormous);
    expect(read?.employment?.status).toBe('active');
    expect(read?.compensation?.inputsDigest).toBe('cccc0001');
  });

  it('reads snapshot digests without loading the payloads', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    const digests = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);
      const run = aRun(period);

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
      await fixture.stores.snapshots.insertMany(transaction, run.payrollRunId, [
        aSnapshot(employmentId),
      ]);

      return fixture.stores.snapshots.digestsFor(transaction, run.payrollRunId);
    });

    expect(digests.get(employmentId)?.compensationDigest).toBe('cccc0001');
    expect(digests.get(employmentId)?.employmentVersion).toBe(4);
  });

  it('round-trips a deduction definition with its fixed amount and priority', async () => {
    const read = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup();
      const definition = aDeductionDefinition(group.payrollGroupId);

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.deductionDefinitions.insert(transaction, definition);
      return fixture.stores.deductionDefinitions.forGroup(transaction, group.payrollGroupId);
    });

    expect(read[0]?.fixedAmount?.amountMinor).toBe(5_000n);
    expect(read[0]?.priority).toBe(50);
    expect(read[0]?.deductionSource).toBe('voluntary');
  });

  it('counts the dashboard in one statement, including the numbers that reveal a failure', async () => {
    const counts = await fixture.asTenant(TENANT_A, async (transaction) => {
      const group = aGroup();
      const period = aPeriod(group.payrollGroupId);

      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, aRun(period, { status: 'stale' }));

      return fixture.stores.dashboard.counts(transaction);
    });

    expect(counts.openPeriods).toBe(1);
    expect(counts.staleRuns).toBe(1);
    expect(counts.groupsConfigured).toBe(1);
  });
});
