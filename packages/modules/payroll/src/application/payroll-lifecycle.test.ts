import { describe, expect, it } from 'vitest';

import {
  ADMIN,
  APPROVER,
  attendanceFacts,
  calculated,
  configured,
  leaveFacts,
} from './payroll-scenarios.js';
import { ask, attempt, send } from './payroll-test-harness.js';
import type {
  PayrollApprovalChainView,
  PayrollExceptionView,
  PayrollResultView,
  PayslipView,
} from '../contracts/views.js';

/**
 * A payroll from an open period to a finalized, immutable result — through the real dispatcher, the
 * real module declaration and the real handlers.
 *
 * Only the database and the four sources are fakes, and both fakes enforce the rules production
 * enforces: the in-memory period store raises the exclusion constraint's own SQLSTATE, and the
 * in-memory result store refuses to remove a finalized row exactly as the database trigger does.
 * A fake more permissive than production would hide the bugs these suites exist to find.
 */

describe('the payroll run', () => {
  it('calculates a full month and publishes a result that explains itself', async () => {
    const configuration = await configured();
    const run = await calculated(configuration);

    expect(run.resultCount).toBe(1);

    const results = await configuration.harness.as(ADMIN, () =>
      ask<{ items: readonly PayrollResultView[] }>(configuration.harness, {
        queryName: 'payroll.results',
        payrollRunId: run.payrollRunId,
      }),
    );
    const result = results.items[0];

    // Exact minor units as a decimal string, never a JSON number.
    expect(result?.gross.amountMinor).toBe('1000000');
    expect(result?.net.amountMinor).toBe('1000000');
    expect(result?.currencyExponent).toBe(3);
    expect(result?.finalized).toBe(false);

    const payslip = await configuration.harness.as(ADMIN, () =>
      ask<PayslipView>(configuration.harness, {
        queryName: 'payroll.payslip',
        payrollResultId: result?.payrollResultId,
      }),
    );

    // The payslip is assembled from persisted rows alone — no source is read to explain a figure.
    expect(payslip.earnings[0]?.componentCode).toBe('salary');
    expect(payslip.earnings[0]?.payrollTreatmentCode).toBe('ordinary');
    expect(payslip.snapshotDigest).toBe(result?.snapshotDigest);
  });

  it('refuses to calculate when Organization cannot be asked, rather than assuming no country', async () => {
    const configuration = await configured();

    configuration.harness.organizationUnavailable();

    const refused = await configuration.harness.as(ADMIN, () =>
      attempt(configuration.harness, {
        commandName: 'payroll.calculate',
        payrollPeriodId: configuration.payrollPeriodId,
      }),
    );

    expect(refused.ok).toBe(false);
    // "Could not ask" is not "no country pack" (ADR-0056). A workforce calculated under no
    // statutory rules because a service was briefly down would be silently wrong.
    expect(JSON.stringify(refused)).toContain('organization_unavailable');
  });

  it('records an exception rather than a result of zero when compensation is missing', async () => {
    const configuration = await configured();

    configuration.harness.compensation.remove(configuration.employmentId);

    const run = await calculated(configuration);
    const exceptions = await configuration.harness.as(ADMIN, () =>
      ask<{ items: readonly PayrollExceptionView[] }>(configuration.harness, {
        queryName: 'payroll.exceptions',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(run.resultCount).toBe(0);
    expect(exceptions.items.map((item) => item.exceptionCode)).toContain('compensation_missing');
  });

  it('refuses to pay against attendance Attendance itself distrusts', async () => {
    const configuration = await configured();

    configuration.harness.attendance.set(
      configuration.employmentId,
      attendanceFacts({ blockingExceptions: 3 }),
    );

    const run = await calculated(configuration);
    const exceptions = await configuration.harness.as(ADMIN, () =>
      ask<{ items: readonly PayrollExceptionView[] }>(configuration.harness, {
        queryName: 'payroll.exceptions',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(run.resultCount).toBe(0);
    expect(exceptions.items.map((item) => item.exceptionCode)).toContain(
      'attendance_blocking_exceptions',
    );
  });

  it('deducts unpaid leave from the published Leave contract, not from Attendance day coverage', async () => {
    const configuration = await configured();

    // Attendance reports no unpaid minutes; Leave states the treatment. Only Leave decides what
    // "unpaid" means, and Payroll reads the code it published (ADR-0060, D-15).
    configuration.harness.attendance.remove(configuration.employmentId);
    configuration.harness.leave.set(
      configuration.employmentId,
      leaveFacts({
        lines: [
          {
            leaveTypeId: 'type-1',
            leaveTypeCode: 'unpaid-leave',
            paidTreatmentCode: 'unpaid',
            minutes: 2 * 480,
            days: 2,
          },
        ],
      }),
    );

    const run = await calculated(configuration);
    const results = await configuration.harness.as(ADMIN, () =>
      ask<{ items: readonly PayrollResultView[] }>(configuration.harness, {
        queryName: 'payroll.results',
        payrollRunId: run.payrollRunId,
      }),
    );

    // Two days of a thirty-day month, deducted from a gross of 1000.000.
    expect(results.items[0]?.totalDeductions.amountMinor).toBe('66667');
  });
});

/**
 * **The overtime assertion, at the application layer.**
 *
 * Attendance publishes candidate minutes by design (ADR-0054). No configuration on the payroll
 * group promotes one into an approved fact, because a consumer that could promote a fact would have
 * become its owner while leaving the responsibility behind (ADR-0065).
 */
describe('candidate overtime', () => {
  it('produces no earning line however many minutes there are', async () => {
    const configuration = await configured();

    configuration.harness.attendance.set(
      configuration.employmentId,
      attendanceFacts({ overtimeCandidateMinutes: 60 * 40 }),
    );

    const run = await calculated(configuration);
    const results = await configuration.harness.as(ADMIN, () =>
      ask<{ items: readonly PayrollResultView[] }>(configuration.harness, {
        queryName: 'payroll.results',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(results.items[0]?.gross.amountMinor).toBe('1000000');
  });
});

describe('approval', () => {
  it('refuses a self-approval and records a reversal without erasing the original', async () => {
    const configuration = await configured();
    const run = await calculated(configuration);

    // The administrator calculated it, so the administrator cannot approve it.
    const refused = await configuration.harness.as(ADMIN, () =>
      attempt(configuration.harness, {
        commandName: 'payroll.approve',
        payrollRunId: run.payrollRunId,
      }),
    );

    expect(refused.ok).toBe(false);

    const approval = await configuration.harness.as(APPROVER, () =>
      send<{ approvalDecisionId: string }>(configuration.harness, {
        commandName: 'payroll.approve',
        payrollRunId: run.payrollRunId,
      }),
    );

    await configuration.harness.as(APPROVER, () =>
      send(configuration.harness, {
        commandName: 'payroll.reverse-approval',
        approvalDecisionId: approval.approvalDecisionId,
      }),
    );

    const chain = await configuration.harness.as(ADMIN, () =>
      ask<PayrollApprovalChainView>(configuration.harness, {
        queryName: 'payroll.approval-chain',
        payrollRunId: run.payrollRunId,
      }),
    );

    // Both rows remain. The chain reads as what happened rather than as though nothing had.
    expect(chain.steps).toHaveLength(2);
    expect(chain.state).toBe('pending');
    // No fabricated `system:auto-approval` step anywhere in it.
    expect(JSON.stringify(chain)).not.toContain('system:auto-approval');
  });
});
