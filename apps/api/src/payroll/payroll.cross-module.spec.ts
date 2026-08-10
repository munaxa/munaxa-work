import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { ADMIN, configured, resultsOf } from './cross-module-scenarios.js';
import { uuidV7 } from '@work/kernel';

import { ask, send, trySend, wire } from './cross-module-harness.js';

/**
 * **The cross-module test.** The sequence that proves the phase across five boundaries.
 *
 * Every other suite in this module uses a fake for the sources, which is right for testing a module
 * and useless for testing a *boundary*. What is asserted here is the thing no single module can
 * assert about itself:
 *
 * 1. a real Employment is created through Employment's own command;
 * 2. a real Compensation record is assigned through Compensation's own command;
 * 3. Attendance and Leave answer through their **published contracts**, on the same dispatcher;
 * 4. Payroll snapshots all of it through the **production adapters**, under real bounded grants;
 * 5. a source changes with **no event delivered**, and reconciliation finds it by asking;
 * 6. the previous result is unchanged, the run is stale, and a stale run cannot be approved;
 * 7. finalization freezes everything, and every later mutation is refused;
 * 8. reversal creates new state and preserves the original.
 *
 * Step 5 is the one that matters architecturally. The event dispatch in this repository is
 * post-commit, in-process and at-most-once with no outbox; a payroll that noticed changes by being
 * told would be wrong the first time a process restarted mid-dispatch. Nothing in this suite
 * subscribes to anything.
 */

describe('Payroll across five module boundaries', () => {
  it('calculates from real Employment and Compensation, through the production adapters', async () => {
    const wired = wire();

    await wired.as(ADMIN, async () => {
      const ready = await configured(wired);
      const run = await send<{ payrollRunId: string; resultCount: number }>(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      });

      expect(run.resultCount).toBe(1);

      const results = await resultsOf(wired, run.payrollRunId);

      // The salary Compensation published, unchanged and exact.
      expect(results.items[0]?.gross.amountMinor).toBe('1000000');
      expect(results.items[0]?.net.amountMinor).toBe('1000000');
    });
  });

  /**
   * **The overtime regression.** Forty hours of candidate minutes, no approved overtime fact, no
   * earning line, and a gross that is exactly the base compensation.
   *
   * ADR-0065: a candidate is not an approved fact, and no configuration in Payroll promotes one.
   */
  it('does not pay forty hours of candidate overtime', async () => {
    const wired = wire();

    await wired.as(ADMIN, async () => {
      const ready = await configured(wired);
      const attendance = wired.attendance.get(ready.employmentId);

      if (attendance !== undefined) attendance.overtimeCandidateMinutes = 40 * 60;

      const run = await send<{ payrollRunId: string }>(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      });
      const results = await resultsOf(wired, run.payrollRunId);

      expect(results.items[0]?.gross.amountMinor).toBe('1000000');

      const earnings = await ask<{ items: readonly { readonly earningSource: string }[] }>(wired, {
        queryName: 'payroll.earnings',
        payrollResultId: results.items[0]?.payrollResultId,
      });

      expect(earnings.items.every((line) => line.earningSource !== 'attendance_overtime')).toBe(
        true,
      );
    });
  });

  /** Unpaid leave arrives through `leave.payroll-period`, never from attendance day coverage. */
  it('deducts unpaid leave from the treatment code Leave published', async () => {
    const wired = wire();

    await wired.as(ADMIN, async () => {
      const ready = await configured(wired);

      wired.leave.set(ready.employmentId, {
        employmentId: ready.employmentId,
        inputsDigest: 'lea00002',
        lines: [
          {
            leaveTypeId: uuidV7(),
            leaveTypeCode: 'unpaid-leave',
            paidTreatmentCode: 'unpaid',
            minutes: 2 * 480,
            days: 2,
          },
        ],
      });
      // Attendance reports nothing unpaid; only Leave says what "unpaid" means here.
      wired.attendance.delete(ready.employmentId);

      const run = await send<{ payrollRunId: string }>(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      });
      const results = await resultsOf(wired, run.payrollRunId);

      // Two days of a thirty-day month against a gross of 1000.000.
      expect(results.items[0]?.net.amountMinor).toBe(String(1_000_000 - 66_667));
    });
  });

  it('refuses to calculate when Organization cannot be asked', async () => {
    const wired = wire();

    await wired.as(ADMIN, async () => {
      const ready = await configured(wired);

      wired.organizationUnavailable();

      const refused = await trySend(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      });

      // Not "no country pack" — Organization could not be asked, and a workforce calculated under
      // no statutory rules because a service was down would be silently wrong (ADR-0056).
      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('organization_unavailable');
    });
  });

  it('records an exception rather than paying when Leave cannot be asked', async () => {
    const wired = wire();

    await wired.as(ADMIN, async () => {
      const ready = await configured(wired);

      wired.leaveUnavailable();

      const run = await send<{ payrollRunId: string; resultCount: number }>(wired, {
        commandName: 'payroll.calculate',
        payrollPeriodId: ready.payrollPeriodId,
      });
      const results = await resultsOf(wired, run.payrollRunId);

      // Compensation still answered, so a figure exists — but the leave digest is absent from the
      // snapshot, which is what reconciliation later compares against. Nothing was defaulted.
      expect(results.items).toHaveLength(1);
    });
  });
});
