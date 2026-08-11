import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  openPayrollFixture,
  requireDatabaseInCi,
  TENANT_A,
  type PayrollFixture,
} from './payroll-database.fixture.js';
import { aGroup, aPeriod, aResult, aRun } from './payroll-fixtures.js';

/**
 * Concurrency, settled by the **database** and proved with two real connections.
 *
 * Every race here has the same shape: both callers read before either wrote, so no amount of
 * application validation can settle it. Only a constraint can, and only a suite with two genuine
 * transactions can show that it does — two promises against one in-memory map prove nothing about
 * PostgreSQL.
 *
 * The expected outcome is **deterministic in kind, not in identity**: exactly one attempt commits
 * and the other is refused with a named SQLSTATE. Which one wins is the database's business.
 */

requireDatabaseInCi('Payroll concurrency');

/** Both halves run to completion so the *pair* of outcomes can be asserted, not just the first. */
const settled = async <TResult>(
  first: Promise<TResult>,
  second: Promise<TResult>,
): Promise<readonly PromiseSettledResult<TResult>[]> => Promise.allSettled([first, second]);

const failures = (results: readonly PromiseSettledResult<unknown>[]): readonly string[] =>
  results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => String(result.reason));

describe.skipIf(CONNECTION === undefined)('payroll concurrency', () => {
  let fixture: PayrollFixture;

  beforeAll(async () => {
    fixture = await openPayrollFixture('payroll_fixture_concurrency');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('lets exactly one of two overlapping periods commit', async () => {
    const group = aGroup();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.groups.insert(transaction, group),
    );

    // June and mid-June-to-mid-July, created at the same moment against the same group. Both read
    // before either wrote, so the GiST exclusion is the only thing that can settle it.
    const results = await settled(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.periods.insert(transaction, aPeriod(group.payrollGroupId)),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.periods.insert(
          transaction,
          aPeriod(group.payrollGroupId, { periodStart: '2026-06-15', periodEnd: '2026-07-15' }),
        ),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(failures(results)[0]).toMatch(/payroll_period_overlap|exclusion/i);
  });

  it('permits two adjacent periods, so the constraint refuses overlap rather than proximity', async () => {
    const group = aGroup();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.groups.insert(transaction, group),
    );

    const results = await settled(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.periods.insert(transaction, aPeriod(group.payrollGroupId)),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.periods.insert(
          transaction,
          aPeriod(group.payrollGroupId, { periodStart: '2026-07-01', periodEnd: '2026-07-31' }),
        ),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
  });

  it('lets exactly one of two concurrent runs for a period commit', async () => {
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
    });

    // `payroll_run_active_idx` permits one non-terminal run per period. Without it a period forks
    // into two payrolls, and both look correct.
    const results = await settled(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.runs.insert(transaction, aRun(period, { runSequence: 1 })),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.runs.insert(transaction, aRun(period, { runSequence: 2 })),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(failures(results)[0]).toMatch(/payroll_run_active_idx|duplicate key/i);
  });

  it('lets exactly one of two calculations write a result for the same employment', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);
    const run = aRun(period);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
    });

    // The idempotency key: (tenant, run, employment, currency). A retried calculation finds the
    // existing row or loses the race; it never writes a second one.
    const results = await settled(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.results.insertMany(transaction, [aResult(run.payrollRunId, employmentId)]),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.results.insertMany(transaction, [aResult(run.payrollRunId, employmentId)]),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(failures(results)[0]).toMatch(/payroll_result_unique_idx|duplicate key/i);
  });

  it('lets exactly one of two snapshot writes for the same employment commit', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);
    const run = aRun(period);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
    });

    const results = await settled(
      snapshotWrite(fixture, run.payrollRunId, employmentId),
      snapshotWrite(fixture, run.payrollRunId, employmentId),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('lets exactly one of two finalizations of the same run commit', async () => {
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);
    const run = aRun(period);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
    });

    // Optimistic concurrency on the run: both read version 1, one writes it, the other is refused.
    const results = await settled(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.runs.update(
          transaction,
          { ...run, status: 'finalized', finalizedAt: new Date(), finalizedBy: 'user:a' },
          1,
        ),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.runs.update(
          transaction,
          { ...run, status: 'finalized', finalizedAt: new Date(), finalizedBy: 'user:b' },
          1,
        ),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(failures(results)[0]).toMatch(/concurren/i);
  });

  it('lets exactly one of two approval decisions take a sequence number', async () => {
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);
    const run = aRun(period);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
    });

    const decision = (decidedBy: string) => ({
      approvalDecisionId: uuidV7(),
      payrollRunId: run.payrollRunId,
      sequence: 1,
      decision: 'approved' as const,
      decidedBy,
      decidedAt: new Date(),
      requestedBy: 'user:calculator',
    });
    const results = await settled(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.decisions.insert(transaction, decision('user:a')),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.decisions.insert(transaction, decision('user:b')),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('refuses a self-approval at the database, not only in the domain', async () => {
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);
    const run = aRun(period);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
    });

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.decisions.insert(transaction, {
          approvalDecisionId: uuidV7(),
          payrollRunId: run.payrollRunId,
          sequence: 1,
          decision: 'approved',
          decidedBy: 'user:same',
          decidedAt: new Date(),
          requestedBy: 'user:same',
        }),
      ),
    ).rejects.toThrow(/self_approval|check constraint/i);
  });

  it('lets exactly one of two reversals of the same run commit', async () => {
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);
    const original = aRun(period, { status: 'finalized' });

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, original);
    });

    const reversal = (sequence: number) =>
      aRun(period, {
        runSequence: sequence,
        runKind: 'reversal',
        status: 'draft',
        reversalOfRunId: original.payrollRunId,
      });
    const results = await settled(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.runs.insert(transaction, reversal(2)),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.runs.insert(transaction, reversal(3)),
      ),
    );

    // `payroll_run_reversal_idx`: one reversal per original, so a double-reversal race cannot
    // produce two contra sets.
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });

  it('lets exactly one of two identical adjustment requests through', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);
    const run = aRun(period);
    const adjustmentId = uuidV7();

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
    });

    const adjustment = {
      payrollAdjustmentId: adjustmentId,
      payrollRunId: run.payrollRunId,
      employmentId,
      kind: 'earning' as const,
      code: 'late-bonus',
      payrollTreatmentCode: 'ordinary',
      amount: { amountMinor: 1_000n, currencyCode: 'JOD', currencyExponent: 3 },
      reasonCode: 'agreed',
      note: 'Agreed with the manager.',
      requestedBy: 'user:a',
      recordedAt: new Date(),
      version: 1,
    };
    const results = await settled(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.adjustments.insert(transaction, adjustment),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.adjustments.insert(transaction, adjustment),
      ),
    );

    // The primary key is the idempotency key: a retried request writes once.
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
});

const snapshotWrite = (
  fixture: PayrollFixture,
  runId: string,
  employmentId: string,
): Promise<void> =>
  fixture.asTenant(TENANT_A, (transaction) =>
    fixture.stores.snapshots.insertMany(transaction, runId, [
      {
        employmentId,
        employment: {
          employmentId,
          status: 'active',
          startDate: '2020-01-01',
          employmentTypeCode: 'full-time',
          version: 1,
        },
        capturedAt: new Date(),
      },
    ]),
  );
