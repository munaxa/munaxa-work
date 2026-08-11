import { fromHijri, toHijri, type CalendarDate } from '@work/kernel';

import type { LeaveYearSettings } from './leave-policy-settings.js';

/**
 * Which leave year a date falls in.
 *
 * A leave year is the bucket every entitlement, every ledger entry and every balance belongs to,
 * and getting its boundary wrong moves somebody's entitlement into the wrong year — where it either
 * expires early or never expires at all. So the boundary is computed in one place, from the policy
 * version's own configuration, and never inferred from a calendar year.
 *
 * **The Hijri case is a real one, not a display preference.** A Hijri leave year is about eleven
 * days shorter than a Gregorian one, so entitlement resets on a different Gregorian date each year
 * — which is precisely why the calendar cannot be a formatting choice made at the edge. The
 * conversion is the kernel's Umm al-Qura implementation (`toHijri`/`fromHijri`, ICU-backed,
 * authoritative between 1900 and 2100). **No Hijri arithmetic exists in this module**, and the one
 * piece of arithmetic performed on a Hijri date — adding a year to find the next start — is done in
 * Hijri fields and converted back, never by adding 354 days to an instant.
 *
 * Everything here is **pure**: no clock, no database. The date is supplied.
 */

export interface LeaveYear {
  /** The first civil date of the year. This is the bucket key everything else is stored against. */
  readonly start: string;
  /** The last civil date of the year, inclusive. */
  readonly end: string;
}

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * The leave year containing `onDate`, under this policy's configuration.
 *
 * Inclusive of both ends, because a leave year that ended the day before the next one began would
 * leave one date belonging to neither — and somebody would eventually take leave on it.
 */
export const leaveYearFor = (settings: LeaveYearSettings, onDate: string): LeaveYear =>
  settings.leaveYearCalendar === 'hijri'
    ? hijriYearFor(settings, onDate)
    : gregorianYearFor(settings, onDate);

/** The leave year immediately after the one given. Used to close a year and open the next. */
export const nextLeaveYear = (settings: LeaveYearSettings, year: LeaveYear): LeaveYear =>
  leaveYearFor(settings, addDays(year.end, 1));

/**
 * The Gregorian case.
 *
 * The start day is **clamped rather than rolled**: a policy whose year starts on the 31st in a
 * thirty-day month starts on the 30th, not on the 1st of the next month. Rolling would move the
 * whole year forward and change which year a date belongs to.
 */
const gregorianYearFor = (settings: LeaveYearSettings, onDate: string): LeaveYear => {
  const [year] = parts(onDate);
  const thisYear = clampedStart(year, settings);
  const start = onDate >= thisYear ? thisYear : clampedStart(year - 1, settings);
  const end = addDays(clampedStart(yearOf(start) + 1, settings), -1);

  return { start, end };
};

const clampedStart = (year: number, settings: LeaveYearSettings): string => {
  const lastDay = daysInMonth(year, settings.leaveYearStartMonth);
  const day = Math.min(settings.leaveYearStartDay, lastDay);

  return civil(year, settings.leaveYearStartMonth, day);
};

/**
 * The Hijri case, computed in Hijri fields and converted back to civil dates.
 *
 * The candidate start is built in the Hijri year the date falls in; if the date is before it, the
 * previous Hijri year is used. The end is the day before the next year's start, so no date falls
 * between two leave years however the conversion rounds.
 */
const hijriYearFor = (settings: LeaveYearSettings, onDate: string): LeaveYear => {
  const hijri = toHijri(instantOf(onDate));
  const candidate = hijriStart(hijri.year, settings);
  const start = onDate >= candidate ? candidate : hijriStart(hijri.year - 1, settings);
  const startYear = toHijri(instantOf(start)).year;
  const end = addDays(hijriStart(startYear + 1, settings), -1);

  return { start, end };
};

/**
 * A Hijri year's start as a civil date.
 *
 * The day is clamped to 29 — the shortest a Hijri month can be — rather than probed, because
 * `fromHijri` on a day the month does not have would land in the next month and silently move the
 * whole leave year.
 */
const HIJRI_SHORTEST_MONTH = 29;

const hijriStart = (hijriYear: number, settings: LeaveYearSettings): string => {
  const date: CalendarDate = {
    year: hijriYear,
    month: settings.leaveYearStartMonth,
    day: Math.min(settings.leaveYearStartDay, HIJRI_SHORTEST_MONTH),
    calendar: 'hijri',
  };

  return isoOf(fromHijri(date));
};

/** Civil-date arithmetic through UTC midnight, which is how every module here converts a date. */
export const addDays = (onDate: string, days: number): string =>
  isoOf(new Date(instantOf(onDate).getTime() + days * MILLISECONDS_PER_DAY));

/** Every civil date from `from` to `to`, inclusive. Bounded by the caller, never by this function. */
export const datesBetween = (from: string, to: string): readonly string[] => {
  const dates: string[] = [];

  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
};

/** Whole days from one civil date to another. Never negative when `to` is the later date. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((instantOf(to).getTime() - instantOf(from).getTime()) / MILLISECONDS_PER_DAY);

export const instantOf = (onDate: string): Date => new Date(`${onDate}T00:00:00.000Z`);

export const isoOf = (instant: Date): string => instant.toISOString().slice(0, 10);

const parts = (onDate: string): readonly [number, number, number] => {
  const [year = '0', month = '1', day = '1'] = onDate.split('-');
  return [Number(year), Number(month), Number(day)];
};

const yearOf = (onDate: string): number => parts(onDate)[0];

const civil = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
