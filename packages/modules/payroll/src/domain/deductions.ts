import { basisPointsOf, scaled, type MoneyAmount } from './money-amount.js';
import type { DeductionLine } from './payroll-lines.js';
import { inclusiveDays } from './payroll-period.js';
import type { AttendanceFacts, EmploymentFacts, LeaveFacts } from './payroll-snapshot.js';
import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import type { PeriodBounds, ProrationPolicy } from './proration.js';
import {
  isRoundingMode,
  type DeductionBasis,
  type DeductionSource,
  type RoundingMode,
} from './payroll-vocabulary.js';

/**
 * Deductions. **Phase 11 is the first place one may exist**, and three of the six sources have no
 * producer.
 *
 * Compensation deliberately shipped none (its D-1): a voluntary deduction is only meaningful
 * against a net figure it does not compute, and a partial version would have created a second
 * owner. So this file starts from nothing, and it stops well short of where it could go.
 *
 * Implemented generically: **unpaid leave**, **voluntary** and **adjustment**. Reserved as
 * classifications with no producer: **statutory** (a country pack's — ADR-0067), **benefit** (Phase
 * 12's) and **loan_advance** (a future domain's). Their input contract shape is `DeductionLine`
 * itself, which is what a future producer will satisfy; no table, entity, schedule or balance is
 * created for any of them. Recording a loan balance here would make Payroll the owner of a domain
 * it must not own.
 *
 * Nothing statutory appears: no rate, no threshold, no bracket, no authority name.
 */

/** A tenant's configured deduction. Generic: an amount or a share of gross, and a priority. */
export interface DeductionDefinitionState {
  readonly deductionDefinitionId: string;
  readonly payrollGroupId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly deductionSource: DeductionSource;
  readonly payrollTreatmentCode: string;
  readonly basis: DeductionBasis;
  readonly fixedAmount?: MoneyAmount;
  readonly basisPoints?: number;
  readonly roundingMode: RoundingMode;
  /** Lower runs first. A net floor reduces the highest priority numbers first (ADR-0067). */
  readonly priority: number;
  readonly active: boolean;
  readonly version: number;
}

export interface DeductionContext {
  readonly period: PeriodBounds;
  readonly employment: EmploymentFacts;
  readonly policy: ProrationPolicy;
  readonly identifier: (sequence: number) => string;
}

export interface DeductionInputs {
  readonly gross: MoneyAmount;
  readonly attendance?: AttendanceFacts;
  readonly leave?: LeaveFacts;
  readonly definitions: readonly DeductionDefinitionState[];
}

/**
 * Every deduction for one currency block, in priority order.
 *
 * Unpaid leave comes first because it is a reduction of what was earned rather than a claim against
 * it, and computing a percentage deduction against a gross that still included unpaid days would
 * overstate it.
 */
export const deductionsFor = (
  context: DeductionContext,
  inputs: DeductionInputs,
): PayrollResult<readonly DeductionLine[]> => {
  const lines: DeductionLine[] = [];
  const unpaid = unpaidLeaveLine(context, inputs, lines.length);

  if (!unpaid.ok) return unpaid;
  if (unpaid.value !== undefined) lines.push(unpaid.value);

  for (const definition of [...inputs.definitions].sort(byPriority)) {
    if (!definition.active) continue;

    const line = configuredLine(context, definition, inputs.gross, lines.length);

    if (!line.ok) return line;
    if (line.value !== undefined) lines.push(line.value);
  }

  return accept(lines);
};

const byPriority = (left: DeductionDefinitionState, right: DeductionDefinitionState): number =>
  left.priority - right.priority;

/**
 * Unpaid leave, deducted from the **already-prorated** gross.
 *
 * The unpaid quantity comes from the attendance snapshot's `unpaidMinutes` where Attendance is in
 * use, and otherwise from Leave's own lines whose `paidTreatmentCode` is `unpaid`. That is the one
 * code this module reads by value, and it reads it as a **string Leave published for exactly this
 * purpose** rather than by interpreting a leave type — Payroll never maps a `leaveTypeId` to a
 * meaning (ADR-0060).
 *
 * The denominator is the period's own length under the group's basis. A day's pay is the period's
 * pay divided by the period's days: no monthly-hours constant, no 26-day divisor, no assumption
 * about a working week, because every one of those is somebody's jurisdiction rather than a fact.
 */
