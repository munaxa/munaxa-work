import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { datesBetween } from './leave-year.js';
import {
  DAY_PORTIONS,
  MINUTES_IN_DAY,
  minutesFromMidnight,
  type DayPortion,
  type DurationBasis,
} from './leave-vocabulary.js';
import { checkedWallClock } from './leave-aggregate.js';

/**
 * How long a request actually is, worked out one civil date at a time.
 *
 * Pure: no clock, no database, no port. Everything it needs is handed to it, which is what makes
 * the whole of this module's arithmetic testable against a table of cases rather than against a
 * running Attendance module.
 *
 * **The breakdown is the answer, not a total.** A request is not "three days"; it is a set of rows
 * whose minutes sum, and the rows are what the published read returns to Attendance and what
 * conflict detection compares. A total alone could not say *which* Tuesday was excluded.
 *
 * **A date on which nothing was expected gets no row** under the `working_days` basis. That is how
 * a weekend inside a request stays visible as excluded rather than disappearing into a smaller
 * total, and it is why a screen can explain the figure.
 *
 * **Halves are floor-and-remainder, never a rounded half.** `first_half` of a 405-minute day is
 * 202 minutes and `second_half` is 203, so the two sum to exactly what was expected. Rounding both
 * to 203 would create six minutes of leave nobody granted, once per odd-length day, for ever
 * (§10.4).
 *
 * **Cross-midnight hourly leave is refused by name.** Supporting it needs the leave day to be
 * attributable to a shift rather than to a civil date, and a shift is a schedule question
 * Attendance owns (§18, §35.4).
 */

/** What the working-day basis says about one date. Supplied by Attendance's published read. */
export interface ExpectedDay {
  readonly onDate: string;
  readonly expected: boolean;
  readonly expectedMinutes: number;
  readonly zone: string;
  readonly dayKind: string;
}

/** What the caller asked for on one date. Absent means a full day. */
export interface PortionRequest {
  readonly onDate: string;
  readonly portion: DayPortion;
  readonly startLocal?: string;
  readonly endLocal?: string;
}

/** One row of the breakdown, before it is given an identity and a request to belong to. */
export interface DayDraft {
  readonly onDate: string;
  readonly portion: DayPortion;
  readonly minutes: number;
  readonly startLocal?: string;
  readonly endLocal?: string;
  readonly zone: string;
  readonly expectedMinutes: number;
}

export interface Breakdown {
  readonly days: readonly DayDraft[];
  readonly totalMinutes: number;
  /** Dates in the range that produced no row, and why. What the screen shows beside the total. */
  readonly excluded: readonly { readonly onDate: string; readonly reason: string }[];
}

export interface BreakdownInput {
  readonly fromDate: string;
  readonly toDate: string;
  readonly basis: DurationBasis;
  readonly expectations: readonly ExpectedDay[];
  readonly portions: readonly PortionRequest[];
  /**
   * A day's length for a date the working pattern says nothing about, used **only** under the
   * `calendar_days` basis.
   *
   * Derived by the application from the employment's contracted hours. Absent means there is no
   * basis for a day's length, and the calculation refuses by name rather than inventing eight hours
   * — which would be a labour-relations decision for a customer who never asked (§18).
   */
  readonly standardDayMinutes?: number;
  readonly halfDayPermitted: boolean;
  readonly hourlyPermitted: boolean;
}

/** How many dates one request may span. A bound so a mis-keyed year cannot produce 365 rows. */
const MAX_SPAN_DAYS = 400;

export const breakdownOf = (input: BreakdownInput): LeaveResult<Breakdown> => {
  const dates = datesBetween(input.fromDate, input.toDate);

  if (dates.length === 0) return refuse('period_ends_before_it_begins');
  if (dates.length > MAX_SPAN_DAYS) {
    return refuse('request_spans_too_many_days', { days: String(dates.length) });
  }

  const requested = new Map(input.portions.map((portion) => [portion.onDate, portion]));
  const expectations = new Map(input.expectations.map((day) => [day.onDate, day]));
  const days: DayDraft[] = [];
  const excluded: { onDate: string; reason: string }[] = [];

  for (const onDate of dates) {
    const drafted = draftFor(onDate, { input, requested, expectations });

    if (!drafted.ok) return drafted;
    if (drafted.value === undefined) {
      excluded.push({ onDate, reason: exclusionReason(expectations.get(onDate)) });
      continue;
    }
    days.push(drafted.value);
  }

  if (days.length === 0) return refuse('request_covers_no_working_date');

  return accept({
    days,
    totalMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
    excluded,
  });
};

interface DraftContext {
  readonly input: BreakdownInput;
  readonly requested: ReadonlyMap<string, PortionRequest>;
  readonly expectations: ReadonlyMap<string, ExpectedDay>;
}

