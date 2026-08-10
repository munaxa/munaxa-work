import type { MoneyAmount } from './money-amount.js';
import type { EarningLine } from './payroll-lines.js';
import { periodContains } from './payroll-period.js';
import type { CompensationCurrencyFacts, EmploymentFacts } from './payroll-snapshot.js';
import { accept, type PayrollResult } from './payroll-rejection.js';
import {
  combinedFactor,
  componentFactor,
  presenceFactor,
  prorate,
  type PeriodBounds,
  type ProrationPolicy,
} from './proration.js';

/**
 * Earnings: **generic, and country-free**.
 *
 * There is no `basic`, no `housing`, no `transport` and no `meal` anywhere in this file. What an
 * earning *is* arrives as `payrollTreatmentCode` from a component a tenant or a country pack
 * defined, travels through Compensation uninterpreted (ADR-0062), and is carried onto the line
 * unchanged. Payroll decides what a component is *worth* for a period; it never decides what it is.
 *
 * One source is conspicuously missing and its absence is the point: **overtime**. Attendance
 * publishes candidate minutes by design, no approved overtime result exists, and no configuration
 * promotes one into the other (ADR-0065). `attendance_overtime` is a declared and unreachable
 * classification, and a test asserts nothing reaches it.
 */

export interface EarningContext {
  readonly period: PeriodBounds;
  readonly employment: EmploymentFacts;
  readonly policy: ProrationPolicy;
  readonly identifier: (sequence: number) => string;
}

/**
 * Every earning for one currency block.
 *
 * Recurring components are prorated by presence and by the component's own span, combined. One-time
 * amounts are **never prorated** — a bonus is a bonus, and scaling it because somebody joined
 * mid-month would be inventing a rule nobody stated — and are included only when their payable date
 * falls inside the period.
 *
 * **Paid leave contributes no earning, and that is not an omission.** A salaried employee on
 * approved paid leave is paid their salary: the recurring component already carries the whole
 * period's entitlement, and an earning beside it would pay the same days twice. Leave enters the
 * calculation through *unpaid* minutes, as a deduction, which is the only place it changes a figure.
 * A tenant modelling paid leave as a *replacement* rate would need a mapping from Leave's
 * `paidTreatmentCode` to a rate, and no such mapping ships — inventing one would mean Payroll
 * deciding what Leave's codes mean (ADR-0060).
 */
export const earningsFor = (
  context: EarningContext,
  block: CompensationCurrencyFacts,
): PayrollResult<readonly EarningLine[]> => {
  const lines: EarningLine[] = [];
  const presence = presenceFactor(context.period, context.employment);

  for (const component of block.recurring) {
    const line = recurringLine(context, component, presence, lines.length);

    if (!line.ok) return line;
    lines.push(line.value);
  }

  for (const oneTime of block.oneTime) {
    if (!periodContains(context.period, oneTime.payableOn)) continue;
    lines.push(oneTimeLine(context, oneTime, lines.length));
  }

  return accept(lines);
};

const recurringLine = (
  context: EarningContext,
  component: CompensationCurrencyFacts['recurring'][number],
  presence: ReturnType<typeof presenceFactor>,
  sequence: number,
): PayrollResult<EarningLine> => {
  const factor = component.proratable
    ? combinedFactor(presence, componentFactor(context.period, component))
    : undefined;
  const prorated = prorate(component.amount, factor, context.policy);

  if (!prorated.ok) return prorated;

  return accept({
    earningLineId: context.identifier(sequence),
    employmentId: context.employment.employmentId,
    sequence,
    earningSource: 'compensation_recurring',
    componentId: component.componentId,
    componentCode: component.componentCode,
    payrollTreatmentCode: component.payrollTreatmentCode,
    amount: prorated.value.amount,
    calculationReason: factor === undefined ? 'full_period' : 'prorated',
    detail: {
      ...prorated.value.detail,
      ...(component.resolvedFromBasisPoints === undefined
        ? {}
        : { basisPoints: component.resolvedFromBasisPoints }),
    },
    sourceReference: component.componentId,
    effectiveFrom: component.effectiveFrom,
    ...(component.effectiveTo === undefined ? {} : { effectiveTo: component.effectiveTo }),
  });
};

const oneTimeLine = (
  context: EarningContext,
  oneTime: CompensationCurrencyFacts['oneTime'][number],
  sequence: number,
): EarningLine => ({
  earningLineId: context.identifier(sequence),
  employmentId: context.employment.employmentId,
  sequence,
  earningSource: 'compensation_one_time',
  componentId: oneTime.componentId,
  componentCode: oneTime.componentCode,
  payrollTreatmentCode: oneTime.payrollTreatmentCode,
  amount: oneTime.amount,
  calculationReason: 'one_time_payable_in_period',
  detail: {},
  sourceReference: oneTime.oneTimeId,
  effectiveFrom: oneTime.payableOn,
});

/** The gross of a set of lines, per currency. Never across currencies (ADR-0067). */
export const grossOf = (
  currency: { readonly currencyCode: string; readonly currencyExponent: number },
  lines: readonly EarningLine[],
): MoneyAmount => ({
  amountMinor: lines.reduce((total, line) => total + line.amount.amountMinor, 0n),
  currencyCode: currency.currencyCode,
  currencyExponent: currency.currencyExponent,
});
