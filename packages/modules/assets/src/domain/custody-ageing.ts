import type { CustodyRecord } from './custody.js';

/**
 * How long a custody has run — **computed, never stored**.
 *
 * A `days_outstanding` column would be correct on the day it was written and wrong every day after it,
 * which is ADR-0070's *"a stored flag that nothing maintains is worse than no flag"* applied to a
 * number. So nothing here persists: `issued_on` and `returned_on` are already on the row, and the
 * elapsed days are arithmetic over them.
 *
 * **The date this is measured against is passed in.** There is no clock in this file. A figure whose
 * `asAt` was decided somewhere the caller could not see is a figure nobody can reproduce, and every
 * read that publishes one echoes the date it used.
 *
 * **This is elapsed time and nothing more.** It is not *overdue*: `asset_custody` records no expected
 * return, so overdue cannot be computed and is not claimed. It is not a business-state transition —
 * reading a custody's age changes nothing and asserts nothing about clearance, liability or deduction.
 * And it says nothing about the employment: a custody held by an employment that has ended ages exactly
 * like one held by an active employment, which is what keeps this read from quietly answering D-5.3-01.
 */

export interface CustodyAgeing {
  /**
   * Whole days from issue to `asAt`, for a custody that is still open.
   *
   * **Absent when `asAt` precedes the issue** — as at that date the custody had not been issued, and
   * absence is the honest answer. Clamping to zero would report that something was outstanding before
   * it happened, and a negative number would be arithmetic leaking out of a report.
   */
  readonly daysOutstanding?: number;
  /**
   * Whole days from issue to return, for a custody that has come back.
   *
   * **A closed fact**: it does not depend on `asAt` at all, and it does not move again. The custody it
   * describes is immutable at the database from the moment it closed.
   */
  readonly daysHeld?: number;
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a string is a civil date this module will measure against. */
export const isCivilDate = (value: string): boolean => CIVIL_DATE.test(value);

/**
 * The ageing of one custody as at one date.
 *
 * The day of issue is **day zero**, not day one: an asset handed over this morning has been out for no
 * days, which is what somebody reading the number expects it to mean.
 */
export const custodyAgeing = (custody: CustodyRecord, asAt: string): CustodyAgeing => {
  if (custody.state === 'returned') {
    return custody.returnedOn === undefined
      ? {}
      : { daysHeld: wholeDaysBetween(custody.issuedOn, custody.returnedOn) };
  }

  return outstandingSince(custody.issuedOn, asAt);
};

/**
 * The open case on its own, for a caller that holds an issue date rather than a whole custody.
 *
 * The clearance projection reads a join and never rehydrates a `CustodyRecord`; without this it would
 * have to invent one with empty fields to ask the question, and a fake built only to satisfy a
 * signature is the kind of thing that later gets returned to somebody by accident.
 */
export const outstandingSince = (issuedOn: string, asAt: string): CustodyAgeing => {
  const days = wholeDaysBetween(issuedOn, asAt);

  return days < 0 ? {} : { daysOutstanding: days };
};

/**
 * An instant reduced to the civil date it falls on, in UTC.
 *
 * The one place a clock reading becomes a day, so the command that refuses a future issue date and the
 * read that ages a custody cannot disagree about which day it is.
 *
 * The same stated limitation every module before this one carries: near midnight far from UTC the
 * server's day may differ from the tenant's by one.
 */
export const civilDateOf = (instant: Date): string => instant.toISOString().slice(0, 10);

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Whole days from one civil date to another.
 *
 * **Over UTC midnights**, so no timezone and no daylight-saving boundary can move the answer by a day.
 * A civil date in this module is a day in the tenant's world rather than an instant, and parsing one as
 * a local time is how a report comes out a day short for half the year.
 */
export const wholeDaysBetween = (from: string, to: string): number =>
  (utcMidnightOf(to) - utcMidnightOf(from)) / MILLISECONDS_PER_DAY;

const utcMidnightOf = (civilDate: string): number => {
  const [year, month, day] = civilDate.split('-').map(Number);

  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
};
