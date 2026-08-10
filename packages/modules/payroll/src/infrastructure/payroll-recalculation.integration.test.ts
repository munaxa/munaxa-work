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
 * **Recalculation replaces; it never accumulates.**
 *
 * This suite exists because it did accumulate. `clearRun` was implemented on every store and called
 * by nothing, so a second calculation into the same run inserted a second set of rows. In memory
 * that produced one employment holding two results; against real PostgreSQL it would have violated
 * `payroll_result_unique_idx` partway through a batch, leaving the run in `calculating` with a
 * committed prefix and no way forward. The API suite found it, and these are the assertions that
 * hold the fix down against real SQL rather than against a fake.
 *
 * Two properties matter and they pull in opposite directions. A recalculated employment must end
 * with exactly one result — and an employment that did **not** go stale must be untouched (D-14),
 * because reconciliation names a narrow population and recomputing the rest would move figures
 * nobody asked to move.
 */

requireDatabaseInCi('Payroll recalculation');

describe.skipIf(CONNECTION === undefined)('payroll recalculation', () => {
  let fixture: PayrollFixture;

  beforeAll(async () => {
    fixture = await openPayrollFixture('payroll_fixture_recalculation');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** A run with one result and one snapshot per employment. */
  const seeded = async (): Promise<{
    runId: string;
    stale: string;
    untouched: string;
  }> => {
    const stale = await fixture.seedEmployment(TENANT_A);
    const untouched = await fixture.seedEmployment(TENANT_A);
    const group = aGroup();
    const period = aPeriod(group.payrollGroupId);
    const run = aRun(period);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.periods.insert(transaction, period);
      await fixture.stores.runs.insert(transaction, run);
      await fixture.stores.snapshots.insertMany(transaction, run.payrollRunId, [
        aSnapshot(stale),
        aSnapshot(untouched),
      ]);
      await fixture.stores.results.insertMany(transaction, [
        aResult(run.payrollRunId, stale, { gross: jod(1_000_000n), net: jod(1_000_000n) }),
        aResult(run.payrollRunId, untouched, { gross: jod(2_000_000n), net: jod(2_000_000n) }),
      ]);
    });

    return { runId: run.payrollRunId, stale, untouched };
  };

  it('refuses a second result for one employment, which is what forces the clear', async () => {
    const { runId, stale } = await seeded();

    // Without a clear step this is what a recalculation does. `payroll_result_unique_idx` is the
    // reason the missing call was a hard failure in production rather than a quiet duplicate.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.results.insertMany(transaction, [aResult(runId, stale)]),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('replaces the named employment and leaves every other one alone', async () => {
    const { runId, stale, untouched } = await seeded();

    const [replaced, spared] = await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.earnings.clearEmployments(transaction, runId, [stale]);
      await fixture.stores.deductions.clearEmployments(transaction, runId, [stale]);
      await fixture.stores.results.clearEmployments(transaction, runId, [stale]);
      await fixture.stores.exceptions.clearEmployments(transaction, runId, [stale]);
      await fixture.stores.snapshots.clearEmployments(transaction, runId, [stale]);

      // The recalculated figure, which differs from the one it replaces.
      await fixture.stores.snapshots.insertMany(transaction, runId, [aSnapshot(stale)]);
      await fixture.stores.results.insertMany(transaction, [
        aResult(runId, stale, { gross: jod(1_500_000n), net: jod(1_500_000n) }),
      ]);

      return Promise.all([
        fixture.stores.results.forEmployment(transaction, runId, stale),
        fixture.stores.results.forEmployment(transaction, runId, untouched),
      ]);
    });

    // Exactly one result, carrying the new figure rather than sitting beside the old one.
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.gross.amountMinor).toBe(1_500_000n);
    // And the employment nobody recalculated is exactly as it was.
    expect(spared).toHaveLength(1);
    expect(spared[0]?.gross.amountMinor).toBe(2_000_000n);
  });

  it('replaces the snapshot too, so the inputs still explain the result', async () => {
    const { runId, stale, untouched } = await seeded();

    const held = await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.results.clearEmployments(transaction, runId, [stale]);
      await fixture.stores.snapshots.clearEmployments(transaction, runId, [stale]);
      await fixture.stores.snapshots.insertMany(transaction, runId, [aSnapshot(stale)]);
      await fixture.stores.results.insertMany(transaction, [aResult(runId, stale)]);

      return fixture.stores.snapshots.forRun(transaction, runId);
    });

    // One snapshot per employment, still. A stale snapshot beside a fresh result would break the
    // reproducibility argument: replaying the snapshot would no longer yield the stored figure.
    expect(held).toHaveLength(2);
    expect(held.filter((snapshot) => snapshot.employmentId === stale)).toHaveLength(1);
    expect(held.filter((snapshot) => snapshot.employmentId === untouched)).toHaveLength(1);
  });

  it('does nothing at all when the employment list is empty', async () => {
    const { runId } = await seeded();

    const remaining = await fixture.asTenant(TENANT_A, async (transaction) => {
      // A batch may legitimately compute nothing. An empty `any('{}')` must not become a clause
      // that matches every row in the run.
      await fixture.stores.results.clearEmployments(transaction, runId, []);
      await fixture.stores.snapshots.clearEmployments(transaction, runId, []);

      return fixture.stores.results.forRun(transaction, runId, { limit: 10, offset: 0 });
    });

    expect(remaining.total).toBe(2);
  });

  it('cannot clear a finalized run, by the table rather than by the caller', async () => {
    const { runId, stale } = await seeded();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.runs.finalize(transaction, runId, new Date('2026-07-05T00:00:00Z')),
    );

    const surviving = await fixture.asTenant(TENANT_A, async (transaction) => {
      // `finalized_at is null` means this matches nothing rather than raising — and the trigger
      // refuses the same delete if the predicate were ever dropped (ADR-0066).
      await fixture.stores.results.clearEmployments(transaction, runId, [stale]);
      return fixture.stores.results.forEmployment(transaction, runId, stale);
    });

    expect(surviving).toHaveLength(1);
    expect(surviving[0]?.gross.amountMinor).toBe(1_000_000n);
  });
});
