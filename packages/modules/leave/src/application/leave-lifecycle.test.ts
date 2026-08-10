import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  APPROVER,
  ask,
  attempt,
  configured,
  send,
  withOpeningBalance,
} from './leave-scenarios.js';
import type { LeaveApprovalChainView, LeaveBalanceView } from '../contracts/views.js';

/**
 * A leave request from creation to approval, and the balance that follows it.
 *
 * Through the real dispatcher, the real module declaration and the real handlers — only the
 * database, Employment and Attendance are fakes. What is being tested is that the *arithmetic and
 * the authorization hold end to end*, which is not something a unit test of any one handler can say.
 */

const raised = async (
  configuration: Awaited<ReturnType<typeof configured>>,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const { leaveRequestId } = await send<{ leaveRequestId: string }>(configuration.harness, {
    commandName: 'leave.raise-request',
    employmentId: configuration.employmentId,
    leaveTypeId: configuration.leaveTypeId,
    fromDate: '2026-06-15',
    toDate: '2026-06-17',
    ...overrides,
  });

  return leaveRequestId;
};

const balanceOf = async (
  configuration: Awaited<ReturnType<typeof configured>>,
): Promise<LeaveBalanceView> => {
  await send(configuration.harness, { commandName: 'leave.recalculate-balances' });

  const page = await ask<{ items: readonly LeaveBalanceView[] }>(configuration.harness, {
    queryName: 'leave.balances',
    employmentId: configuration.employmentId,
  });
  const [balance] = page.items;

  if (balance === undefined) throw new Error('No balance was projected.');
  return balance;
};

describe('a leave request', () => {
  it('breaks a range into one row per working date and totals their minutes', async () => {
    const configuration = await configured();

    await withOpeningBalance(configuration, 9600);

    await configuration.harness.as(ADMINISTRATOR, async () => {
      const result = await send<{ totalMinutes: number; days: number }>(configuration.harness, {
        commandName: 'leave.raise-request',
        employmentId: configuration.employmentId,
        leaveTypeId: configuration.leaveTypeId,
        fromDate: '2026-06-15',
        toDate: '2026-06-17',
      });

      expect(result.days).toBe(3);
      expect(result.totalMinutes).toBe(1440);
    });
  });

  /** A draft asserts nothing: it consumes no balance and it blocks no date. */
  it('consumes nothing until it is approved', async () => {
    const configuration = await configured();

    await withOpeningBalance(configuration, 9600);

    await configuration.harness.as(ADMINISTRATOR, async () => {
      const requestId = await raised(configuration);

      expect((await balanceOf(configuration)).availableMinutes).toBe(9600);

      await send(configuration.harness, {
        commandName: 'leave.submit-request',
        leaveRequestId: requestId,
        expectedVersion: 1,
      });

      // Submitted, awaiting a decision — still nothing consumed.
      expect((await balanceOf(configuration)).availableMinutes).toBe(9600);
    });

    await configuration.harness.as(APPROVER, async () => {
      const [request] = (
        await ask<{ items: readonly { leaveRequestId: string; version: number }[] }>(
          configuration.harness,
          { queryName: 'leave.requests', state: 'pending_approval' },
        )
      ).items;

      if (request === undefined) throw new Error('The request should be awaiting a decision.');

      await send(configuration.harness, {
        commandName: 'leave.decide-request',
        leaveRequestId: request.leaveRequestId,
        decision: 'approved',
        expectedVersion: request.version,
      });
    });

    await configuration.harness.as(ADMINISTRATOR, async () => {
      const balance = await balanceOf(configuration);

      expect(balance.consumedMinutes).toBe(1440);
      expect(balance.availableMinutes).toBe(9600 - 1440);
    });
  });

  /**
   * The separation of duties this whole module rests on. The requester cannot decide their own
   * request even holding `leave.approve`, because the refusal is the domain's rather than the
   * permission checker's.
   */
  it('refuses self-approval even for somebody granted every permission', async () => {
    const configuration = await configured();

    await withOpeningBalance(configuration, 9600);

    await configuration.harness.as(ADMINISTRATOR, async () => {
      const requestId = await raised(configuration);

      await send(configuration.harness, {
        commandName: 'leave.submit-request',
        leaveRequestId: requestId,
        expectedVersion: 1,
      });

      const refused = await attempt(configuration.harness, {
        commandName: 'leave.decide-request',
        leaveRequestId: requestId,
        decision: 'approved',
        expectedVersion: 2,
      });

      expect(refused.ok).toBe(false);
      expect(refused.ok ? '' : JSON.stringify(refused.error)).toContain(
        'self_approval_not_permitted',
      );
    });
  });

  it('refuses a second request overlapping an existing one, at the day rows', async () => {
    const configuration = await configured();

    await withOpeningBalance(configuration, 9600);

    await configuration.harness.as(ADMINISTRATOR, async () => {
      await raised(configuration);

      const clash = await attempt(configuration.harness, {
        commandName: 'leave.raise-request',
        employmentId: configuration.employmentId,
        leaveTypeId: configuration.leaveTypeId,
        fromDate: '2026-06-16',
        toDate: '2026-06-16',
      });

      // A refusal naming the date, not a thrown exclusion violation: two people racing for the
      // same morning is an ordinary mistake, and the database losing the race is not a 500.
      expect(clash.ok).toBe(false);
      expect(clash.ok ? '' : JSON.stringify(clash.error)).toContain(
        'leave_already_covers_this_date',
      );
    });
  });

  /** Two halves of one day are distinguishable and coexist; the exclusion constraint permits it. */
  it('permits a first and a second half of the same date', async () => {
    const configuration = await configured();

    await withOpeningBalance(configuration, 9600);

    await configuration.harness.as(ADMINISTRATOR, async () => {
      await send(configuration.harness, {
        commandName: 'leave.raise-request',
        employmentId: configuration.employmentId,
        leaveTypeId: configuration.leaveTypeId,
        fromDate: '2026-06-15',
        toDate: '2026-06-15',
        portions: [{ onDate: '2026-06-15', portion: 'first_half' }],
      });

      const second = await attempt(configuration.harness, {
        commandName: 'leave.raise-request',
        employmentId: configuration.employmentId,
        leaveTypeId: configuration.leaveTypeId,
        fromDate: '2026-06-15',
        toDate: '2026-06-15',
        portions: [{ onDate: '2026-06-15', portion: 'second_half' }],
      });

      expect(second.ok).toBe(true);
    });
  });

  /**
   * Attendance could not be asked, and the request is refused by name rather than silently counted
   * as calendar days. A casual worker with no schedule has no working-day denominator, and
   * inventing one mis-charges their entitlement.
   */
  it('refuses a working-days request when Attendance cannot answer', async () => {
    const configuration = await configured();

    await withOpeningBalance(configuration, 9600);
    configuration.harness.attendance.unknown();

    await configuration.harness.as(ADMINISTRATOR, async () => {
      const refused = await attempt(configuration.harness, {
        commandName: 'leave.raise-request',
        employmentId: configuration.employmentId,
        leaveTypeId: configuration.leaveTypeId,
        fromDate: '2026-06-15',
        toDate: '2026-06-17',
      });

      expect(refused.ok).toBe(false);
      expect(refused.ok ? '' : JSON.stringify(refused.error)).toContain('no_working_pattern');
    });
  });
});

