import { describe, expect, it } from 'vitest';

import {
  SERVICE_LEVEL_UNITS,
  dueAt,
  isServiceLevelUnit,
  overdueByMinutes,
  serviceLevelState,
  serviceLevelTarget,
  type ServiceLevelTarget,
} from './service-level.js';

/**
 * A target, a due time and an overdue reading — and the three things none of them does.
 *
 * **Nothing here changes state.** No step becomes `expired`, no instance ends, no history is written,
 * no branch moves and no denominator shifts (D-16C-06). Every assertion below is about a *question
 * answered from two instants and an integer*, and the suite is written so that a later reader
 * reaching for a stored `expired` column meets the reason first.
 *
 * **Nothing here reads a clock.** The reading instant is a parameter on every function, which is why
 * a boundary can be asserted at all: a function that consulted the time would give two answers to one
 * question asked twice in a millisecond.
 *
 * **Nothing here consults a calendar.** Elapsed time, in whole hours or whole days (D-16C-05), so a
 * two-day target elapses across a weekend and a one-day target is twenty-four hours rather than "the
 * same clock time tomorrow". Both are stated limits, and both are asserted rather than left to be
 * discovered.
 */

const AWAITING_SINCE = new Date('2026-08-16T09:00:00.000Z');
const hours = (count: number): ServiceLevelTarget => ({ count, unit: 'hours' });
const days = (count: number): ServiceLevelTarget => ({ count, unit: 'days' });

describe('a target somebody configured', () => {
  it('takes a whole number of one or more, in either unit', () => {
    expect(serviceLevelTarget(1, 'hours')).toStrictEqual({
      ok: true,
      value: { count: 1, unit: 'hours' },
    });
    expect(serviceLevelTarget(4000, 'days')).toStrictEqual({
      ok: true,
      value: { count: 4000, unit: 'days' },
    });
  });

  /**
   * No upper bound, and that is AD-004 arriving in a new place.
   *
   * A ceiling here would be a policy about how long an approval may take, invented in a value object
   * rather than approved by anybody. The column's own range is a property of the storage.
   */
  it('places no ceiling on how long a step may be given', () => {
    expect(serviceLevelTarget(2_000_000_000, 'hours').ok).toBe(true);
  });

  it.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'refuses %p as an count',
    (count) => {
      expect(serviceLevelTarget(count, 'hours')).toMatchObject({
        ok: false,
        error: { reason: 'service-level-count-invalid' },
      });
    },
  );

  /** Half a day is a question about working hours that this module cannot answer, so it refuses. */
  it('refuses a fraction rather than rounding it', () => {
    expect(serviceLevelTarget(0.5, 'days').ok).toBe(false);
    expect(serviceLevelTarget(1.999, 'days').ok).toBe(false);
  });

  it.each([['minutes'], ['weeks'], ['business-days'], ['HOURS'], ['']])(
    'refuses %p as a unit',
    (unit) => {
      expect(serviceLevelTarget(1, unit)).toMatchObject({
        ok: false,
        error: { reason: 'service-level-unit-invalid' },
      });
    },
  );

  /** Two units and no third. `business-days` is refused above, and that is the approved boundary. */
  it('declares exactly two units', () => {
    expect(SERVICE_LEVEL_UNITS).toStrictEqual(['hours', 'days']);
    expect(isServiceLevelUnit('hours')).toBe(true);
    expect(isServiceLevelUnit('business-days')).toBe(false);
  });
});

describe('when a step falls due', () => {
  it('counts from the instant the step became awaiting, not from the approval’s start', () => {
    expect(dueAt(hours(2), AWAITING_SINCE)).toStrictEqual(new Date('2026-08-16T11:00:00.000Z'));
    expect(dueAt(days(1), AWAITING_SINCE)).toStrictEqual(new Date('2026-08-17T09:00:00.000Z'));
  });

  /**
   * A day is twenty-four hours, and the difference shows across a daylight-saving boundary.
   *
   * Elapsed time consults no calendar, so "one day" from 23:00 on the day a clock springs forward is
   * twenty-four hours later by the clock that does not move. Asserted rather than left implicit,
   * because a reader expecting "the same time tomorrow" would otherwise find this surprising.
   */
  it('adds twenty-four hours for a day, with no daylight-saving adjustment', () => {
    const beforeSpringForward = new Date('2026-03-28T23:00:00.000Z');

    expect(dueAt(days(1), beforeSpringForward)).toStrictEqual(new Date('2026-03-29T23:00:00.000Z'));
  });

  it('has no due time for a step with no target', () => {
    expect(dueAt(undefined, AWAITING_SINCE)).toBeUndefined();
  });

  /** A step nobody is waiting on has no clock: not started, and not still running after a decision. */
  it('has no due time for a step that is not awaiting anybody', () => {
    expect(dueAt(hours(2), undefined)).toBeUndefined();
    expect(dueAt(undefined, undefined)).toBeUndefined();
  });
});

