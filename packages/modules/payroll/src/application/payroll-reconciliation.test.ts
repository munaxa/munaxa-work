import { describe, expect, it } from 'vitest';

import {
  ADMIN,
  APPROVER,
  calculated,
  compensationFacts,
  configured,
  employmentFacts,
} from './payroll-scenarios.js';
import { ask, attempt, send } from './payroll-test-harness.js';
import type {
  PayrollReconciliationView,
  PayrollResultView,
  PayrollRunView,
} from '../contracts/views.js';

interface RunPage {
  readonly items: readonly PayrollRunView[];
}

/**
 * **The proof that Payroll does not depend on the event system**, and the boundary at the end of a
 * run.
 *
 * A source moves and no event is raised — the dispatch is at-most-once with no outbox, so a payroll
 * that noticed changes by being told would be wrong the first time a process restarted. Every
 * assertion here is about a change found by *asking* (ADR-0064), and about what finalization makes
 * impossible afterwards.
 */

describe('reconciliation and finalization', () => {
  it('finds a source change by asking, marks the run stale, and leaves the result unchanged', async () => {
    const configuration = await configured();
    const run = await calculated(configuration);
    const before = await resultsOf(configuration, run.payrollRunId);

    // The source moves. **No event is raised and none would be delivered** — the dispatch is
    // at-most-once with no outbox, so correctness cannot depend on one (ADR-0064).
    configuration.harness.compensation.set(
      configuration.employmentId,
      compensationFacts({ inputsDigest: 'aaaa9999' }),
    );

    const reconciled = await configuration.harness.as(ADMIN, () =>
      send<{ status: string; staleEmployments: readonly string[] }>(configuration.harness, {
        commandName: 'payroll.reconcile',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(reconciled.status).toBe('stale');
    expect(reconciled.staleEmployments).toContain(configuration.employmentId);

    const found = await configuration.harness.as(ADMIN, () =>
      ask<{ items: readonly PayrollReconciliationView[] }>(configuration.harness, {
        queryName: 'payroll.reconciliation',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(found.items[0]?.staleSource).toBe('compensation');

    // **The previous result is untouched.** Reconciliation records what it found and repairs
    // nothing; a system that silently corrected a payroll would change what somebody was paid
    // without anybody deciding to.
    const after = await resultsOf(configuration, run.payrollRunId);

    expect(after[0]?.gross.amountMinor).toBe(before[0]?.gross.amountMinor);
    expect(after[0]?.net.amountMinor).toBe(before[0]?.net.amountMinor);
  });

  it('cannot approve a stale run, which is the whole point of detecting staleness', async () => {
    const configuration = await configured();
    const run = await calculated(configuration);

    configuration.harness.compensation.set(
      configuration.employmentId,
      compensationFacts({ inputsDigest: 'aaaa9999' }),
    );
    await configuration.harness.as(ADMIN, () =>
      send(configuration.harness, {
        commandName: 'payroll.reconcile',
        payrollRunId: run.payrollRunId,
      }),
    );

    const refused = await configuration.harness.as(APPROVER, () =>
      attempt(configuration.harness, {
        commandName: 'payroll.approve',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('finalizes, generates balanced outputs, and refuses every later change', async () => {
    const configuration = await configured();
    const run = await calculated(configuration);

    await configuration.harness.as(APPROVER, () =>
      send(configuration.harness, {
        commandName: 'payroll.approve',
        payrollRunId: run.payrollRunId,
      }),
    );

    const finalized = await configuration.harness.as(ADMIN, () =>
      send<{ accountingLines: number; paymentInstructions: number }>(configuration.harness, {
        commandName: 'payroll.finalize',
        payrollRunId: run.payrollRunId,
      }),
    );

    // Gross debited to expense, net credited to payable. Deductions were zero, so no third line.
    expect(finalized.accountingLines).toBe(2);
    expect(finalized.paymentInstructions).toBe(1);

    const view = await configuration.harness.as(ADMIN, () =>
      ask<PayrollRunView>(configuration.harness, {
        queryName: 'payroll.run',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(view.status).toBe('finalized');
    // Prepared, and nothing further. There is no `posted` and no `executed`.
    expect(view.accountingPreparedAt).toBeDefined();
    expect(JSON.stringify(view)).not.toMatch(/posted|executed/i);

    // An adjustment to a finalized run is refused: the remedy is a correction run.
    const refused = await configuration.harness.as(ADMIN, () =>
      attempt(configuration.harness, {
        commandName: 'payroll.record-adjustment',
        payrollRunId: run.payrollRunId,
        employmentId: configuration.employmentId,
        kind: 'earning',
        code: 'late-bonus',
        payrollTreatmentCode: 'ordinary',
        amount: { amountMinor: '1000', currencyCode: 'JOD', currencyExponent: 3 },
        reasonCode: 'correction',
        note: 'Agreed after the run closed.',
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('refuses to reconcile a finalized run at all', async () => {
    const configuration = await configured();
    const run = await calculated(configuration);

    await configuration.harness.as(APPROVER, () =>
      send(configuration.harness, {
        commandName: 'payroll.approve',
        payrollRunId: run.payrollRunId,
      }),
    );
    await configuration.harness.as(ADMIN, () =>
      send(configuration.harness, {
        commandName: 'payroll.finalize',
        payrollRunId: run.payrollRunId,
      }),
    );

    const refused = await configuration.harness.as(ADMIN, () =>
      attempt(configuration.harness, {
        commandName: 'payroll.reconcile',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(refused.ok).toBe(false);
  });
});

describe('population', () => {
  it('covers a workforce larger than one batch, resuming by cursor', async () => {
    const configuration = await configured({ employments: 12 });
    const run = await calculated(configuration);

    expect(run.resultCount).toBe(12);

    const runs = await configuration.harness.as(ADMIN, () =>
      ask<RunPage>(configuration.harness, { queryName: 'payroll.runs' }),
    );

    expect(runs.items[0]?.populationSize).toBe(12);
    expect(runs.items[0]?.complete).toBe(true);
  });

  it('excludes a suspended employment unless the group says otherwise', async () => {
    const suspended = await configured();

    suspended.harness.employment.set(
      suspended.employmentId,
      employmentFacts(suspended.employmentId, { status: 'suspended' }),
    );

    const run = await calculated(suspended);

    expect(run.resultCount).toBe(0);

    const paying = await configured({ paysSuspended: true });

    paying.harness.employment.set(
      paying.employmentId,
      employmentFacts(paying.employmentId, { status: 'suspended' }),
    );

    expect((await calculated(paying)).resultCount).toBe(1);
  });
});

const resultsOf = async (
  configuration: Awaited<ReturnType<typeof configured>>,
  payrollRunId: string,
): Promise<readonly PayrollResultView[]> => {
  const page = await configuration.harness.as(ADMIN, () =>
    ask<{ items: readonly PayrollResultView[] }>(configuration.harness, {
      queryName: 'payroll.results',
      payrollRunId,
    }),
  );

  return page.items;
};
