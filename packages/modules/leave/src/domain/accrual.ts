import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { addDays, daysBetween } from './leave-year.js';
import type { AccrualSettings } from './leave-policy-settings.js';

/**
 * How much entitlement a period produces, as a pure function.
 *
 * No clock, no database, no randomness. Every fact it needs is an argument, which is what lets the
 * whole accrual model be tested against a table of cases and what makes a run **reproducible**: the
 * same employment, the same policy version and the same period give the same minutes in 2029 as
 * they did in 2026, which is the property an employee disputing their balance is entitled to.
 *
 * **No statutory formula is implemented here.** Not one. `accrualAmountMinutes` is whatever the
 * tenant or the country pack configured, and `service_band` resolves its amount through the kernel
 * rule engine *before* this function is called — so the bands are data the pack supplies and this
 * file never learns what they are. Twenty-one days after five years is Jordanian law, not this
 * product's opinion (§22).
 *
 * **Minutes are floored, and the remainder is not lost — it is simply not granted this period.**
 * Rounding up would grant time nobody configured; rounding to nearest would grant it half the time,
 * which is worse because it is harder to notice. A policy that wants exact thirds of a day should
 * configure a period that divides evenly, and the figure it produces is the figure it produces.
 */

/** What the accrual needs to know about the employment and the period. */
export interface AccrualFacts {
  /** The employment's start date. Used by `hire_date` proration and by nothing else. */
  readonly employmentStartDate: string;
  /** The period being accrued for, inclusive of both ends. */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** The leave year the entitlement belongs to. */
  readonly leaveYearStart: string;
  readonly leaveYearEnd: string;
  /**
   * The amount a `service_band` rule resolved to, in minutes.
   *
   * Resolved by the application through `evaluateRule`, because a rule engine needs facts and a
   * trace and this function is deliberately incapable of either. Absent means no band matched.
   */
  readonly bandMinutes?: number;
}

export interface AccrualOutcome {
  readonly minutes: number;
  /** How the figure was reached, in terms a screen can render beside it. */
  readonly basis: string;
  /** The whole periods the amount was multiplied by, before proration. */
  readonly periods: number;
  /** The proration applied, as a fraction expressed in parts per ten thousand. Exact, not a float. */
  readonly prorationBasisPoints: number;
}

const DAYS_PER_WEEK = 7;
const BASIS_POINTS = 10_000;
/** An average month, used only to count whole monthly periods. Never used to date-shift anything. */
const DAYS_PER_MONTH = 30;

export const accrue = (
  settings: AccrualSettings,
  facts: AccrualFacts,
): LeaveResult<AccrualOutcome> => {
  if (facts.periodEnd < facts.periodStart) return refuse('period_ends_before_it_begins');
  if (settings.accrualMethod === 'none') {
    return accept({ minutes: 0, basis: 'none', periods: 0, prorationBasisPoints: BASIS_POINTS });
  }

  const amount = amountFor(settings, facts);

  if (amount === undefined) return refuse('accrual_band_did_not_match');

  const periods = periodsIn(settings, facts);
  const proration = prorationFor(settings, facts);
  const gross = amount * periods;

  return accept({
    minutes: Math.floor((gross * proration) / BASIS_POINTS),
    basis: settings.accrualMethod,
    periods,
    prorationBasisPoints: proration,
  });
};

/**
 * The amount one period produces.
 *
 * For `service_band` it is whatever the rule resolved to; for everything else it is the policy's
 * configured figure. A band that matched nothing returns `undefined` and the run refuses that
 * employment rather than granting zero — because "no band applies to this person" is a
 * configuration gap somebody needs to see, not a silent nil entitlement.
 */
const amountFor = (settings: AccrualSettings, facts: AccrualFacts): number | undefined =>
  settings.accrualMethod === 'service_band' ? facts.bandMinutes : settings.accrualAmountMinutes;

/**
 * How many whole periods the range contains.
 *
 * `annual` and `front_loaded` are both once per leave year — the difference between them is *when*
 * the entitlement appears, which is the run's schedule rather than this function's arithmetic. A
 * front-loaded policy is run once at the year start; an annual one may be run at the end. Both
 * produce one period's worth.
 */
const periodsIn = (settings: AccrualSettings, facts: AccrualFacts): number => {
  const days = daysBetween(facts.periodStart, addDays(facts.periodEnd, 1));

  if (settings.accrualMethod === 'weekly') return Math.floor(days / DAYS_PER_WEEK);
  if (settings.accrualMethod === 'monthly') return Math.floor(days / DAYS_PER_MONTH);
  return 1;
};

/**
 * The fraction of the period the employment was actually in, in basis points.
 *
 * Basis points rather than a float, so the arithmetic stays integer all the way to the floor at the
 * end. A float here would put 0.30000000000000004 into somebody's leave balance.
 *
 * - `none` — the period counts in full or not at all.
 * - `hire_date` — somebody who joined halfway through the period accrues half of it. This is the
 *   one that matters for a mid-year joiner, and getting it wrong over-grants on day one.
 * - `calendar_month` — the same computation against the period, kept distinct because a tenant may
 *   prorate a mid-month joiner by month rather than by day and the two give different answers.
 */
const prorationFor = (settings: AccrualSettings, facts: AccrualFacts): number => {
  if (settings.prorationBasis === 'none') return BASIS_POINTS;
  if (facts.employmentStartDate <= facts.periodStart) return BASIS_POINTS;
  if (facts.employmentStartDate > facts.periodEnd) return 0;

  const total = daysBetween(facts.periodStart, addDays(facts.periodEnd, 1));
  const served = daysBetween(facts.employmentStartDate, addDays(facts.periodEnd, 1));

  if (total <= 0) return 0;

  return Math.floor((served * BASIS_POINTS) / total);
};