const unpaidLeaveLine = (
  context: DeductionContext,
  inputs: DeductionInputs,
  sequence: number,
): PayrollResult<DeductionLine | undefined> => {
  const unpaid = unpaidQuantity(inputs);

  if (unpaid === undefined || unpaid.units <= 0) return accept(undefined);

  const denominator = denominatorFor(context, unpaid.kind);

  if (denominator <= 0) return accept(undefined);

  const amount = scaled(
    inputs.gross,
    BigInt(Math.min(unpaid.units, denominator)),
    BigInt(denominator),
    context.policy.rounding,
  );

  if (!amount.ok) return amount;

  return accept({
    deductionLineId: context.identifier(sequence),
    employmentId: context.employment.employmentId,
    sequence,
    deductionSource: 'unpaid_leave',
    deductionCode: 'unpaid-leave',
    payrollTreatmentCode: 'unpaid-leave',
    amount: amount.value,
    calculationReason: 'unpaid_absence',
    detail: {
      basisAmountMinor: inputs.gross.amountMinor.toString(),
      numerator: unpaid.units,
      denominator,
      roundingMode: context.policy.rounding,
      ...(unpaid.kind === 'minutes' ? { minutes: unpaid.units } : {}),
    },
    priority: 0,
  });
};

interface UnpaidQuantity {
  readonly units: number;
  readonly kind: 'minutes' | 'days';
}

/**
 * How much was unpaid, and in what unit.
 *
 * Attendance is preferred where present because it has already reconciled leave against the
 * schedule; Leave alone is the fallback for a group that does not use attendance. **They are never
 * added together** — that would deduct the same absence twice, which is the single most expensive
 * arithmetic mistake this module could make.
 */
const unpaidQuantity = (inputs: DeductionInputs): UnpaidQuantity | undefined => {
  if (inputs.attendance !== undefined) {
    return { units: inputs.attendance.unpaidMinutes, kind: 'minutes' };
  }
  if (inputs.leave === undefined) return undefined;

  const days = inputs.leave.lines
    .filter((line) => line.paidTreatmentCode === 'unpaid')
    .reduce((total, line) => total + line.days, 0);

  return { units: days, kind: 'days' };
};

const denominatorFor = (context: DeductionContext, kind: 'minutes' | 'days'): number => {
  if (kind === 'days') return inclusiveDays(context.period.periodStart, context.period.periodEnd);
  return (
    context.policy.scheduledMinutesInPeriod ??
    inclusiveDays(context.period.periodStart, context.period.periodEnd) * MINUTES_PER_DAY
  );
};

/** Only used when Attendance reported unpaid minutes and no schedule total came with them. */
const MINUTES_PER_DAY = 1_440;

/**
 * A configured deduction: a fixed amount, or a share of gross in basis points.
 *
 * A fixed amount in another currency is **refused rather than converted** — the block is in one
 * currency and nothing here owns an exchange rate (ADR-0067).
 */
const configuredLine = (
  context: DeductionContext,
  definition: DeductionDefinitionState,
  gross: MoneyAmount,
  sequence: number,
): PayrollResult<DeductionLine | undefined> => {
  if (!isRoundingMode(definition.roundingMode)) {
    return refuse('rounding_mode_unknown', { rounding: definition.roundingMode });
  }

  const amount = configuredAmount(definition, gross);

  if (!amount.ok) return amount;
  if (amount.value.amountMinor === 0n) return accept(undefined);

  return accept({
    deductionLineId: context.identifier(sequence),
    employmentId: context.employment.employmentId,
    sequence,
    deductionSource: definition.deductionSource,
    deductionDefinitionId: definition.deductionDefinitionId,
    deductionCode: definition.code,
    payrollTreatmentCode: definition.payrollTreatmentCode,
    amount: amount.value,
    calculationReason:
      definition.basis === 'fixed_amount' ? 'configured_fixed' : 'configured_share_of_gross',
    detail: {
      roundingMode: definition.roundingMode,
      ...(definition.basis === 'basis_points_of_gross'
        ? { basisAmountMinor: gross.amountMinor.toString(), basisPoints: definition.basisPoints }
        : {}),
    },
    priority: definition.priority,
  });
};

const configuredAmount = (
  definition: DeductionDefinitionState,
  gross: MoneyAmount,
): PayrollResult<MoneyAmount> => {
  if (definition.basis === 'fixed_amount') {
    const fixed = definition.fixedAmount;

    if (fixed === undefined) return refuse('deduction_amount_missing', { code: definition.code });
    if (
      fixed.currencyCode !== gross.currencyCode ||
      fixed.currencyExponent !== gross.currencyExponent
    ) {
      return refuse('deduction_currency_mismatch', {
        code: definition.code,
        currencyCode: fixed.currencyCode,
      });
    }
    return accept(fixed);
  }

  if (definition.basisPoints === undefined) {
    return refuse('deduction_basis_points_missing', { code: definition.code });
  }
  return basisPointsOf(gross, definition.basisPoints, definition.roundingMode);
};

/** The total of a set of deduction lines, per currency. */
export const totalOf = (
  currency: { readonly currencyCode: string; readonly currencyExponent: number },
  lines: readonly DeductionLine[],
): MoneyAmount => ({
  amountMinor: lines.reduce((total, line) => total + line.amount.amountMinor, 0n),
  currencyCode: currency.currencyCode,
  currencyExponent: currency.currencyExponent,
});
