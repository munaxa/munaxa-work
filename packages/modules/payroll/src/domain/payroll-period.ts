import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import { isCode, isIsoDate, PERIOD_TRANSITIONS, type PeriodStatus } from './payroll-vocabulary.js';

/**
 * A payroll period: one interval, for one payroll group, with one payment date.
 *
 * Both endpoints are **inclusive civil dates** — a payroll period is a span on somebody's calendar,
 * not an instant range, and the month of June ends on the thirtieth rather than at midnight on the
 * first. The database enforces non-overlap per group with a GiST exclusion over
 * `daterange(period_start, period_end, '[]')`, which is the only thing that can settle two
 * administrators creating June at the same moment.
 *
 * The payment date may fall outside the period, and usually does: work in June is paid in July.
 * Nothing here requires it to be inside, because a rule that did would be somebody's convention
 * rather than a fact.
 */

export interface PayrollPeriodState {
  readonly payrollPeriodId: string;
  readonly payrollGroupId: string;
  readonly code: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly paymentDate: string;
  readonly status: PeriodStatus;
  readonly openedAt?: Date;
  readonly openedBy?: string;
  readonly closedAt?: Date;
  readonly closedBy?: string;
  readonly version: number;
}

export interface OpenPayrollPeriod {
  readonly payrollPeriodId: string;
  readonly payrollGroupId: string;
  readonly code: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly paymentDate: string;
}

export const createPayrollPeriod = (
  command: OpenPayrollPeriod,
): PayrollResult<PayrollPeriodState> => {
  if (!isCode(command.code)) return refuse('code_malformed', { code: command.code });

  const dates = checkedDates(command);

  if (!dates.ok) return dates;

  return accept({
    payrollPeriodId: command.payrollPeriodId,
    payrollGroupId: command.payrollGroupId,
    code: command.code,
    periodStart: command.periodStart,
    periodEnd: command.periodEnd,
    paymentDate: command.paymentDate,
    status: 'draft',
    version: 1,
  });
};

const checkedDates = (command: OpenPayrollPeriod): PayrollResult<true> => {
  for (const [field, value] of [
    ['periodStart', command.periodStart],
    ['periodEnd', command.periodEnd],
    ['paymentDate', command.paymentDate],
  ] as const) {
    if (!isIsoDate(value)) return refuse('date_malformed', { field });
  }
  if (command.periodEnd < command.periodStart) return refuse('period_ends_before_it_starts');

  return accept(true);
};

/**
 * A status change, checked against the transition table rather than against a chain of conditions.
 *
 * The refusal names both ends, because "cannot move from approved to calculating" is a sentence an
 * administrator can act on and "invalid state" is not.
 */
export const movePeriodTo = (
  state: PayrollPeriodState,
  status: PeriodStatus,
  moment: Date,
  actor: string,
  expectedVersion: number,
): PayrollResult<PayrollPeriodState> => {
  if (state.version !== expectedVersion) return refuse('concurrent_modification');
  if (!PERIOD_TRANSITIONS[state.status].includes(status)) {
    return refuse('period_transition_not_permitted', { from: state.status, to: status });
  }

  return accept({
    ...state,
    status,
    ...(status === 'open' ? { openedAt: moment, openedBy: actor } : {}),
    ...(status === 'finalized' ? { closedAt: moment, closedBy: actor } : {}),
    version: state.version + 1,
  });
};

/** Whether a date falls inside the period. Both ends inclusive, as the period's own dates are. */
export const periodContains = (
  state: { readonly periodStart: string; readonly periodEnd: string },
  date: string,
): boolean => date >= state.periodStart && date <= state.periodEnd;

/**
 * The period's length in whole days, both ends inclusive.
 *
 * The denominator of a calendar-day proration, and the reason it is computed here rather than at
 * the call site: June is thirty days and February is twenty-eight or twenty-nine, and a constant
 * anywhere in a payroll engine is a bug waiting for a leap year.
 */
export const periodDays = (state: {
  readonly periodStart: string;
  readonly periodEnd: string;
}): number => inclusiveDays(state.periodStart, state.periodEnd);

export const inclusiveDays = (from: string, to: string): number => {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
};

/** The later of two dates, and the earlier — the two halves of an overlap, named. */
export const laterOf = (left: string, right: string): string => (left > right ? left : right);
export const earlierOf = (left: string, right: string): string => (left < right ? left : right);

/**
 * The days of `[from, to]` that fall inside the period, both ends inclusive.
 *
 * Zero when they do not meet at all, which is a real answer: a compensation period that ended
 * before the payroll period began contributes nothing and is not an error.
 */
export const overlappingDays = (
  period: { readonly periodStart: string; readonly periodEnd: string },
  from: string,
  to: string | undefined,
): number => {
  const start = laterOf(period.periodStart, from);
  const end = earlierOf(period.periodEnd, to ?? period.periodEnd);

  return end < start ? 0 : inclusiveDays(start, end);
};
