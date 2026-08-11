import { toHijri, type CalendarDate } from '@work/kernel';

import { isCivilDate, type ExpiryState } from './documents-vocabulary.js';
import { accept, refuse, type DocumentsResult } from './documents-rejection.js';

/**
 * How a document stands against its expiry date, **derived and never stored**.
 *
 * A materialized `expired` column needs something to move it from `valid` on the right morning.
 * `JobPort` has no adapter anywhere in this repository, so nothing scheduled runs — and a stored
 * flag that nothing maintains is worse than no flag, because a screen would show `valid` for a
 * permit that lapsed in March and everybody would believe it.
 *
 * So `expiry_date` is the only fact, and the state is a function of it and today. The expiry queue
 * is then an indexed predicate over a date, which is both correct at every instant and the fastest
 * thing this module can do (§12 of the plan).
 *
 * **Expiry is state, never deletion.** Nothing here removes a document, and nothing may: an expired
 * work permit is the single most operationally urgent record a tenant holds, and deleting it would
 * destroy the evidence that it lapsed.
 */

/** Days before expiry at which a document is already worth looking at. */
export interface ExpiryWindow {
  readonly today: string;
  readonly noticeDays: readonly number[];
}

export const expiryStateOf = (
  expiryDate: string | undefined,
  window: ExpiryWindow,
): ExpiryState => {
  if (expiryDate === undefined) return 'no_expiry';
  if (expiryDate < window.today) return 'expired';

  const widest = window.noticeDays.length === 0 ? 0 : Math.max(...window.noticeDays);

  return expiryDate <= addDays(window.today, widest) ? 'expiring_soon' : 'valid';
};

/**
 * Which configured threshold a document has crossed, or nothing.
 *
 * Returned rather than acted on. The thresholds are configuration and this module records that a
 * warning is *due*; **nothing sends one**, because there is no scheduler and no notification
 * delivery in this repository. A screen reads this; nobody's inbox does (D-26).
 */
export const noticeThresholdCrossed = (
  expiryDate: string | undefined,
  window: ExpiryWindow,
): number | undefined => {
  if (expiryDate === undefined || expiryDate < window.today) return undefined;

  // Descending, so a document 20 days out reports the 30-day threshold rather than the 90-day one.
  const crossed = [...window.noticeDays]
    .sort((one, other) => one - other)
    .find((days) => expiryDate <= addDays(window.today, days));

  return crossed;
};

/** Adds whole days to a civil date in UTC. A calendar day, never an instant in a time zone. */
export const addDays = (civilDate: string, days: number): string => {
  const at = new Date(`${civilDate}T00:00:00Z`);

  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/**
 * The same civil date in both calendars.
 *
 * The 4.1 acceptance criteria require issue and expiry in both, and the kernel already converts
 * (`toHijri`). **Derived rather than stored**: two stored dates are two things that can disagree,
 * and the Gregorian date is the one a database index can answer an expiry query against (D-28).
 *
 * The conversion is the kernel's arithmetic one. Where a jurisdiction observes a sighted Hijri
 * calendar that differs from it, that is country-pack content this product does not ship, and the
 * difference is a limitation rather than something approximated here (00B).
 */
export interface DualCalendarDate {
  readonly gregorian: string;
  readonly hijri: CalendarDate;
}

export const inBothCalendars = (civilDate: string): DocumentsResult<DualCalendarDate> => {
  if (!isCivilDate(civilDate)) return refuse('date_malformed', { field: 'date' });

  return accept({
    gregorian: civilDate,
    hijri: toHijri(new Date(`${civilDate}T00:00:00Z`)),
  });
};