/**
 * One date's row, or nothing where the date is not covered.
 *
 * `undefined` rather than a zero-minute row: a row of zero minutes would satisfy the overlap
 * constraint and block the date for every other request, which is exactly wrong for a weekend.
 */
const draftFor = (onDate: string, context: DraftContext): LeaveResult<DayDraft | undefined> => {
  const expectation = context.expectations.get(onDate);
  const length = dayLength(expectation, context.input);

  if (length === undefined) return accept(undefined);

  const asked = context.requested.get(onDate) ?? { onDate, portion: 'full_day' as DayPortion };

  if (!isDayPortion(asked.portion))
    return refuse('day_portion_unknown', { portion: asked.portion });

  return minutesFor(asked, length, context.input);
};

/**
 * How long the date is, under the configured basis.
 *
 * Under `working_days`, a date the pattern did not expect has no length and therefore no row.
 * Under `calendar_days`, every date has one: the expected minutes where the pattern knows, and the
 * standard day otherwise. `undefined` from the second case is the refusal path, not a silent zero.
 */
const dayLength = (
  expectation: ExpectedDay | undefined,
  input: BreakdownInput,
): DayLength | undefined => {
  const worked = workedLength(expectation);

  if (worked !== undefined) return worked;
  if (input.basis === 'working_days') return undefined;
  if (input.standardDayMinutes === undefined || input.standardDayMinutes <= 0) return undefined;

  return { minutes: input.standardDayMinutes, zone: expectation?.zone ?? 'UTC' };
};

interface DayLength {
  readonly minutes: number;
  readonly zone: string;
}

/** What the working pattern expected on this date, or nothing where it expected nothing. */
const workedLength = (expectation: ExpectedDay | undefined): DayLength | undefined =>
  expectation !== undefined && expectation.expected && expectation.expectedMinutes > 0
    ? { minutes: expectation.expectedMinutes, zone: expectation.zone }
    : undefined;

const minutesFor = (
  asked: PortionRequest,
  length: DayLength,
  input: BreakdownInput,
): LeaveResult<DayDraft> => {
  const base = {
    onDate: asked.onDate,
    zone: length.zone,
    expectedMinutes: length.minutes,
  };

  if (asked.portion === 'full_day') {
    return accept({ ...base, portion: 'full_day', minutes: length.minutes });
  }
  if (asked.portion === 'hours') return hourlyDraft(asked, base, input);
  if (!input.halfDayPermitted) return refuse('half_day_not_permitted');

  // Floor for the first half and the remainder for the second, so the two sum to the whole day
  // exactly. A day of 405 expected minutes is 202 and 203, never 203 and 203.
  const first = Math.floor(length.minutes / 2);
  const minutes = asked.portion === 'first_half' ? first : length.minutes - first;

  if (minutes <= 0) return refuse('half_day_is_no_time_at_all');

  return accept({ ...base, portion: asked.portion, minutes });
};

/**
 * An hourly portion.
 *
 * The minutes are the elapsed wall-clock minutes in the schedule's zone. Cross-midnight is refused
 * by name rather than wrapped, because a wrapped range would belong partly to the next civil date
 * and this model attributes leave to a civil date (§18).
 */
const hourlyDraft = (
  asked: PortionRequest,
  base: { readonly onDate: string; readonly zone: string; readonly expectedMinutes: number },
  input: BreakdownInput,
): LeaveResult<DayDraft> => {
  if (!input.hourlyPermitted) return refuse('hourly_leave_not_permitted');
  if (asked.startLocal === undefined || asked.endLocal === undefined) {
    return refuse('hourly_leave_needs_a_start_and_an_end');
  }

  const start = checkedWallClock(asked.startLocal, 'startLocal');

  if (!start.ok) return start;

  const end = checkedWallClock(asked.endLocal, 'endLocal');

  if (!end.ok) return end;

  const minutes = minutesFromMidnight(end.value) - minutesFromMidnight(start.value);

  if (minutes <= 0) return refuse('hourly_leave_crosses_midnight');
  if (minutes > MINUTES_IN_DAY) return refuse('minutes_out_of_range', { field: 'endLocal' });

  return accept({
    ...base,
    portion: 'hours',
    minutes,
    startLocal: start.value,
    endLocal: end.value,
  });
};

const exclusionReason = (expectation: ExpectedDay | undefined): string => {
  if (expectation === undefined) return 'no_working_pattern';
  if (!expectation.expected) return expectation.dayKind;
  return 'no_expected_time';
};

const isDayPortion = (value: string): value is DayPortion =>
  (DAY_PORTIONS as readonly string[]).includes(value);
