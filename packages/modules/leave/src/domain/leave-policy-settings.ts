import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import {
  ACCRUAL_METHODS,
  CARRY_OVER_METHODS,
  DURATION_BASES,
  LEAVE_YEAR_CALENDARS,
  MINUTES_IN_DAY,
  PRORATION_BASES,
  type AccrualMethod,
  type CarryOverMethod,
  type DurationBasis,
  type LeaveYearCalendar,
  type ProrationBasis,
} from './leave-vocabulary.js';

/**
 * A policy version's settings, in four groups, each validated on its own.
 *
 * Split out of `leave-policy.ts` because a policy version carries thirty-odd configurable fields
 * and one function validating all of them would exceed both the complexity budget and any
 * reviewer's patience. The groups are the ones a person configuring a policy thinks in: what is
 * allowed, how entitlement is produced, what survives the year end, and when the year turns.
 *
 * **Every default here is inert.** No minimum service, no notice period, no cap, no accrual and no
 * carry-over. A policy created with no settings at all permits leave with no limits and grants no
 * entitlement — which is a policy that does nothing rather than a policy that quietly implements
 * somebody's labour law (§22).
 */

/** What a request must satisfy. Every bound is optional and null means "not limited". */
export interface LimitSettings {
  readonly minimumServiceMonths: number;
  readonly availableDuringProbation: boolean;
  readonly maximumConsecutiveMinutes?: number;
  readonly maximumPerRequestMinutes?: number;
  readonly maximumPerYearMinutes?: number;
  readonly minimumNoticeDays: number;
  readonly maximumBackdateDays: number;
  readonly hourlyPermitted: boolean;
  readonly hourlyMinimumMinutes?: number;
  readonly hourlyMaximumPerDayMinutes?: number;
  readonly hourlyMaximumPerMonthMinutes?: number;
  readonly halfDayPermitted: boolean;
  readonly durationBasis: DurationBasis;
  /**
   * How far below zero a balance may go. `0` prohibits it, `N` is a floor, **absent is unlimited**.
   *
   * Three states rather than two because "no limit configured" and "limit of zero" are different
   * policies, and collapsing them would make an unconfigured policy silently prohibit something.
   */
  readonly negativeBalanceLimitMinutes?: number;
  readonly attachmentRequiredBeyondMinutes?: number;
}

export interface AccrualSettings {
  readonly accrualMethod: AccrualMethod;
  readonly accrualAmountMinutes: number;
  readonly prorationBasis: ProrationBasis;
}

export interface CarryOverSettings {
  readonly carryOverMethod: CarryOverMethod;
  readonly carryOverCapMinutes?: number;
  readonly carryOverCapPercent?: number;
  readonly carryOverExpiryMonths?: number;
}

export interface LeaveYearSettings {
  readonly leaveYearCalendar: LeaveYearCalendar;
  readonly leaveYearStartMonth: number;
  readonly leaveYearStartDay: number;
}

/** A year of minutes. Any cap beyond this is a configuration mistake rather than a policy. */
const MAX_POLICY_MINUTES = MINUTES_IN_DAY * 366;
const MAX_MONTHS = 600;
const MAX_DAYS = 3650;
const MAX_PERCENT = 100;
const MONTHS_IN_YEAR = 12;
const MAX_DAY_OF_MONTH = 31;

export const checkedLimits = (input: Partial<LimitSettings>): LeaveResult<LimitSettings> => {
  const basis = input.durationBasis ?? 'working_days';

  if (!isDurationBasis(basis)) return refuse('duration_basis_unknown', { basis });

  const bounded = boundedMinutes(input);

  if (!bounded.ok) return bounded;

  const counts = boundedCounts(input);

  if (!counts.ok) return counts;

  return accept({
    availableDuringProbation: input.availableDuringProbation ?? true,
    hourlyPermitted: input.hourlyPermitted ?? false,
    halfDayPermitted: input.halfDayPermitted ?? false,
    durationBasis: basis,
    ...counts.value,
    ...bounded.value,
  });
};

/** The optional minute caps, all checked the same way and all absent by default. */
const MINUTE_FIELDS = [
  'maximumConsecutiveMinutes',
  'maximumPerRequestMinutes',
  'maximumPerYearMinutes',
  'hourlyMinimumMinutes',
  'hourlyMaximumPerDayMinutes',
  'hourlyMaximumPerMonthMinutes',
  'negativeBalanceLimitMinutes',
  'attachmentRequiredBeyondMinutes',
] as const;

type MinuteField = (typeof MINUTE_FIELDS)[number];

const boundedMinutes = (
  input: Partial<LimitSettings>,
): LeaveResult<Partial<Record<MinuteField, number>>> => {
  const present: Record<string, number> = {};

  for (const field of MINUTE_FIELDS) {
    const value = input[field];

    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > MAX_POLICY_MINUTES) {
      return refuse('minutes_out_of_range', { field });
    }
    present[field] = value;
  }
  return accept(present);
};

const boundedCounts = (
  input: Partial<LimitSettings>,
): LeaveResult<{
  readonly minimumServiceMonths: number;
  readonly minimumNoticeDays: number;
  readonly maximumBackdateDays: number;
}> => {
  const months = input.minimumServiceMonths ?? 0;
  const notice = input.minimumNoticeDays ?? 0;
  const backdate = input.maximumBackdateDays ?? 0;

  if (!withinCount(months, MAX_MONTHS)) {
    return refuse('count_out_of_range', { field: 'minimumServiceMonths' });
  }
  if (!withinCount(notice, MAX_DAYS)) {
    return refuse('count_out_of_range', { field: 'minimumNoticeDays' });
  }
  if (!withinCount(backdate, MAX_DAYS)) {
    return refuse('count_out_of_range', { field: 'maximumBackdateDays' });
  }
  return accept({
    minimumServiceMonths: months,
    minimumNoticeDays: notice,
    maximumBackdateDays: backdate,
  });
};

