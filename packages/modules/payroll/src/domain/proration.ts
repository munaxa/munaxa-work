import { scaled, type MoneyAmount } from './money-amount.js';
import { inclusiveDays, overlappingDays } from './payroll-period.js';
import type { CalculationDetail } from './payroll-lines.js';
import type { EmploymentFacts } from './payroll-snapshot.js';
import { accept, type PayrollResult } from './payroll-rejection.js';
import type { ProrationBasis, ProrationCause, RoundingMode } from './payroll-vocabulary.js';

/**
 * Proration: **no universal formula, and no default**.
 *
 * Whether a mid-month starter is paid seventeen thirtieths or twelve twenty-firsts is a
 * jurisdictional and contractual question, and a system that picked one silently would be applying
 * somebody's labour law to everybody. So the basis is stated on the payroll group, the numerator
 * and denominator are recorded on the line, and a country pack may later override the denominator
 * without changing the fact that the choice is written down.
 *
 * Two causes can apply at once — hired on the tenth *and* four days of unpaid leave. Presence is
 * prorated first, and the unpaid deduction is computed against the already-prorated amount as a
 * separate line. Both are explained individually rather than blended into one figure, because a
 * blended figure is exactly what an employee cannot check.
 */

export interface PeriodBounds {
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface ProrationPolicy {
  readonly basis: ProrationBasis;
  readonly rounding: RoundingMode;
  /** Working days in the period, supplied by the caller where the basis needs it. */
  readonly workingDaysInPeriod?: number;
  /** Scheduled minutes in the period, from Attendance, where the basis needs them. */
  readonly scheduledMinutesInPeriod?: number;
}

export interface ProrationFactor {
  readonly numerator: number;
  readonly denominator: number;
  readonly cause: ProrationCause;
}

/**
 * The span of the period an employment was actually present for.
 *
 * `undefined` means no proration applies — the employment spans the whole period — which is not the
 * same as a factor of one. The distinction matters because a line prorated by 30/30 would carry a
 * proration explanation nobody asked for and imply a calculation that did not happen.
 */
export const presenceFactor = (
  period: PeriodBounds,
  employment: EmploymentFacts,
): ProrationFactor | undefined => {
  const startsLate = employment.startDate > period.periodStart;
  const endsEarly = employment.endDate !== undefined && employment.endDate < period.periodEnd;

  if (!startsLate && !endsEarly) return undefined;

  const present = overlappingDays(period, employment.startDate, employment.endDate);

  return {
    numerator: present,
    denominator: inclusiveDays(period.periodStart, period.periodEnd),
    cause: startsLate ? 'hired_mid_period' : 'ended_mid_period',
  };
};

/**
 * The span of the period a compensation component was in force for.
 *
 * Driven by `partialPeriod`, which **Compensation states as a fact** (ADR-0062). Payroll does not
 * decide whether a component was partial; it decides what a partial component is worth.
 */
export const componentFactor = (
  period: PeriodBounds,
  component: {
    readonly effectiveFrom: string;
    readonly effectiveTo?: string;
    readonly partialPeriod: boolean;
  },
): ProrationFactor | undefined => {
  if (!component.partialPeriod) return undefined;

  return {
    numerator: overlappingDays(period, component.effectiveFrom, component.effectiveTo),
    denominator: inclusiveDays(period.periodStart, period.periodEnd),
    cause: 'partial_period_component',
  };
};

/**
 * Two factors combined, where both apply.
 *
 * Multiplied rather than taking the smaller, because they measure different things: somebody hired
 * on the tenth whose allowance started on the twentieth is entitled to neither span alone. The
 * recorded numerator and denominator are the products, so the line still explains itself in one
 * fraction.
 */
export const combinedFactor = (
  first: ProrationFactor | undefined,
  second: ProrationFactor | undefined,
): ProrationFactor | undefined => {
  if (first === undefined) return second;
  if (second === undefined) return first;

  return {
    numerator: first.numerator * second.numerator,
    denominator: first.denominator * second.denominator,
    cause: first.cause,
  };
};

/**
 * The denominator the group's basis dictates, expressed as a scaling of the calendar-day fraction.
 *
 * `calendar_days` uses the fraction as computed. `working_days` and `scheduled_minutes` need a total
 * the caller supplies from the schedule or the attendance snapshot; where it is absent the basis
 * cannot be applied and the calendar fraction is used with the basis recorded as `calendar_days`,
 * so the line never claims a basis that was not actually used.
 */
export const appliedBasis = (
  policy: ProrationPolicy,
  factor: ProrationFactor,
): { readonly factor: ProrationFactor; readonly basis: ProrationBasis } => {
  if (policy.basis === 'working_days' && policy.workingDaysInPeriod !== undefined) {
    return {
      factor: {
        ...factor,
        numerator: Math.round((factor.numerator / factor.denominator) * policy.workingDaysInPeriod),
        denominator: policy.workingDaysInPeriod,
      },
      basis: 'working_days',
    };
  }
  if (policy.basis === 'scheduled_minutes' && policy.scheduledMinutesInPeriod !== undefined) {
    return {
      factor: {
        ...factor,
        numerator: Math.round(
          (factor.numerator / factor.denominator) * policy.scheduledMinutesInPeriod,
        ),
        denominator: policy.scheduledMinutesInPeriod,
      },
      basis: 'scheduled_minutes',
    };
  }
  return { factor, basis: 'calendar_days' };
};

export interface ProratedAmount {
  readonly amount: MoneyAmount;
  readonly detail: CalculationDetail;
}

/**
 * An amount prorated, with the arithmetic recorded.
 *
 * `Money.multipliedBy` underneath: exact integer arithmetic with the rounding mode taken from the
 * group rather than defaulted. The detail carries the amount **before** proration as well as the
 * fraction, so a reader can check the multiplication without holding the compensation record.
 */
export const prorate = (
  amount: MoneyAmount,
  factor: ProrationFactor | undefined,
  policy: ProrationPolicy,
): PayrollResult<ProratedAmount> => {
  if (factor === undefined) {
    return accept({ amount, detail: { roundingMode: policy.rounding } });
  }

  const applied = appliedBasis(policy, factor);
  const result = scaled(
    amount,
    BigInt(applied.factor.numerator),
    BigInt(applied.factor.denominator),
    policy.rounding,
  );

  if (!result.ok) return result;

  return accept({
    amount: result.value,
    detail: {
      basisAmountMinor: amount.amountMinor.toString(),
      numerator: applied.factor.numerator,
      denominator: applied.factor.denominator,
      prorationBasis: applied.basis,
      prorationCause: factor.cause,
      roundingMode: policy.rounding,
    },
  });
};