describe('approval', () => {
  /**
   * A policy requiring no approval produces **no decision row at all**, and the chain says so
   * rather than naming a system approver. Recording `system:auto-approval` as a human decision is
   * the fake completeness this phase refuses (ADR-0045).
   */
  it('records no decision where the policy required none', async () => {
    const configuration = await configured({ approvalsRequired: 0 });

    await withOpeningBalance(configuration, 9600);

    await configuration.harness.as(ADMINISTRATOR, async () => {
      const requestId = await raised(configuration);

      await send(configuration.harness, {
        commandName: 'leave.submit-request',
        leaveRequestId: requestId,
        expectedVersion: 1,
      });

      const chain = await ask<LeaveApprovalChainView>(configuration.harness, {
        queryName: 'leave.approval-chain',
        leaveRequestId: requestId,
      });

      expect(chain.state).toBe('approved');
      expect(chain.approvalRequired).toBe(false);
      expect(chain.steps).toHaveLength(0);
      // And it did consume, because an approved absence is committed.
      expect((await balanceOf(configuration)).consumedMinutes).toBe(1440);
    });
  });

  /** Multi-level approval is a sequence of distinct humans, not a routing engine. */
  it('stays pending until as many distinct approvers as the policy requires have decided', async () => {
    const configuration = await configured({ approvalsRequired: 2 });

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

      const chain = await ask<LeaveApprovalChainView>(configuration.harness, {
        queryName: 'leave.approval-chain',
        leaveRequestId: requestId,
      });

      expect(chain.state).toBe('pending_approval');
      expect(chain.steps).toHaveLength(1);
    });

    await configuration.harness.as('user:department-head', async () => {
      const current = await ask<{ version: number }>(configuration.harness, {
        queryName: 'leave.request',
        leaveRequestId: requestId,
      });

      await send(configuration.harness, {
        commandName: 'leave.decide-request',
        leaveRequestId: requestId,
        decision: 'approved',
        expectedVersion: current.version,
      });

      const chain = await ask<LeaveApprovalChainView>(configuration.harness, {
        queryName: 'leave.approval-chain',
        leaveRequestId: requestId,
      });

      expect(chain.state).toBe('approved');
      expect(chain.steps).toHaveLength(2);
    });
  });

  it('refuses a second decision from the same approver', async () => {
    const configuration = await configured({ approvalsRequired: 2 });

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

      const again = await attempt(configuration.harness, {
        commandName: 'leave.decide-request',
        leaveRequestId: requestId,
        decision: 'approved',
        expectedVersion: 2,
      });

      expect(again.ok).toBe(false);
      expect(again.ok ? '' : JSON.stringify(again.error)).toContain(
        'already_decided_by_this_approver',
      );
    });
  });
});
