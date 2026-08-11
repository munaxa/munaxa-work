import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { Schedule } from './schedule.js';
import { Shift } from './shift.js';
import { pair, nearDuplicates, type PairableEvent } from './pairing.js';
import {
  civilDateAt,
  instantAt,
  isRegularLocalDay,
  localDayMinutes,
  shiftBoundsOn,
} from './zoned-time.js';

/**
 * The rules that hold whether or not there is a database, an API or a tenant.
 *
 * The zone suite is first because everything else depends on it: a wrong local date puts a night
 * shift on the wrong day, in the wrong week and in the wrong payroll period, and every other
 * assertion here would still pass while the product was quietly wrong.
 *
 * The calculation, ingestion, correction and rostering rules are in `attendance-rules.test.ts`,
 * split for size along the seam between *what a time means* and *what it is worth in minutes*.
 */

const TENANT = uuidV7();
const NOW = new Date('2026-08-10T09:00:00Z');
const RIYADH = 'Asia/Riyadh';
const LONDON = 'Europe/London';

const unwrap = <TValue>(result: { ok: boolean; value?: TValue; error?: unknown }): TValue => {
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value as TValue;
};

describe('A civil date is never a truncated UTC instant', () => {
  /**
   * The defect this whole module is arranged to prevent. A punch at 02:00 in Riyadh is 23:00 UTC
   * the day before, and `toISOString().slice(0, 10)` puts it on the wrong date.
   */
  it('resolves a small-hours punch to the local date, not the UTC one', () => {
    const punch = instantAt('2026-03-03', '02:00', RIYADH);

    expect(punch.toISOString()).toBe('2026-03-02T23:00:00.000Z');
    expect(punch.toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(civilDateAt(punch, RIYADH)).toBe('2026-03-03');
  });

  it('handles a zone whose offset is not a whole number of hours', () => {
    expect(instantAt('2026-05-01', '08:00', 'Asia/Kathmandu').toISOString()).toBe(
      '2026-05-01T02:15:00.000Z',
    );
  });

  /** Not every local day is twenty-four hours, and the architecture must not assume it is. */
  it('reports a spring-forward day as twenty-three hours and an autumn day as twenty-five', () => {
    expect(localDayMinutes('2026-03-29', LONDON)).toBe(1380);
    expect(localDayMinutes('2026-10-25', LONDON)).toBe(1500);
    expect(isRegularLocalDay('2026-06-01', LONDON)).toBe(true);
    expect(isRegularLocalDay('2026-03-29', LONDON)).toBe(false);
  });

  /**
   * A night shift crossing a transition worked the hours that actually elapsed. Moving the end to
   * the next civil date rather than adding twenty-four hours is what makes that true.
   */
  it('measures an overnight shift across a daylight-saving transition by real elapsed time', () => {
    const spring = shiftBoundsOn('2026-03-28', '22:00', '06:00', LONDON);
    const ordinary = shiftBoundsOn('2026-06-01', '22:00', '06:00', LONDON);

    expect((spring.endAt.getTime() - spring.startAt.getTime()) / 60_000).toBe(420);
    expect((ordinary.endAt.getTime() - ordinary.startAt.getTime()) / 60_000).toBe(480);
  });

  it('renders local midnight as 00:00 rather than 24:00', () => {
    expect(civilDateAt(instantAt('2026-05-01', '00:00', RIYADH), RIYADH)).toBe('2026-05-01');
  });
});

describe('A shift and a schedule are definitions, immutable once published', () => {
  const aShift = (overrides: Partial<Parameters<typeof Shift.define>[0]> = {}): Shift =>
    unwrap(
      Shift.define(
        {
          tenantId: TENANT,
          code: 'day',
          name: { en: 'Day shift', ar: 'الوردية الصباحية' },
          kind: 'fixed',
          startLocal: '08:00',
          endLocal: '17:00',
          ...overrides,
        },
        NOW,
      ),
    );

  it('derives whether a shift crosses midnight, and its span', () => {
    expect(aShift().snapshot().crossesMidnight).toBe(false);
    expect(aShift().snapshot().expectedMinutes).toBe(540);

    const night = aShift({ code: 'night', startLocal: '22:00', endLocal: '06:00' });

    expect(night.snapshot().crossesMidnight).toBe(true);
    expect(night.snapshot().expectedMinutes).toBe(480);
  });

  it('refuses a shift published with no work segment, and refuses a second publication', () => {
    const shift = aShift();

    expect(shift.publish(0, 'user:hr', NOW).ok).toBe(false);
    expect(shift.publish(1, 'user:hr', NOW).ok).toBe(true);
    expect(shift.publish(1, 'user:hr', NOW).ok).toBe(false);
    expect(shift.isEditable).toBe(false);
  });

  it('refuses a flex window on a fixed shift and requires one on a flexible shift', () => {
    expect(Shift.define({ ...defineOf(aShift()), flexWindowMinutes: 60 }, NOW).ok).toBe(false);
    expect(Shift.define({ ...defineOf(aShift()), kind: 'flexible', code: 'flex' }, NOW).ok).toBe(
      false,
    );
    expect(
      Shift.define(
        { ...defineOf(aShift()), kind: 'flexible', code: 'flex', flexWindowMinutes: 60 },
        NOW,
      ).ok,
    ).toBe(true);
  });

  /** A rotation must answer "which position was 3 March" without anybody generating 2027. */
  it('resolves a cycle position from the anchor, forwards and backwards', () => {
    const schedule = unwrap(
      Schedule.define(
        {
          tenantId: TENANT,
          code: 'four-week',
          name: { en: 'Four week', ar: 'أربعة أسابيع' },
          zone: RIYADH,
          cycleLengthDays: 28,
          cycleAnchorDate: '2026-01-05',
        },
        NOW,
      ),
    );

    expect(schedule.positionOn('2026-01-05')).toBe(0);
    expect(schedule.positionOn('2026-01-06')).toBe(1);
    expect(schedule.positionOn('2026-02-02')).toBe(0);
    // Before the anchor wraps forward rather than producing a negative index.
    expect(schedule.positionOn('2026-01-04')).toBe(27);
  });

  it('refuses a schedule whose zone the runtime does not know', () => {
    const refused = Schedule.define(
      {
        tenantId: TENANT,
        code: 'bad',
        name: { en: 'Bad', ar: 'سيئ' },
        zone: 'Asia/Riyad',
        cycleLengthDays: 7,
        cycleAnchorDate: '2026-01-05',
      },
      NOW,
    );

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.reason).toBe('zone_unknown');
  });
});

