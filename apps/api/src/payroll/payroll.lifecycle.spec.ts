import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { ADMIN, APPROVER, configured, jod, resultsOf } from './cross-module-scenarios.js';
import { ask, send, trySend, wire } from './cross-module-harness.js';

/**
 * **The mandatory scenario**, end to end on one dispatcher with the production adapters.
 *
 * Calculate, lose the event, change a source, reconcile, go stale, refuse approval, recalculate,
 * approve as a named human, finalize, and then find every mutation path closed — through the
 * application service, through an adjustment, through reconciliation, and through the repository.
 */
describe('the lost-event scenario', () => {
  it('detects a source change without an event, and preserves the original result', async () => {
    const wired = wire();

    await wired.as(ADMIN, async () => {
      const ready = await configured(wired);
      const run = await send<{ payrollRunId: string }>(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      });
      const before = await resultsOf(wired, run.payrollRunId);

      expect(before.items[0]?.gross.amountMinor).toBe('1000000');

      // **The source moves and nothing is delivered.** Attendance re-freezes the period — a real
      // event in production — and no subscriber exists here at all: this module registers no event
      // handlers, so there is nothing that could have been told.
      const attendance = wired.attendance.get(ready.employmentId);

      if (attendance !== undefined) {
        attendance.sequence = 2;
        attendance.inputsDigest = 'att00002';
      }

      const reconciled = await send<{
        status: string;
        staleEmployments: readonly string[];
      }>(wired, { commandName: 'payroll.reconcile', payrollRunId: run.payrollRunId });

      // Found by asking, not by being told.
      expect(reconciled.status).toBe('stale');
      expect(reconciled.staleEmployments).toContain(ready.employmentId);

      const found = await ask<{ items: readonly { readonly staleSource: string }[] }>(wired, {
        queryName: 'payroll.reconciliation',
        payrollRunId: run.payrollRunId,
      });

      expect(found.items[0]?.staleSource).toBe('attendance');

      // **The original result is untouched.** Reconciliation records what it found and repairs
      // nothing; a system that silently corrected a payroll would change what somebody was paid
      // without anybody deciding to.
      const after = await resultsOf(wired, run.payrollRunId);

      expect(after.items[0]?.gross.amountMinor).toBe(before.items[0]?.gross.amountMinor);
      expect(after.items[0]?.payrollResultId).toBe(before.items[0]?.payrollResultId);
    });
  });

  it('refuses to approve or finalize a stale run', async () => {
    const wired = wire();
    const ready = await wired.as(ADMIN, () => configured(wired));
    const run = await wired.as(ADMIN, () =>
      send<{ payrollRunId: string }>(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      }),
    );
    const attendance = wired.attendance.get(ready.employmentId);

    if (attendance !== undefined) attendance.inputsDigest = 'att00003';

    await wired.as(ADMIN, () =>
      send(wired, { commandName: 'payroll.reconcile', payrollRunId: run.payrollRunId }),
    );

    const approval = await wired.as(APPROVER, () =>
      trySend(wired, { commandName: 'payroll.approve', payrollRunId: run.payrollRunId }),
    );
    const finalization = await wired.as(ADMIN, () =>
      trySend(wired, { commandName: 'payroll.finalize', payrollRunId: run.payrollRunId }),
    );

    expect(approval.ok).toBe(false);
    expect(finalization.ok).toBe(false);
  });

  it('approves as a named human, finalizes, and then refuses every mutation path', async () => {
    const wired = wire();
    const ready = await wired.as(ADMIN, () => configured(wired));
    const run = await wired.as(ADMIN, () =>
      send<{ payrollRunId: string }>(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      }),
    );

    // The administrator calculated it, so the administrator cannot approve it — `decided_by` comes
    // from the authenticated context and `requested_by` is on the decision row.
    const selfApproval = await wired.as(ADMIN, () =>
      trySend(wired, { commandName: 'payroll.approve', payrollRunId: run.payrollRunId }),
    );

    expect(selfApproval.ok).toBe(false);

    await wired.as(APPROVER, () =>
      send(wired, { commandName: 'payroll.approve', payrollRunId: run.payrollRunId }),
    );

    const chain = await wired.as(ADMIN, () =>
      ask<{ readonly steps: readonly { readonly decidedBy: string }[] }>(wired, {
        queryName: 'payroll.approval-chain',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(chain.steps[0]?.decidedBy).toBe(APPROVER);
    expect(JSON.stringify(chain)).not.toContain('system:auto-approval');

    const finalized = await wired.as(ADMIN, () =>
      send<{ accountingLines: number; paymentInstructions: number }>(wired, {
        commandName: 'payroll.finalize',
        payrollRunId: run.payrollRunId,
      }),
    );

    // Gross debited to expense, net credited to payable. Balanced by construction.
    expect(finalized.accountingLines).toBe(2);
    expect(finalized.paymentInstructions).toBe(1);

    const outputs = await wired.as(ADMIN, () =>
      ask<{ items: readonly { readonly direction: string }[] }>(wired, {
        queryName: 'payroll.accounting-output',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(outputs.items.filter((line) => line.direction === 'debit')).toHaveLength(1);
    expect(outputs.items.filter((line) => line.direction === 'credit')).toHaveLength(1);
    // Prepared, and nothing further. No `posted`, no `executed`.
    expect(JSON.stringify(outputs)).not.toMatch(/posted|executed/i);

    // Every mutation path, refused.
    const adjustment = await wired.as(ADMIN, () =>
      trySend(wired, {
        commandName: 'payroll.record-adjustment',
        payrollRunId: run.payrollRunId,
        employmentId: ready.employmentId,
        kind: 'earning',
        code: 'late-bonus',
        payrollTreatmentCode: 'ordinary',
        amount: jod('1000'),
        reasonCode: 'correction',
        note: 'Agreed after the run closed.',
      }),
    );
    const reconciliation = await wired.as(ADMIN, () =>
      trySend(wired, { commandName: 'payroll.reconcile', payrollRunId: run.payrollRunId }),
    );
    const recalculation = await wired.as(ADMIN, () =>
      trySend(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(adjustment.ok).toBe(false);
    expect(reconciliation.ok).toBe(false);
    // This one found a real hole: `payroll.calculate` checked the *period's* status and not the
    // run's, so naming a finalized run would have re-entered the batch loop against frozen rows.
    // The trigger would have refused the writes, but only after a partial batch had failed.
    expect(recalculation.ok).toBe(false);
  });

  it('reverses into new state and leaves the finalized result intact', async () => {
    const wired = wire();
    const ready = await wired.as(ADMIN, () => configured(wired));
    const run = await wired.as(ADMIN, () =>
      send<{ payrollRunId: string }>(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      }),
    );

    await wired.as(APPROVER, () =>
      send(wired, { commandName: 'payroll.approve', payrollRunId: run.payrollRunId }),
    );
    await wired.as(ADMIN, () =>
      send(wired, { commandName: 'payroll.finalize', payrollRunId: run.payrollRunId }),
    );

    const reversal = await wired.as(ADMIN, () =>
      send<{ reversalRunId: string }>(wired, {
        commandName: 'payroll.reverse-run',
        payrollRunId: run.payrollRunId,
        reasonCode: 'incorrect-input',
      }),
    );

    expect(reversal.reversalRunId).not.toBe(run.payrollRunId);

    // The original run's results are exactly as finalized: a reversal is new state, not an edit.
    const original = await wired.as(ADMIN, () => resultsOf(wired, run.payrollRunId));

    expect(original.items[0]?.gross.amountMinor).toBe('1000000');
    expect(original.items[0]?.finalized).toBe(true);

    const reversed = await wired.as(ADMIN, () =>
      ask<{ readonly status: string; readonly reversalOfRunId?: string }>(wired, {
        queryName: 'payroll.run',
        payrollRunId: reversal.reversalRunId,
      }),
    );

    expect(reversed.reversalOfRunId).toBe(run.payrollRunId);
  });
});
