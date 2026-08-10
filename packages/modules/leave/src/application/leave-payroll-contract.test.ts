import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  APPROVER,
  ask,
  configured,
  send,
  withOpeningBalance,
} from './leave-scenarios.js';
import type { LeavePayrollPeriodView } from '../contracts/views.js';

/** Raising a request, which every case here starts from. */
const raised = async (configuration: Awaited<ReturnType<typeof configured>>): Promise<string> => {
  const request = await send<{ leaveRequestId: string }>(configuration.harness, {
    commandName: 'leave.raise-request',
    employmentId: configuration.employmentId,
    leaveTypeId: configuration.leaveTypeId,
    fromDate: '2026-06-15',
    toDate: '2026-06-17',
  });

  return request.leaveRequestId;
};

/**
 * **The Payroll contract**, tested for what it carries and for what it must never require.
 *
 * `LeavePayrollPeriodView` was declared in Phase 9 and returned by nothing; this is the handler
 * Phase 11 added for it (D-15). The assertion that matters is the second one: the treatment code
 * Leave stored travels out **uninterpreted**, so Payroll never has to resolve a `leaveTypeId` to a
 * meaning — which would be Payroll deciding what Leave means (ADR-0060).
 */
describe('the payroll-period contract', () => {
  it('publishes approved leave per type, with the treatment code Leave stored', async () => {
    const configuration = await configured();

    await withOpeningBalance(configuration, 9600);

    const requestId = await configuration.harness.as(ADMINISTRATOR, async () => {
      const id = await raised(configuration);

      await send(configuration.harness, {
        commandName: 'leave.submit-request',
        leaveRequestId: id,
        expectedVersion: 1,
      });
      return id;
    });

    await configuration.harness.as(APPROVER, async () => {
      await send(configuration.harness, {
        commandName: 'leave.decide-request',
        leaveRequestId: requestId,
        decision: 'approved',
        expectedVersion: 2,
      });
    });

    const page = await configuration.harness.as(ADMINISTRATOR, () =>
      ask<{ items: readonly LeavePayrollPeriodView[] }>(configuration.harness, {
        queryName: 'leave.payroll-period',
        employmentIds: [configuration.employmentId],
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      }),
    );
    const line = page.items[0]?.lines[0];

    expect(line?.minutes).toBeGreaterThan(0);
    // Stored by Leave, never read by Leave, and now carried out to Payroll unchanged.
    expect(line?.paidTreatmentCode).toBe('full-pay');
    // Eligibility, not worth: Leave publishes no rate and no monetary figure of any kind.
    expect(JSON.stringify(page)).not.toMatch(/amount|currency|gross|net/i);
    expect(page.items[0]?.inputsDigest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('answers with no lines rather than refusing when nothing is approved', async () => {
    const configuration = await configured();

    const page = await configuration.harness.as(ADMINISTRATOR, () =>
      ask<{ items: readonly LeavePayrollPeriodView[] }>(configuration.harness, {
        queryName: 'leave.payroll-period',
        employmentIds: [configuration.employmentId],
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
      }),
    );

    expect(page.items[0]?.lines).toHaveLength(0);
    // An employment with no leave is a real answer. Payroll distinguishes it from "could not ask".
    expect(page.items[0]?.encashableMinutes).toBe(0);
  });
});