/**
 * How entitlement is produced.
 *
 * `service_band` carries no bands here: they are a `RuleDefinition` on the policy, evaluated by the
 * kernel engine. That is the whole extension point — a country pack supplies the bands as data and
 * this module never learns what they are (§22).
 */
export const checkedAccrual = (input: Partial<AccrualSettings>): LeaveResult<AccrualSettings> => {
  const method = input.accrualMethod ?? 'none';
  const proration = input.prorationBasis ?? 'none';
  const amount = input.accrualAmountMinutes ?? 0;

  if (!isAccrualMethod(method)) return refuse('accrual_method_unknown', { method });
  if (!isProrationBasis(proration)) return refuse('proration_basis_unknown', { basis: proration });
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_POLICY_MINUTES) {
    return refuse('minutes_out_of_range', { field: 'accrualAmountMinutes' });
  }
  return accept({
    accrualMethod: method,
    accrualAmountMinutes: amount,
    prorationBasis: proration,
  });
};

/**
 * What survives the year end.
 *
 * A cap that does not match its method is refused rather than ignored: `capped_minutes` with no cap
 * would carry everything over, which is the opposite of what whoever configured it meant.
 */
export const checkedCarryOver = (
  input: Partial<CarryOverSettings>,
): LeaveResult<CarryOverSettings> => {
  const method = input.carryOverMethod ?? 'none';

  if (!isCarryOverMethod(method)) return refuse('carry_over_method_unknown', { method });

  const caps = checkedCaps(input);

  if (!caps.ok) return caps;

  const missing = capMissingFor(method, caps.value);

  if (missing) return refuse('carry_over_cap_missing', { method });

  return accept({ carryOverMethod: method, ...caps.value });
};

/**
 * A capped method with no cap.
 *
 * Refused rather than ignored: `capped_minutes` with no cap would carry everything over, which is
 * the opposite of what whoever configured it meant.
 */
const capMissingFor = (
  method: CarryOverMethod,
  caps: Omit<CarryOverSettings, 'carryOverMethod'>,
): boolean =>
  (method === 'capped_minutes' && caps.carryOverCapMinutes === undefined) ||
  (method === 'capped_percent' && caps.carryOverCapPercent === undefined);

const checkedCaps = (
  input: Partial<CarryOverSettings>,
): LeaveResult<Omit<CarryOverSettings, 'carryOverMethod'>> => {
  const minutes = input.carryOverCapMinutes;

  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 0)) {
    return refuse('minutes_out_of_range', { field: 'carryOverCapMinutes' });
  }

  const bounded = checkedCapCounts(input);

  if (!bounded.ok) return bounded;

  return accept({
    ...(minutes === undefined ? {} : { carryOverCapMinutes: minutes }),
    ...bounded.value,
  });
};

const checkedCapCounts = (
  input: Partial<CarryOverSettings>,
): LeaveResult<{
  readonly carryOverCapPercent?: number;
  readonly carryOverExpiryMonths?: number;
}> => {
  const percent = input.carryOverCapPercent;
  const expiry = input.carryOverExpiryMonths;

  if (percent !== undefined && !withinCount(percent, MAX_PERCENT)) {
    return refuse('count_out_of_range', { field: 'carryOverCapPercent' });
  }
  if (expiry !== undefined && !withinCount(expiry, MAX_MONTHS)) {
    return refuse('count_out_of_range', { field: 'carryOverExpiryMonths' });
  }
  return accept({
    ...(percent === undefined ? {} : { carryOverCapPercent: percent }),
    ...(expiry === undefined ? {} : { carryOverExpiryMonths: expiry }),
  });
};

/**
 * When the leave year turns, and in which calendar it is reckoned.
 *
 * The default is the first of January in the Gregorian calendar, which is a *starting point a
 * tenant will change*, not a statutory claim. The Hijri case is a real one in this product's
 * markets and the conversion is the kernel's; no Hijri arithmetic exists in this module.
 */
export const checkedLeaveYear = (
  input: Partial<LeaveYearSettings>,
): LeaveResult<LeaveYearSettings> => {
  const calendar = input.leaveYearCalendar ?? 'gregorian';
  const month = input.leaveYearStartMonth ?? 1;
  const day = input.leaveYearStartDay ?? 1;

  if (!isLeaveYearCalendar(calendar)) return refuse('leave_year_calendar_unknown', { calendar });
  if (!within(month, 1, MONTHS_IN_YEAR)) {
    return refuse('count_out_of_range', { field: 'leaveYearStartMonth' });
  }
  if (!within(day, 1, MAX_DAY_OF_MONTH)) {
    return refuse('count_out_of_range', { field: 'leaveYearStartDay' });
  }
  return accept({
    leaveYearCalendar: calendar,
    leaveYearStartMonth: month,
    leaveYearStartDay: day,
  });
};

const within = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

const withinCount = (value: number, max: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= max;

const isDurationBasis = (value: string): value is DurationBasis =>
  (DURATION_BASES as readonly string[]).includes(value);

const isAccrualMethod = (value: string): value is AccrualMethod =>
  (ACCRUAL_METHODS as readonly string[]).includes(value);

const isProrationBasis = (value: string): value is ProrationBasis =>
  (PRORATION_BASES as readonly string[]).includes(value);

const isCarryOverMethod = (value: string): value is CarryOverMethod =>
  (CARRY_OVER_METHODS as readonly string[]).includes(value);

const isLeaveYearCalendar = (value: string): value is LeaveYearCalendar =>
  (LEAVE_YEAR_CALENDARS as readonly string[]).includes(value);