describe('whether a step is overdue, as at an instant', () => {
  const due = new Date('2026-08-16T11:00:00.000Z');

  it('is within its target right up to the boundary, and overdue after it', () => {
    expect(serviceLevelState(hours(2), AWAITING_SINCE, AWAITING_SINCE)).toBe('within');
    expect(serviceLevelState(hours(2), AWAITING_SINCE, new Date(due.getTime() - 1))).toBe('within');
    // Exactly on the boundary is met. "Two hours to approve" means two whole hours.
    expect(serviceLevelState(hours(2), AWAITING_SINCE, due)).toBe('within');
    expect(serviceLevelState(hours(2), AWAITING_SINCE, new Date(due.getTime() + 1))).toBe(
      'overdue',
    );
  });

  it('has no state at all without a target or without a waiting step', () => {
    expect(serviceLevelState(undefined, AWAITING_SINCE, due)).toBe('none');
    expect(serviceLevelState(hours(2), undefined, due)).toBe('none');
  });

  /**
   * The reading instant is a parameter, and this is the assertion that keeps it one.
   *
   * The same step read at two instants gives two answers, and neither depends on when the test ran.
   * A function that reached for the current time could not be asserted this way at all.
   */
  it('answers from the instant it is given and never from a clock', () => {
    const target = days(1);

    expect(serviceLevelState(target, AWAITING_SINCE, new Date('2026-08-16T23:59:59.999Z'))).toBe(
      'within',
    );
    expect(serviceLevelState(target, AWAITING_SINCE, new Date('2026-08-18T00:00:00.000Z'))).toBe(
      'overdue',
    );
    // Today's reading is not consulted: a target set in 2026 is not overdue because the suite ran.
    expect(serviceLevelState(target, AWAITING_SINCE, AWAITING_SINCE)).toBe('within');
  });
});

describe('how long a step has been overdue', () => {
  const due = new Date('2026-08-16T11:00:00.000Z');

  it('is nothing while the step is within its target, including on the boundary', () => {
    expect(overdueByMinutes(hours(2), AWAITING_SINCE, due)).toBeUndefined();
    expect(overdueByMinutes(hours(2), AWAITING_SINCE, new Date(due.getTime() - 1))).toBeUndefined();
    expect(overdueByMinutes(undefined, AWAITING_SINCE, due)).toBeUndefined();
  });

  /**
   * Truncated rather than rounded, and whole minutes rather than milliseconds.
   *
   * A step three seconds past its target is overdue by **zero** minutes. Claiming one would be the
   * same overstatement a percentage would be, in a module whose every published number is an integer.
   */
  it('truncates towards zero and never claims a minute that has not elapsed', () => {
    expect(overdueByMinutes(hours(2), AWAITING_SINCE, new Date(due.getTime() + 3_000))).toBe(0);
    expect(overdueByMinutes(hours(2), AWAITING_SINCE, new Date(due.getTime() + 59_999))).toBe(0);
    expect(overdueByMinutes(hours(2), AWAITING_SINCE, new Date(due.getTime() + 60_000))).toBe(1);
    expect(overdueByMinutes(hours(2), AWAITING_SINCE, new Date(due.getTime() + 3_600_000))).toBe(
      60,
    );
  });

  it('produces only whole numbers, however long the wait', () => {
    // Due at 10:00 on the 16th of August; read at 09:00 on the 16th of September. That is thirty
    // days and twenty-three hours — 44,580 minutes — and the trailing half-second is truncated away
    // rather than rounded up into a minute that has not elapsed.
    const late = overdueByMinutes(hours(1), AWAITING_SINCE, new Date('2026-09-16T09:00:17.500Z'));

    expect(Number.isInteger(late)).toBe(true);
    expect(late).toBe(30 * 1440 + 23 * 60);
    expect(late).toBe(44_580);
  });
});

describe('what a target is not', () => {
  /**
   * The whole of this file's restraint, asserted against its own source.
   *
   * A target buys a question, not a state and not a timer. There is no `expired` value anywhere in
   * this module's service-level vocabulary, nothing schedules, and nothing writes — because the only
   * things that could write an expiry are a scheduler this phase does not have (D-16C-01) or a
   * synthetic actor ADR-0045 refuses (D-16C-02).
   */
  it('produces no state a step could be stored in', () => {
    const states = [
      serviceLevelState(undefined, undefined, AWAITING_SINCE),
      serviceLevelState(hours(1), AWAITING_SINCE, AWAITING_SINCE),
      serviceLevelState(hours(1), AWAITING_SINCE, new Date('2027-01-01T00:00:00.000Z')),
    ];

    expect([...new Set(states)].sort()).toStrictEqual(['none', 'overdue', 'within']);
    expect(states).not.toContain('expired');
  });

  it('never mutates the target it was given', () => {
    const target = hours(2);

    dueAt(target, AWAITING_SINCE);
    serviceLevelState(target, AWAITING_SINCE, new Date('2027-01-01T00:00:00.000Z'));
    overdueByMinutes(target, AWAITING_SINCE, new Date('2027-01-01T00:00:00.000Z'));

    expect(target).toStrictEqual({ count: 2, unit: 'hours' });
  });

  /** And it never moves the instant the clock started from — nothing restarts a running clock. */
  it('never moves the instant a step began waiting', () => {
    const since = new Date(AWAITING_SINCE.getTime());

    dueAt(days(3), since);
    expect(since).toStrictEqual(AWAITING_SINCE);
  });
});
