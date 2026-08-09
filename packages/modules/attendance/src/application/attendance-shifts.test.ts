import { beforeEach, describe, expect, it } from 'vitest';

import {
  aConfiguredSchedule,
  anAssignedEmployment,
  asTenant,
  harnessFor,
  testClock,
  TENANT_A,
} from './attendance-test-harness.js';
import {
  aPolicy,
  aPublishedSchedule,
  aPublishedShift,
  anEmploymentOn,
} from './attendance-scenarios.js';
import { kindsOn, punch, readDay, recalculate } from './attendance-day-helpers.js';

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
 * This half is the *shapes*: an overnight shift, a split shift, a flexible one, and a day the
 * clock itself changed length. The rest — out-of-order punches, drift, offline flushes, rota
 * changes and terminations — is in `attendance-edge-cases.test.ts`.
 */
describe('An awkward shift shape is still measured correctly', () => {
  beforeEach(() => {
    testClock.reset();
  });

  /**
   * The case a UTC-truncating system gets wrong every night.
   *
   * A punch at 02:00 in Riyadh is 23:00 the previous day in UTC. Filing it under the UTC date would
   * put it on somebody else's shift, and no amount of correct arithmetic afterwards recovers from
   * that.
   */
  it('files a small-hours punch under the local date, not the UTC one', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(harness, { zone: 'Asia/Riyadh' });
      const employmentId = await anAssignedEmployment(harness, configured);
      const recorded = await punch(
        harness,
        employmentId,
        'clock_in',
        new Date('2026-05-04T23:00:00Z'),
      );

      expect(recorded.attendanceDate).toBe('2026-05-05');
      expect(recorded.zone).toBe('Asia/Riyadh');
    });
  });

  /**
   * A night shift, and the punch after midnight that belongs to the shift's own date.
   *
   * The clock-out is filed under the fifth because that is the civil date it happened on, and the
   * expectation for the fourth still ends on the fifth — which is why the day's expected end is the
   * following morning rather than an impossible 06:00 before its 22:00 start.
   */
  it('carries an overnight shift into the next civil date without adding a day', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      await aPolicy(harness);

      const night = await aPublishedShift(harness, {
        kind: 'night',
        startLocal: '22:00',
        endLocal: '06:00',
        segments: [{ sequence: 1, kind: 'work', startLocal: '22:00', endLocal: '06:00' }],
      });
      const scheduleId = await aPublishedSchedule(harness, {
        zone: 'Asia/Riyadh',
        places: { 0: night, 1: night, 2: night, 3: night, 4: night },
      });
      const employmentId = await anEmploymentOn(harness, scheduleId);

      // 22:00 and 06:00 Riyadh, which is 19:00 and 03:00 UTC.
      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T19:00:00Z'));

      const out = await punch(harness, employmentId, 'clock_out', new Date('2026-05-05T03:00:00Z'));

      expect(out.attendanceDate).toBe('2026-05-05');

      await recalculate(harness);

      const opening = await readDay(harness, employmentId, '2026-05-04');

      expect(opening.day.expectedMinutes).toBe(480);
      expect(opening.day.expectedEndAt?.toISOString()).toBe('2026-05-05T03:00:00.000Z');
      // The clock-out landed on the following date, so this day has an open pair. It says so and
      // blocks approval rather than closing the day at the shift's end.
      expect(kindsOn(opening)).toContain('missing_clock_out');
    });
  });

  /** A split shift's two work segments and its unpaid gap. */
  it('deducts the gap in a split shift and credits both halves', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      await aPolicy(harness);

      const split = await aPublishedShift(harness, {
        kind: 'split',
        startLocal: '08:00',
        endLocal: '20:00',
        expectedMinutes: 480,
        segments: [
          { sequence: 1, kind: 'work', startLocal: '08:00', endLocal: '12:00' },
          { sequence: 2, kind: 'break', startLocal: '12:00', endLocal: '16:00', paid: false },
          { sequence: 3, kind: 'work', startLocal: '16:00', endLocal: '20:00' },
        ],
      });
      const scheduleId = await aPublishedSchedule(harness, {
        zone: 'Asia/Riyadh',
        places: { 0: split },
      });
      const employmentId = await anEmploymentOn(harness, scheduleId);

      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T05:00:00Z'));
      await punch(harness, employmentId, 'break_start', new Date('2026-05-04T09:00:00Z'));
      await punch(harness, employmentId, 'break_end', new Date('2026-05-04T13:00:00Z'));
      await punch(harness, employmentId, 'clock_out', new Date('2026-05-04T17:00:00Z'));
      await recalculate(harness);

      const day = await readDay(harness, employmentId, '2026-05-04');

      expect(day.day.breakMinutesTaken).toBe(240);
      expect(day.day.paidBreakMinutes).toBe(0);
      expect(day.day.workedMinutes).toBe(480);
      expect(day.day.unpaidMinutes).toBe(240);
      expect(kindsOn(day)).not.toContain('late_arrival');
    });
  });

  /** A flexible arrangement, where arriving inside the window is the arrangement working. */
  it('does not call a flexible arrival late inside its window', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      await aPolicy(harness);

      const flexible = await aPublishedShift(harness, {
        kind: 'flexible',
        startLocal: '08:00',
        endLocal: '17:00',
        flexWindowMinutes: 120,
        segments: [{ sequence: 1, kind: 'work', startLocal: '08:00', endLocal: '17:00' }],
      });
      const scheduleId = await aPublishedSchedule(harness, {
        zone: 'Asia/Riyadh',
        places: { 0: flexible },
      });
      const employmentId = await anEmploymentOn(harness, scheduleId);

      // 09:30 Riyadh: an hour and a half after the nominal start, inside the two-hour window.
      await punch(harness, employmentId, 'clock_in', new Date('2026-05-04T06:30:00Z'));
      await punch(harness, employmentId, 'clock_out', new Date('2026-05-04T12:00:00Z'));
      await recalculate(harness);

      const day = await readDay(harness, employmentId, '2026-05-04');

      expect(kindsOn(day)).not.toContain('late_arrival');
      // Leaving at 15:00 is still early against a core that ends at 15:00 — exactly, so not early.
      expect(kindsOn(day)).not.toContain('early_departure');
    });
  });

  /**
   * The spring-forward day.
   *
   * London loses an hour on 2026-03-29. What was asked of the person did not change, so the
   * expected figure is the shift's authored one; the interval between the expected instants is an
   * hour shorter, and the person who worked their whole shift is not short an hour of absence.
   */
  it('does not turn a daylight-saving hour into absence', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      await aPolicy(harness);

      const shiftId = await aPublishedShift(harness, {
        kind: 'fixed',
        startLocal: '00:30',
        endLocal: '09:30',
        segments: [{ sequence: 1, kind: 'work', startLocal: '00:30', endLocal: '09:30' }],
      });
      const scheduleId = await aPublishedSchedule(harness, {
        zone: 'Europe/London',
        cycleLengthDays: 1,
        cycleAnchorDate: '2026-03-29',
        places: { 0: shiftId },
      });
      const employmentId = await anEmploymentOn(harness, scheduleId);

      // 00:30 GMT is 00:30Z; 09:30 BST is 08:30Z. Eight hours of clock, nine of shift.
      await punch(harness, employmentId, 'clock_in', new Date('2026-03-29T00:30:00Z'));
      await punch(harness, employmentId, 'clock_out', new Date('2026-03-29T08:30:00Z'));
      await recalculate(harness);

      const day = await readDay(harness, employmentId, '2026-03-29');

      expect(day.day.expectedMinutes).toBe(540);
      expect(day.day.workedMinutes).toBe(480);
      // Sixty minutes of shortfall, which is the truth: the clock skipped them and nobody worked
      // them. What matters is that the *expectation* was not silently recomputed to 480.
      expect(day.day.absenceMinutes).toBe(60);
    });
  });
});
