import { beforeEach, describe, expect, it } from 'vitest';

import {
  aConfiguredSchedule,
  anAssignedEmployment,
  asTenant,
  harnessFor,
  send,
  testClock,
  TENANT_A,
} from './attendance-test-harness.js';
import { aPolicy, aPublishedSchedule, aPublishedShift } from './attendance-scenarios.js';
import { kindsOn, punch, readDay, recalculate } from './attendance-day-helpers.js';
import type { EventRecorded } from './ingest.use-case.js';

/**
 * The awkward days.
 *
 * Every case here is one somebody has actually been paid wrongly for: a night shift filed under the
 * wrong date, a punch at two in the morning truncated to the UTC day before, a rota changed in June
 * that quietly rewrote March, a clock-out that never arrived. They are end-to-end rather than
 * against the calculator, because most of them are decided by *which date the event was filed
 * under* and *which definition was resolved* — neither of which the calculator can get wrong on its
 * own.
 *
 * The shift-shape cases — overnight, split, flexible, and the daylight-saving day — are in
 * `attendance-shifts.test.ts`, split for size.
 */
describe('The awkward days are the ones that get paid wrongly', () => {
  beforeEach(() => {
    testClock.reset();
  });

  /** A punch that arrives out of order pairs by when it happened, not by when it landed. */
  it('pairs an out-of-order arrival by its own instant', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(harness);
      const employmentId = await anAssignedEmployment(harness, configured);

      // The clock-out is submitted first, from a reader whose queue had drained late.
      await punch(harness, employmentId, 'clock_out', new Date('2026-05-04T14:00:00Z'));
      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T05:00:00Z'));
      await recalculate(harness);

      const day = await readDay(harness, employmentId, '2026-05-04');

      expect(day.day.workedMinutes).toBe(540);
      expect(kindsOn(day)).not.toContain('missing_clock_in');
    });
  });

  /** A clock-out that never came. The day says so, blocking, and nobody signs it off. */
  it('refuses to approve a day whose clock-out never arrived', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(harness);
      const employmentId = await anAssignedEmployment(harness, configured);

      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T05:00:00Z'));
      await recalculate(harness);

      const day = await readDay(harness, employmentId, '2026-05-04');

      expect(kindsOn(day)).toContain('missing_clock_out');

      const approved = await send(harness, {
        commandName: 'attendance.approve-day',
        attendanceDayId: day.day.attendanceDayId,
        expectedVersion: day.day.version,
      });

      expect(approved.ok).toBe(false);
    });
  });

  /**
   * A late arrival and an early departure on the same day, both named with their minutes.
   *
   * The policy ships no tolerance, so the numbers here are the tenant's configuration rather than
   * this product's opinion about how late is late.
   */
  it('names lateness and an early departure with their minutes', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(harness);
      const employmentId = await anAssignedEmployment(harness, configured);

      // 08:45 to 16:15 Riyadh against an 08:00–17:00 shift.
      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T05:45:00Z'));
      await punch(harness, employmentId, 'clock_out', new Date('2026-05-04T13:15:00Z'));
      await recalculate(harness);

      const day = await readDay(harness, employmentId, '2026-05-04');
      const late = day.exceptions.find((one) => one.kind === 'late_arrival');
      const early = day.exceptions.find((one) => one.kind === 'early_departure');

      expect(late?.minutes).toBe(45);
      expect(early?.minutes).toBe(45);
    });
  });

  /**
   * A device whose clock has drifted past the tolerance.
   *
   * The event is still recorded — dropping a punch is never the answer — but it is recorded at the
   * instant the server received it, and the drift is kept on the row so somebody can see why the
   * figure is what it is.
   */
  it('records a drifted punch at the server instant and keeps the drift visible', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(harness);
      const employmentId = await anAssignedEmployment(harness, configured);

      testClock.value = new Date('2026-05-04T05:00:00Z');

      const recorded = await send<EventRecorded>(harness, {
        commandName: 'attendance.record-event',
        employmentId,
        kind: 'clock_in',
        source: 'device',
        deviceReference: 'lobby-turnstile-3',
        // The reader thinks it is two hours earlier than it is.
        reportedAt: new Date('2026-05-04T03:00:00Z'),
      });

      expect(recorded.ok).toBe(true);
      expect(recorded.ok && recorded.value.occurredAt.toISOString()).toBe(
        '2026-05-04T05:00:00.000Z',
      );
      expect(recorded.ok && recorded.value.clockSkewSeconds).toBe(-7200);
    });
  });

  /**
   * A punch captured offline and flushed later, twice.
   *
   * The offline flag survives, the client's own instant is honoured because it is inside tolerance
   * of the server's receipt, and the second flush is a success naming the first punch rather than a
   * duplicate or a conflict.
   */
  it('accepts an offline punch flushed twice as one event', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(harness);
      const employmentId = await anAssignedEmployment(harness, configured);
      const at = new Date('2026-05-04T05:00:00Z');
      const offline = { capturedOffline: true, idempotencyKey: 'mobile-queue-17' };
      const first = await punch(harness, employmentId, 'clock_in', at, offline);
      const flushedAgain = await punch(harness, employmentId, 'clock_in', at, offline);

      expect(first.alreadyRecorded).toBe(false);
      expect(flushedAgain.alreadyRecorded).toBe(true);
      expect(flushedAgain.eventId).toBe(first.eventId);
      expect(harness.stores.events.rows).toHaveLength(1);
      expect(harness.stores.events.rows[0]?.capturedOffline).toBe(true);
    });
  });

  /**
   * A rota changed after the month closed does not rewrite the month.
   *
   * The old day keeps the schedule version it was calculated under until somebody recalculates it,
   * and the recalculation reads the assignment *as at the attendance date* — so a schedule that
   * starts in June leaves May's days on May's schedule.
   */
  it('leaves an earlier month on the schedule that was in force then', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      await aPolicy(harness);

      const nineToFive = await aPublishedShift(harness, {
        kind: 'fixed',
        startLocal: '08:00',
        endLocal: '17:00',
        segments: [{ sequence: 1, kind: 'work', startLocal: '08:00', endLocal: '17:00' }],
      });
      const sixHour = await aPublishedShift(harness, {
        kind: 'fixed',
        startLocal: '09:00',
        endLocal: '15:00',
        segments: [{ sequence: 1, kind: 'work', startLocal: '09:00', endLocal: '15:00' }],
      });
      const may = await aPublishedSchedule(harness, {
        zone: 'Asia/Riyadh',
        cycleLengthDays: 1,
        places: { 0: nineToFive },
      });
      const june = await aPublishedSchedule(harness, {
        zone: 'Asia/Riyadh',
        cycleLengthDays: 1,
        places: { 0: sixHour },
      });
      const employment = harness.employment.add({});
      const employmentId = employment.employmentId;
      const assigned = await send<{ assignmentId: string }>(harness, {
        commandName: 'attendance.assign-schedule',
        employmentId,
        scheduleId: may,
        effectiveFrom: '2026-01-01',
      });

      if (!assigned.ok) throw new Error('The first assignment should have been accepted.');

      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T05:00:00Z'));
      await punch(harness, employmentId, 'clock_out', new Date('2026-05-04T14:00:00Z'));
      await recalculate(harness);

      const before = await readDay(harness, employmentId, '2026-05-04');

      expect(before.day.expectedMinutes).toBe(540);

      // An overlapping assignment is refused rather than merged: two schedules in force on one day
      // would be two answers to when somebody was expected at work.
      const overlapping = await send(harness, {
        commandName: 'attendance.assign-schedule',
        employmentId,
        scheduleId: june,
        effectiveFrom: '2026-06-01',
      });

      expect(overlapping.ok).toBe(false);

      // So the old one is closed, explicitly and with a date, and the new one takes over.
      const closed = await send(harness, {
        commandName: 'attendance.end-assignment',
        assignmentId: assigned.value.assignmentId,
        effectiveTo: '2026-05-31',
        expectedVersion: 1,
      });

      expect(closed.ok).toBe(true);

      const reassigned = await send(harness, {
        commandName: 'attendance.assign-schedule',
        employmentId,
        scheduleId: june,
        effectiveFrom: '2026-06-01',
      });

      expect(reassigned.ok).toBe(true);

      await recalculate(harness);

      const after = await readDay(harness, employmentId, '2026-05-04');

      expect(after.day.expectedMinutes).toBe(540);
      expect(after.day.inputsDigest).toBe(before.day.inputsDigest);
    });
  });

  /** A punch for somebody who had already left is refused by name, not dropped. */
  it('refuses a punch for an employment that had already ended', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(harness);
      const employmentId = await anAssignedEmployment(harness, configured);

      harness.employment.end(employmentId, '2026-04-30');
      testClock.value = new Date('2026-05-04T05:00:00Z');

      const refused = await send(harness, {
        commandName: 'attendance.record-event',
        employmentId,
        kind: 'clock_in',
        source: 'device',
        reportedAt: new Date('2026-05-04T05:00:00Z'),
      });

      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error).toMatchObject({ reason: 'employment_ended' });
      expect(harness.stores.events.rows).toHaveLength(0);
    });
  });

  /** Attendance on a day nobody expected it is reported rather than silently credited. */
  it('reports attendance on an unscheduled day', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      await aPolicy(harness);

      const employment = harness.employment.add({});

      await punch(harness, employment.employmentId, 'clock_in', new Date('2026-05-04T05:00:00Z'));
      await punch(harness, employment.employmentId, 'clock_out', new Date('2026-05-04T14:00:00Z'));
      await recalculate(harness);

      const day = await readDay(harness, employment.employmentId, '2026-05-04');

      expect(day.day.expectedMinutes).toBe(0);
      expect(day.day.workedMinutes).toBe(540);
      expect(day.day.overtimeCandidateMinutes).toBe(540);
      expect(kindsOn(day)).toContain('unscheduled_attendance');
    });
  });

  /**
   * An event that lands after the day was signed off.
   *
   * The signature is not quietly extended over something it never saw: the day returns to
   * `calculated` and an exception asks a human to look again.
   */
  it('reopens a signed-off day when a later punch arrives', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(harness);
      const employmentId = await anAssignedEmployment(harness, configured);

      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T05:00:00Z'));
      await punch(harness, employmentId, 'clock_out', new Date('2026-05-04T14:00:00Z'));
      await recalculate(harness);

      const calculated = await readDay(harness, employmentId, '2026-05-04');
      const approved = await send(harness, {
        commandName: 'attendance.approve-day',
        attendanceDayId: calculated.day.attendanceDayId,
        expectedVersion: calculated.day.version,
      });

      expect(approved.ok).toBe(true);

      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T15:00:00Z'));
      await recalculate(harness);

      const reopened = await readDay(harness, employmentId, '2026-05-04');

      expect(reopened.day.state).toBe('calculated');
      expect(kindsOn(reopened)).toContain('late_event_after_approval');
    });
  });
});
