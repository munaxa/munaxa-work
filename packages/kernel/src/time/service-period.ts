import { DomainException } from '../errors/domain-exception.js';

import { toGregorian, toHijri, toInstant, type CalendarSystem } from './calendar.js';

/**
 * Length of service, in whole years, months and days.
 *
 * End of service entitlement is banded by service length, so this calculation decides money.
 * Three rules follow from that, and all three are deliberate:
 *
 * 1. The calendar is stated, never assumed. Some labor laws compute service on the Hijri
 *    calendar, which is roughly eleven days shorter per year — over a long service that is a
 *    materially different entitlement.
 * 2. There is no "average month". Whole months are counted as calendar months, and the days are
 *    measured from the anchor date that many months after the start.
 * 3. A month-end start clamps rather than overflows: one month after 31 January is 28 February,
 *    not 3 March. Overflowing would credit an employee with days they have not served.
 */

export interface ServicePeriod {
  readonly years: number;
  readonly months: number;
  readonly days: number;
  /** Total days elapsed — what a per-day accrual multiplies. */
  readonly totalDays: number;
  readonly calendar: CalendarSystem;
}

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;
const MONTHS_PER_YEAR = 12;

const partsIn = (instant: Date, calendar: CalendarSystem): DateParts =>
  calendar === 'hijri' ? toHijri(instant) : toGregorian(instant);

const existsInCalendar = (parts: DateParts, calendar: CalendarSystem): boolean => {
  try {
    const instant = toInstant({ ...parts, calendar });
    const actual = partsIn(instant, calendar);
    return actual.year === parts.year && actual.month === parts.month && actual.day === parts.day;
  } catch {
    return false;
  }
};

/**
 * The last day of a month. Gregorian months are known; Hijri months are 29 or 30 days and not
 * formulaic, so the calendar itself is asked rather than a formula applied.
 */
const lastDayOfMonth = (year: number, month: number, calendar: CalendarSystem): number => {
  if (calendar === 'gregorian') {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  return existsInCalendar({ year, month, day: 30 }, 'hijri') ? 30 : 29;
};

/** Adds whole months, clamping the day to the end of the target month. */
const addMonths = (start: DateParts, months: number, calendar: CalendarSystem): Date => {
  const absoluteMonth = start.year * MONTHS_PER_YEAR + (start.month - 1) + months;
  const year = Math.floor(absoluteMonth / MONTHS_PER_YEAR);
  const month = (absoluteMonth % MONTHS_PER_YEAR) + 1;
  const day = Math.min(start.day, lastDayOfMonth(year, month, calendar));

  return toInstant({ year, month, day, calendar });
};

const daysBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY);

/**
 * Computes service between two instants, inclusive of the start and exclusive of the end.
 *
 * `to` is required rather than defaulting to now: a service period computed against an implicit
 * clock is untestable, and it drifts between the calculation and the payslip that quotes it.
 */
export const serviceBetween = (
  from: Date,
  to: Date,
  calendar: CalendarSystem = 'gregorian',
): ServicePeriod => {
  if (to.getTime() < from.getTime()) {
    throw new DomainException(
      'service_period_reversed',
      'Service cannot end before it starts. Check the joining and leaving dates.',
    );
  }

  const start = partsIn(from, calendar);
  const end = partsIn(to, calendar);

  let wholeMonths =
    (end.year - start.year) * MONTHS_PER_YEAR +
    (end.month - start.month) +
    (end.day < start.day ? -1 : 0);
  if (wholeMonths < 0) wholeMonths = 0;

  // Measuring from the anchor — the date `wholeMonths` after the start — is what makes a
  // month-end start correct: the remainder is real elapsed days, never a borrowed month length.
  const anchor = addMonths(start, wholeMonths, calendar);
  const days = daysBetween(anchor, to);

  return {
    years: Math.floor(wholeMonths / MONTHS_PER_YEAR),
    months: wholeMonths % MONTHS_PER_YEAR,
    days,
    totalDays: daysBetween(from, to),
    calendar,
  };
};

/** `03y - 08m - 26d`, the form employees recognize from a service card. */
export const formatServicePeriod = (period: ServicePeriod): string =>
  `${String(period.years).padStart(2, '0')}y - ${String(period.months).padStart(2, '0')}m - ${String(period.days).padStart(2, '0')}d`;
