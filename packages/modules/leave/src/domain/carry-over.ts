import { accept, type LeaveResult } from './leave-rejection.js';
import type { CarryOverSettings } from './leave-policy-settings.js';

/**
 * What survives a leave year, and what expires afterwards.
 *
 * Both are pure functions over a closing balance and a policy version — no clock, no database — for
 * the same reason accrual is: closing a year is a bounded, restartable run, and a run that could
 * not be re-derived would be a run nobody could safely retry.
 *
 * **Carry-over is a pair of ledger entries, not a mutation.** `carry_out` (negative) against the
 * closing year and `carry_in` (positive) against the opening one, written by one idempotent command
 * in a single transaction. The pair is what makes the movement auditable in *both* years — a single
 * entry would leave one year's sum unexplained, and somebody would eventually ask which.
 *
 * **Lapsing and expiry are different, deliberately.** Entitlement that simply does not carry over
 * produces a `carry_out` with no matching `carry_in`; carried-over leave that runs out of time
 * produces an `expiry` entry months later. They are different rows and different reports, and
 * calling both "expiry" would make it impossible to answer how much leave a policy actually
 * discards at the year end (§17).
 */

export interface CarryOverOutcome {
  /** What leaves the closing year. Positive here; the ledger entry is written negative. */
  readonly carriedOutMinutes: number;
  /** What arrives in the opening year. Never more than what left. */
  readonly carriedInMinutes: number;
  /** What the closing year discards — the difference, and the figure a year-end report needs. */
  readonly lapsedMinutes: number;
  readonly basis: string;
}

/**
 * The carry-over a closing balance produces.
 *
 * A negative or zero closing balance carries nothing: a policy that permitted somebody to go into
 * deficit does not thereby carry the deficit forward into next year, which would compound a
 * permission granted once into a permanent one.
 *
 * `capped_percent` is a percentage **of the closing balance**, not of the entitlement. The
 * alternative reading — a percentage of what was granted — would carry over more than remains for
 * anybody who took most of their leave, which is not a thing any policy means.
 */
export const carryOverFor = (
  settings: CarryOverSettings,
  closingBalanceMinutes: number,
): LeaveResult<CarryOverOutcome> => {
  const available = Math.max(0, closingBalanceMinutes);

  if (settings.carryOverMethod === 'none' || available === 0) {
    return accept(outcome(available, 0, settings.carryOverMethod));
  }
  if (settings.carryOverMethod === 'unlimited') {
    return accept(outcome(available, available, 'unlimited'));
  }
  if (settings.carryOverMethod === 'capped_minutes') {
    const cap = settings.carryOverCapMinutes ?? 0;
    return accept(outcome(available, Math.min(available, cap), 'capped_minutes'));
  }

  // Integer arithmetic throughout: a percentage applied as a float would put a fraction of a
  // minute into next year's opening balance, and a year of them would not sum to a whole number.
  const percent = settings.carryOverCapPercent ?? 0;
  const cap = Math.floor((available * percent) / 100);

  return accept(outcome(available, Math.min(available, cap), 'capped_percent'));
};

/**
 * When carried-over leave expires, if it does.
 *
 * Returns the civil date `carryOverExpiryMonths` after the new leave year's start, or `undefined`
 * where the policy sets no expiry. Month arithmetic is done in calendar fields and clamped to the
 * target month's length, so an expiry three months after 30 November lands on 28 February rather
 * than rolling into March.
 */
export const carryOverExpiresOn = (
  settings: CarryOverSettings,
  leaveYearStart: string,
): string | undefined => {
  if (settings.carryOverExpiryMonths === undefined || settings.carryOverExpiryMonths === 0) {
    return undefined;
  }
  return addMonths(leaveYearStart, settings.carryOverExpiryMonths);
};

/**
 * What is left of a carried-in amount when its expiry date arrives.
 *
 * The unused remainder of what was **carried in**, never more — leave accrued during the new year
 * does not expire because last year's carry-over did. Consumption is applied to the carried amount
 * first, which is the reading favourable to the employee and the one every policy that bothers to
 * say means.
 */
export const expiringMinutes = (carriedInMinutes: number, consumedSinceMinutes: number): number =>
  Math.max(0, carriedInMinutes - Math.max(0, consumedSinceMinutes));

const outcome = (available: number, carried: number, basis: string): CarryOverOutcome => ({
  carriedOutMinutes: available,
  carriedInMinutes: carried,
  lapsedMinutes: available - carried,
  basis,
});

const MONTHS_IN_YEAR = 12;

const addMonths = (onDate: string, months: number): string => {
  const [year = '0', month = '1', day = '1'] = onDate.split('-');
  const zeroBased = Number(month) - 1 + months;
  const targetYear = Number(year) + Math.floor(zeroBased / MONTHS_IN_YEAR);
  const targetMonth = ((zeroBased % MONTHS_IN_YEAR) + MONTHS_IN_YEAR) % MONTHS_IN_YEAR;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(Number(day), lastDay);

  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
};
