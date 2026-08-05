import { DomainException } from '../errors/domain-exception.js';

/**
 * Gregorian and Hijri (Umm al-Qura) conversion, implemented once (ADR-0027).
 *
 * Conversion delegates to ICU rather than to hand-written tables or an arithmetic offset. The
 * Umm al-Qura calendar is an official civil calendar with published month lengths that do not
 * follow a formula, so an arithmetic approximation is wrong by a day or two — which, for a leave
 * request or an end-of-service calculation, is a real error in someone's entitlement.
 *
 * Storage is always the underlying instant. A calendar is an input and presentation concern.
 */

export type CalendarSystem = 'gregorian' | 'hijri';

/** A date as a human states it, in a named calendar. No time, no zone. */
export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly calendar: CalendarSystem;
}

const HIJRI_LOCALE = 'en-u-ca-islamic-umalqura';
const MILLISECONDS_PER_DAY = 86_400_000;

/** Supported range. Outside it, ICU's Umm al-Qura data is not authoritative. */
const MINIMUM_YEAR = 1900;
const MAXIMUM_YEAR = 2100;

const hijriFormatter = new Intl.DateTimeFormat(HIJRI_LOCALE, {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

const utcMidnight = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

const assertSupported = (date: Date): void => {
  const year = date.getUTCFullYear();

  if (year < MINIMUM_YEAR || year > MAXIMUM_YEAR) {
    throw new DomainException(
      'calendar_out_of_range',
      `Calendar conversion is supported between ${String(MINIMUM_YEAR)} and ${String(MAXIMUM_YEAR)}; received ${String(year)}.`,
    );
  }
};

/** Converts an instant to its Hijri civil date. */
export const toHijri = (instant: Date): CalendarDate => {
  assertSupported(instant);

  const parts = new Map(
    hijriFormatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.get('year'));
  const month = Number(parts.get('month'));
  const day = Number(parts.get('day'));

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new DomainException('calendar_unavailable', 'The Umm al-Qura calendar is unavailable.');
  }
  return { year, month, day, calendar: 'hijri' };
};

/** Converts an instant to its Gregorian date. */
export const toGregorian = (instant: Date): CalendarDate => ({
  year: instant.getUTCFullYear(),
  month: instant.getUTCMonth() + 1,
  day: instant.getUTCDate(),
  calendar: 'gregorian',
});

const sameHijriDate = (instant: Date, target: CalendarDate): boolean => {
  const candidate = toHijri(instant);
  return (
    candidate.year === target.year &&
    candidate.month === target.month &&
    candidate.day === target.day
  );
};

/** Orders two Hijri dates: negative when a precedes b. */
const compareHijri = (a: CalendarDate, b: CalendarDate): number =>
  a.year !== b.year ? a.year - b.year : a.month !== b.month ? a.month - b.month : a.day - b.day;

/**
 * Converts a Hijri civil date to the instant of its Gregorian midnight.
 *
 * ICU converts forwards only, so this searches backwards: it estimates from the mean Hijri year
 * length, then binary-searches the surrounding window. The estimate is always within a few days,
 * and the search proves the answer rather than trusting the estimate.
 */
export const fromHijri = (date: CalendarDate): Date => {
  const MEAN_HIJRI_YEAR_DAYS = 354.367;
  const HIJRI_EPOCH_UTC = Date.UTC(622, 6, 19);
  const SEARCH_WINDOW_DAYS = 45;

  const estimatedDays =
    (date.year - 1) * MEAN_HIJRI_YEAR_DAYS + (date.month - 1) * 29.53 + (date.day - 1);
  const estimate = HIJRI_EPOCH_UTC + Math.round(estimatedDays) * MILLISECONDS_PER_DAY;

  let low = estimate - SEARCH_WINDOW_DAYS * MILLISECONDS_PER_DAY;
  let high = estimate + SEARCH_WINDOW_DAYS * MILLISECONDS_PER_DAY;

  while (low <= high) {
    const middle = low + Math.round((high - low) / 2 / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY;
    const candidate = new Date(middle);

    if (sameHijriDate(candidate, date)) return candidate;

    if (compareHijri(toHijri(candidate), date) < 0) {
      low = middle + MILLISECONDS_PER_DAY;
    } else {
      high = middle - MILLISECONDS_PER_DAY;
    }
  }

  throw new DomainException(
    'calendar_invalid_date',
    `${String(date.year)}-${String(date.month)}-${String(date.day)} is not a valid Hijri date.`,
  );
};

/** Converts a stated calendar date to the instant of its UTC midnight. */
export const toInstant = (date: CalendarDate): Date =>
  date.calendar === 'hijri' ? fromHijri(date) : utcMidnight(date.year, date.month, date.day);

/** Renders a calendar date as `yyyy-mm-dd`, zero padded, in whichever calendar it states. */
export const formatCalendarDate = (date: CalendarDate): string =>
  `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
