import { describe, expect, it } from 'vitest';

import { DomainException } from '../errors/domain-exception.js';

import {
  formatCalendarDate,
  fromHijri,
  toGregorian,
  toHijri,
  toInstant,
  type CalendarDate,
} from './calendar.js';

const gregorian = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const hijri = (year: number, month: number, day: number): CalendarDate => ({
  year,
  month,
  day,
  calendar: 'hijri',
});

describe('Hijri conversion', () => {
  /**
   * Golden cases. The first is taken from a live HR system's leave request screen, which showed
   * 27.07.2026 alongside 13.02.1448 — an independent implementation agreeing with ours.
   */
  it.each([
    ['2026-07-27', 1448, 2, 13],
    ['2026-08-05', 1448, 2, 22],
    ['2000-01-01', 1420, 9, 24],
    ['1970-01-01', 1389, 10, 22],
    ['2050-12-31', 1473, 4, 17],
  ])('converts %s to %i-%i-%i', (iso, year, month, day) => {
    expect(toHijri(gregorian(iso))).toEqual({ year, month, day, calendar: 'hijri' });
  });

  it.each([
    ['2026-07-27', 1448, 2, 13],
    ['2026-08-05', 1448, 2, 22],
    ['2000-01-01', 1420, 9, 24],
    ['1970-01-01', 1389, 10, 22],
    ['2050-12-31', 1473, 4, 17],
  ])('converts %i-%i-%i back to %s', (iso, year, month, day) => {
    expect(fromHijri(hijri(year, month, day)).toISOString()).toBe(`${iso}T00:00:00.000Z`);
  });

  it('round-trips every day across a decade', () => {
    const start = Date.UTC(2020, 0, 1);
    const days = 3653;

    for (let offset = 0; offset < days; offset += 1) {
      const instant = new Date(start + offset * 86_400_000);
      const roundTripped = fromHijri(toHijri(instant));

      expect(roundTripped.toISOString()).toBe(instant.toISOString());
    }
  });

  it('advances the Hijri day exactly once per Gregorian day', () => {
    let previous = toHijri(gregorian('2026-01-01'));

    for (let offset = 1; offset < 400; offset += 1) {
      const current = toHijri(new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000));
      const sameMonth = current.year === previous.year && current.month === previous.month;

      if (sameMonth) {
        expect(current.day).toBe(previous.day + 1);
      } else {
        expect(current.day).toBe(1);
      }
      previous = current;
    }
  });

  it('produces Hijri months of 29 or 30 days, never a formula-derived length', () => {
    const lengths = new Set<number>();
    let cursor = gregorian('2024-01-01');

    // Start on the first of a Hijri month, or the first measurement is a partial one.
    while (toHijri(cursor).day !== 1) {
      cursor = new Date(cursor.getTime() + 86_400_000);
    }

    for (let month = 0; month < 24; month += 1) {
      const start = toHijri(cursor);
      let days = 0;
      let candidate = cursor;

      while (toHijri(candidate).month === start.month) {
        days += 1;
        candidate = new Date(candidate.getTime() + 86_400_000);
      }
      lengths.add(days);
      cursor = candidate;
    }

    expect([...lengths].every((length) => length === 29 || length === 30)).toBe(true);
    // Both lengths must actually occur, or we are looking at an arithmetic approximation.
    expect(lengths.size).toBe(2);
  });

  it('rejects a Hijri date that does not exist', () => {
    expect(() => fromHijri(hijri(1448, 13, 1))).toThrow(DomainException);
  });

  it('refuses to convert outside the supported range', () => {
    expect(() => toHijri(gregorian('1899-12-31'))).toThrow(/supported between/);
    expect(() => toHijri(gregorian('2101-01-01'))).toThrow(/supported between/);
  });
});

describe('calendar dates', () => {
  it('reads a Gregorian date from an instant', () => {
    expect(toGregorian(gregorian('2026-07-27'))).toEqual({
      year: 2026,
      month: 7,
      day: 27,
      calendar: 'gregorian',
    });
  });

  it('converts either calendar to the same instant', () => {
    const fromGregorian = toInstant({ year: 2026, month: 7, day: 27, calendar: 'gregorian' });
    const fromHijriDate = toInstant(hijri(1448, 2, 13));

    expect(fromHijriDate.toISOString()).toBe(fromGregorian.toISOString());
  });

  it('formats with zero padding so dates sort as text', () => {
    expect(formatCalendarDate(hijri(1448, 2, 13))).toBe('1448-02-13');
    expect(formatCalendarDate({ year: 2026, month: 7, day: 5, calendar: 'gregorian' })).toBe(
      '2026-07-05',
    );
  });
});
