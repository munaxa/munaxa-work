import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import {
  LEAVE_DATE,
  asTenant,
  ask,
  configured,
  send,
  wire,
  type Wired,
} from './cross-module-harness.js';

/**
 * **The cross-module test.** The sequence that proves the whole phase, across three modules.
 *
 * Every other suite in these modules uses a fake for the module next door, which is right for
 * testing a module and useless for testing a *boundary*. What is asserted here is the thing no
 * single module can assert about itself:
 *
 * 1. an employment exists and works a published schedule;
 * 2. Leave asks **Attendance** how long that working day is, through the real adapter;
 * 3. an attendance day with no punches is calculated while Leave has nothing approved, and comes
 *    out as a *checked* absence — `leaveState: 'none'`;
 * 4. leave is requested for the date, and its duration comes from Attendance's answer;
 * 5. a **different human** approves it, because self-approval is refused;
 * 6. Attendance's **own reconciliation** asks Leave what changed and marks its own days;
 * 7. recalculation runs, and the same day comes out as `leaveState: 'applied'`.
 *
 * Step 6 is the one that matters architecturally. Leave never writes an Attendance row and never
 * sends an Attendance command: Attendance already depends on Leave, so a write the other way would
 * close a dependency cycle and make Leave responsible for another module's derived state.
 * Attendance **pulls** (ADR-0058) — and if every domain event were dropped, the record would still
 * converge, which is the property this test really pins down.
 *
 * The second test is the honest-failure one: with Leave unable to answer, the same day is
 * `absence_pending_explanation` rather than `absent_unexplained`. "Nobody could be asked" and "we
 * checked and there was none" are different statements about a person (ADR-0056).
 */

interface DaySnapshot {
  readonly day: { readonly leaveState: string; readonly state: string };
  readonly exceptions: readonly { readonly kind: string }[];
}

const dayOn = (wired: Wired, employmentId: string): Promise<DaySnapshot> =>
  ask<DaySnapshot>(wired, {
    queryName: 'attendance.read-day',
    employmentId,
    attendanceDate: LEAVE_DATE,
  });

describe('Leave and Attendance across the boundary', () => {
  it('moves a day from an unexplained absence to leave applied, with Attendance pulling', async () => {
    const wired = wire();

    await asTenant('user:hr-administrator', async () => {
      const ready = await configured(wired);

      // A day with no punches, calculated while Leave has nothing approved. Leave answers — the
      // adapter reaches the real module — so this is a *checked* absence, not an open question.
      await send(wired, {
        commandName: 'attendance.recalculate',
        employmentId: ready.employmentId,
        attendanceDate: LEAVE_DATE,
      }).catch(() => undefined);

      await send(wired, {
        commandName: 'attendance.roster',
        employmentId: ready.employmentId,
        onDate: LEAVE_DATE,
        kind: 'shift',
        shiftId: ready.shiftId,
      });
      await send(wired, {
        commandName: 'attendance.recalculate',
        employmentId: ready.employmentId,
        attendanceDate: LEAVE_DATE,
      });

      const before = await dayOn(wired, ready.employmentId);

      expect(before.day.leaveState).toBe('none');

      // Leave is approved for the date. The duration is computed from **Attendance's** published
      // working-day read, which is what makes the two modules agree about the day's length.
      const request = await send<{ leaveRequestId: string; totalMinutes: number }>(wired, {
        commandName: 'leave.raise-request',
        employmentId: ready.employmentId,
        leaveTypeId: ready.leaveTypeId,
        fromDate: LEAVE_DATE,
        toDate: LEAVE_DATE,
      });

      expect(request.totalMinutes).toBe(480);

      await send(wired, {
        commandName: 'leave.submit-request',
        leaveRequestId: request.leaveRequestId,
        expectedVersion: 1,
      });

      return { ready, request };
    }).then(async ({ ready, request }) => {
      // A different human decides: self-approval is refused by the domain and by the database.
      await asTenant('user:line-manager', () =>
        send(wired, {
          commandName: 'leave.decide-request',
          leaveRequestId: request.leaveRequestId,
          decision: 'approved',
          expectedVersion: 2,
        }),
      );

      await asTenant('user:hr-administrator', async () => {
        // **Attendance pulls.** Leave wrote nothing here; Attendance asks what changed and marks
        // its own days.
        const reconciled = await send<{ leaveKnown: boolean; daysMarked: number }>(wired, {
          commandName: 'attendance.reconcile-leave',
          employmentId: ready.employmentId,
          from: LEAVE_DATE,
          to: LEAVE_DATE,
        });

        expect(reconciled.leaveKnown).toBe(true);
        expect(reconciled.daysMarked).toBeGreaterThan(0);

        await send(wired, { commandName: 'attendance.recalculate' });

        const after = await dayOn(wired, ready.employmentId);

        expect(after.day.leaveState).toBe('applied');
      });
    });
  });

  /**
   * The honest-failure case, with a Leave that throws.
   *
   * `known: false` must survive all the way to the day's state: the exception is
   * `absence_pending_explanation`, never `absent_unexplained`. Asserting somebody was absent
   * without leave when the system could not check is a false statement on their record (ADR-0056).
   */
  it('records an open question rather than an unexplained absence when Leave cannot be asked', async () => {
    const wired = wire();

    await asTenant('user:hr-administrator', async () => {
      const ready = await configured(wired);

      wired.leaveUnavailable();

      await send(wired, {
        commandName: 'attendance.roster',
        employmentId: ready.employmentId,
        onDate: LEAVE_DATE,
        kind: 'shift',
        shiftId: ready.shiftId,
      });
      await send(wired, {
        commandName: 'attendance.recalculate',
        employmentId: ready.employmentId,
        attendanceDate: LEAVE_DATE,
      });

      const day = await dayOn(wired, ready.employmentId);

      expect(day.day.leaveState).toBe('unknown');
      expect(day.exceptions.map((one) => one.kind)).toContain('absence_pending_explanation');

      wired.leaveRestored();
    });
  });
});
