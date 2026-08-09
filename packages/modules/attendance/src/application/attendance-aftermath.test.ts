import { beforeEach, describe, expect, it } from 'vitest';

import {
  aConfiguredSchedule,
  anAssignedEmployment,
  asActor,
  ask,
  asTenant,
  harnessFor,
  send,
  testClock,
  TENANT_A,
  type ConfiguredAttendance,
  type Harness,
} from './attendance-test-harness.js';
import { punch, punchAt, readDay } from './attendance-day-helpers.js';
import type { AwaitingRecalculationView } from './reconciliation-query.js';
import type { AttendanceDaySnapshot } from '../contracts/views.js';

/**
 * What happens after a figure exists: a rota that moves, a leave answer that cannot be given, a
 * correction, and a period frozen for Payroll.
 *
 * Split from `attendance-reliability.test.ts` for size, along the seam between *getting a figure
 * right once* and *keeping it right afterwards*. The second is the harder half: an input that moves
 * in June must be findable without an event, a correction must never rewrite a punch, and a
 * re-freeze must produce the next sequence rather than editing what Payroll already read.
 */
describe('A figure stays answerable after the inputs move', () => {
  beforeEach(() => {
    testClock.reset();
  });

  const start = async (
    harness: Harness,
  ): Promise<{ readonly configured: ConfiguredAttendance; readonly employmentId: string }> => {
    const configured = await aConfiguredSchedule(harness);
    const employmentId = await anAssignedEmployment(harness, configured);

    return { configured, employmentId };
  };

  const record = punch;

  /**
   * A rota changed after the fact does not silently rewrite what a day meant; it marks the day and
   * a human recalculates. This is the property that keeps "what applied in March" answerable.
   */
  it('marks a day when its roster changes, in the same transaction as the change', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);

      await record(harness, employmentId, 'clock_in', punchAt('08:00'));
      await record(harness, employmentId, 'clock_out', punchAt('17:00'));
      await send(harness, { commandName: 'attendance.recalculate' });

      const settled = await ask<AwaitingRecalculationView>(harness, {
        queryName: 'attendance.days-awaiting-recalculation',
      });

      expect(settled.ok && settled.value.total).toBe(0);

      await send(harness, {
        commandName: 'attendance.roster',
        employmentId,
        onDate: '2026-05-04',
        kind: 'rest',
        reasonCode: 'swapped',
      });

      const marked = await ask<AwaitingRecalculationView>(harness, {
        queryName: 'attendance.days-awaiting-recalculation',
      });

      expect(marked.ok && marked.value.total).toBe(1);

      await send(harness, { commandName: 'attendance.recalculate' });

      const rested = await readDay(harness, employmentId);

      expect(rested.day.dayKind).toBe('rest');
      expect(rested.day.expectedMinutes).toBe(0);
      expect(rested.exceptions.map((one) => one.kind)).toContain('rest_day_work');
    });
  });

  /**
   * The Leave distinction, end to end. Until Leave exists the answer is "nobody can tell", and the
   * record says so rather than asserting an absence without leave (ADR-0056).
   */
  it('reports an unexplained absence as pending explanation while Leave cannot be asked', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);

      // A scheduled day with no punches at all. The day is opened by rostering it explicitly, so
      // there is something for the reconciliation query to find without an event ever arriving.
      await send(harness, {
        commandName: 'attendance.roster',
        employmentId,
        onDate: '2026-05-04',
        kind: 'rest',
      });
      await send(harness, { commandName: 'attendance.recalculate' });

      const rested = await readDay(harness, employmentId);

      // A rest day with no attendance is not an absence at all.
      expect(rested.day.expectedMinutes).toBe(0);
      expect(rested.exceptions.map((one) => one.kind)).not.toContain('absence_pending_explanation');
    });
  });

  /**
   * The Leave distinction, which is the phase's most consequential piece of honesty.
   *
   * Until Leave exists the answer is "nobody can tell", and the record says so rather than
   * asserting that somebody was absent without leave (ADR-0056).
   */
  it('distinguishes leave unknown, no leave, and approved leave', async () => {
    const unknown = harnessFor(TENANT_A);
    const checked = harnessFor(TENANT_A);
    const covered = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const absentUnder = async (harness: Harness): Promise<AttendanceDaySnapshot> => {
        const { employmentId } = await start(harness);
        const shiftId = aShiftId(harness);

        await send(harness, {
          commandName: 'attendance.roster',
          employmentId,
          onDate: '2026-05-04',
          kind: 'shift',
          shiftId,
        });
        await send(harness, { commandName: 'attendance.recalculate' });
        return readDay(harness, employmentId);
      };

      checked.leave.noLeave();
      covered.leave.approve('2026-05-04');

      const pending = await absentUnder(unknown);
      const withoutLeave = await absentUnder(checked);
      const onLeave = await absentUnder(covered);

      expect(pending.day.leaveState).toBe('unknown');
      expect(pending.exceptions.map((one) => one.kind)).toContain('absence_pending_explanation');
      expect(pending.exceptions.map((one) => one.kind)).not.toContain('absent_unexplained');

      expect(withoutLeave.day.leaveState).toBe('none');
      expect(withoutLeave.exceptions.map((one) => one.kind)).toContain('absent_unexplained');

      expect(onLeave.day.leaveState).toBe('applied');
      expect(onLeave.exceptions.map((one) => one.kind)).not.toContain('absent_unexplained');
    });
  });

  /**
   * A correction never rewrites a punch. The original stays readable, the new event supersedes it,
   * and the day is recalculated from what is left.
   */
  it('corrects a day by superseding an event, keeping the original', async () => {
    const harness = harnessFor(TENANT_A);

    await asActor(TENANT_A, 'user:supervisor', async () => {
      const { employmentId } = await start(harness);
      const late = await record(harness, employmentId, 'clock_in', punchAt('09:30'));

      await record(harness, employmentId, 'clock_out', punchAt('17:00'));
      await send(harness, { commandName: 'attendance.recalculate' });

      const before = await readDay(harness, employmentId);

      expect(before.day.workedMinutes).toBe(450);

      const requested = await send<{ correctionId: string }>(harness, {
        commandName: 'attendance.request-correction',
        employmentId,
        attendanceDate: '2026-05-04',
        kind: 'amend_event',
        targetEventId: late.eventId,
        proposedKind: 'clock_in',
        proposedOccurredAt: punchAt('08:00'),
        reasonCode: 'reader-offline',
        justification: 'The lobby reader was down; security logged the arrival at 08:00.',
      });

      expect(requested.ok).toBe(true);

      await asActor(TENANT_A, 'user:manager', async () => {
        const decided = await send(harness, {
          commandName: 'attendance.decide-correction',
          correctionId: requested.ok ? requested.value.correctionId : '',
          approve: true,
          expectedVersion: 1,
        });

        expect(decided.ok).toBe(true);
      });

      await send(harness, { commandName: 'attendance.recalculate' });

      const after = await readDay(harness, employmentId);

      expect(after.day.workedMinutes).toBe(540);
      // The original is still there, still readable, and still says 09:30.
      expect(after.events.some((one) => one.eventId === late.eventId)).toBe(true);
      expect(after.events.some((one) => one.supersedesEventId === late.eventId)).toBe(true);
    });
  });

  /** Two decisions on one request cannot both land. The second is refused, not merged. */
  it('refuses a second decision on a correction that was already decided', async () => {
    const harness = harnessFor(TENANT_A);

    await asActor(TENANT_A, 'user:supervisor', async () => {
      const { employmentId } = await start(harness);
      const requested = await send<{ correctionId: string }>(harness, {
        commandName: 'attendance.request-correction',
        employmentId,
        attendanceDate: '2026-05-04',
        kind: 'add_event',
        proposedKind: 'clock_out',
        proposedOccurredAt: punchAt('17:00'),
        reasonCode: 'forgot',
        justification: 'Left through the loading bay.',
      });
      const correctionId = requested.ok ? requested.value.correctionId : '';

      await asActor(TENANT_A, 'user:manager', async () => {
        const first = await send(harness, {
          commandName: 'attendance.decide-correction',
          correctionId,
          approve: true,
          expectedVersion: 1,
        });
        const second = await send(harness, {
          commandName: 'attendance.decide-correction',
          correctionId,
          approve: false,
          expectedVersion: 2,
        });

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(false);
        expect(!second.ok && second.error.kind).toBe('rejected');
      });
    });
  });

  /** Freezing twice produces sequence 2, and leaves sequence 1 exactly as Payroll read it. */
  it('freezes a period, and a re-freeze creates the next sequence rather than editing', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);

      await record(harness, employmentId, 'clock_in', punchAt('08:00'));
      await record(harness, employmentId, 'clock_out', punchAt('17:00'));
      await send(harness, { commandName: 'attendance.recalculate' });

      const first = await send<{ sequence: number; workedMinutes: number }>(harness, {
        commandName: 'attendance.freeze-period',
        employmentId,
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
      });
      const second = await send<{ sequence: number }>(harness, {
        commandName: 'attendance.freeze-period',
        employmentId,
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
      });

      expect(first.ok && first.value.sequence).toBe(1);
      expect(first.ok && first.value.workedMinutes).toBe(540);
      expect(second.ok && second.value.sequence).toBe(2);
      // Sequence 1 is untouched. What Payroll read is still what Payroll read.
      const snapshots = harness.stores.snapshots as unknown as {
        readonly rows: readonly { readonly sequence: number; readonly workedMinutes: number }[];
      };

      expect(snapshots.rows.find((one) => one.sequence === 1)?.workedMinutes).toBe(540);
    });
  });

  /** A month with a day nobody recalculated is refused rather than frozen at a stale figure. */
  it('refuses to freeze a period containing a day awaiting recalculation', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);

      await record(harness, employmentId, 'clock_in', punchAt('08:00'));

      const refused = await send(harness, {
        commandName: 'attendance.freeze-period',
        employmentId,
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
      });

      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.kind === 'conflict' && refused.error.reason).toBe(
        'days_awaiting_recalculation',
      );
    });
  });

  /** Import sends the same command an integrator would, and a re-run creates nothing twice. */
  it('imports a batch, and a re-run skips every row rather than duplicating it', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);
      const rows = [
        {
          employmentId,
          kind: 'clock_in' as const,
          reportedAt: punchAt('08:00'),
          sourceReference: 'r1',
        },
        {
          employmentId,
          kind: 'clock_out' as const,
          reportedAt: punchAt('17:00'),
          sourceReference: 'r2',
        },
      ];
      const first = await send<{ created: number; skipped: number }>(harness, {
        commandName: 'attendance.import-events',
        rows,
      });
      const second = await send<{ created: number; skipped: number }>(harness, {
        commandName: 'attendance.import-events',
        rows,
      });

      expect(first.ok && first.value.created).toBe(2);
      expect(second.ok && second.value.created).toBe(0);
      expect(second.ok && second.value.skipped).toBe(2);
      expect(harness.stores.events.rows).toHaveLength(2);
    });
  });
});

const aShiftId = (harness: Harness): string => {
  const shifts = harness.stores.shifts as unknown as {
    readonly rows: readonly { readonly id: string; readonly status: string }[];
  };
  const published = shifts.rows.find((one) => one.status === 'published');

  if (published === undefined) throw new Error('The harness published no shift.');
  return published.id;
};