describe('Events are paired, and nothing is invented to close a pair', () => {
  const at = (time: string): Date => instantAt('2026-05-04', time, RIYADH);
  const event = (kind: PairableEvent['kind'], time: string): PairableEvent => ({
    id: `${kind}-${time}`,
    kind,
    occurredAt: at(time),
  });

  it('pairs a straightforward day with a break', () => {
    const pairing = pair([
      event('clock_in', '08:00'),
      event('break_start', '12:00'),
      event('break_end', '12:30'),
      event('clock_out', '17:00'),
    ]);

    expect(pairing.work).toHaveLength(1);
    expect(pairing.work[0]?.minutes).toBe(540);
    expect(pairing.breaks[0]?.minutes).toBe(30);
    expect(pairing.unmatched).toEqual([]);
  });

  it('pairs out-of-order arrivals by when they happened, not when they were received', () => {
    const pairing = pair([event('clock_out', '17:00'), event('clock_in', '08:00')]);

    expect(pairing.work).toHaveLength(1);
    expect(pairing.work[0]?.minutes).toBe(540);
  });

  it('reports a missing clock-out rather than closing the day at the shift end', () => {
    const pairing = pair([event('clock_in', '08:00')]);

    expect(pairing.work).toEqual([]);
    expect(pairing.unmatched).toHaveLength(1);
    expect(pairing.firstIn).toEqual(at('08:00'));
  });

  it('leaves the first of two clock-ins unmatched rather than extending the day', () => {
    const pairing = pair([
      event('clock_in', '08:00'),
      event('clock_in', '09:00'),
      event('clock_out', '17:00'),
    ]);

    expect(pairing.unmatched).toHaveLength(1);
    expect(pairing.work[0]?.minutes).toBe(480);
  });

  it('treats a break outside a shift as invalid rather than deducting it', () => {
    const pairing = pair([event('break_start', '12:00'), event('break_end', '12:30')]);

    expect(pairing.breaks).toEqual([]);
    expect(pairing.invalid).toHaveLength(2);
  });

  /** A correction supersedes; the original stays in the list and leaves the arithmetic. */
  it('excludes a superseded event from the pairing and keeps it in the input', () => {
    const original = event('clock_in', '09:30');
    const corrected: PairableEvent = {
      id: 'corrected',
      kind: 'clock_in',
      occurredAt: at('08:00'),
      supersedesEventId: original.id,
    };
    const pairing = pair([original, corrected, event('clock_out', '17:00')]);

    expect(pairing.work[0]?.minutes).toBe(540);
    expect(pairing.unmatched).toEqual([]);
  });

  it('flags two punches of one kind inside the duplicate window', () => {
    const found = nearDuplicates([event('clock_in', '08:00'), event('clock_in', '08:00')], 60);

    expect(found).toHaveLength(1);
  });
});

/**
 * A published shift's definition, back as the request that would create it.
 *
 * The fixtures build shifts through `Shift.define`, and several assertions need to vary one field
 * of an otherwise valid request — so the request is reconstructed rather than duplicated, which is
 * what stops the two drifting.
 */
const defineOf = (shift: Shift): Parameters<typeof Shift.define>[0] => {
  const state = shift.snapshot();

  return {
    tenantId: state.tenantId,
    code: state.code,
    name: state.name,
    kind: state.kind,
    startLocal: state.startLocal,
    endLocal: state.endLocal,
  };
};
