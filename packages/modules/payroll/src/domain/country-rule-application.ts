import type { CountryRuleLine, CountryRulePort } from './country-rule.js';
import { totalOf } from './deductions.js';
import { grossOf } from './earnings.js';
import { allocated, minus, type MoneyAmount } from './money-amount.js';
import type { DeductionLine, EarningLine } from './payroll-lines.js';
import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import type { CompensationCurrencyFacts, EmploymentSnapshot } from './payroll-snapshot.js';
import type { PeriodBounds } from './proration.js';

/**
 * How a country pack's output is folded into a calculation — **with nothing implementing the port**.
 *
 * Written now, before any pack exists, for the reason interfaces are worth writing early: the fold
 * is where a pack could quietly become able to rewrite what the tenant's contract produced, and
 * settling that here means Phase 11.1 inherits a boundary rather than negotiating one.
 *
 * The pack **adds**; it does not edit. Its lines are appended after the generic ones and carry a
 * `statutorySourceCode`, so a payslip can show which figures came from a statute and which from a
 * contract — the distinction an employee disputing a deduction actually needs.
 *
 * The one exception is `netFloor`, and it is constrained rather than free: a statutory minimum
 * take-home reduces deductions in **descending priority order** by an exact allocation, so what is
 * given back sums to the shortfall and nothing is invented. A pack cannot raise gross to meet a
 * floor, because inventing an earning nobody is entitled to is not a rounding decision.
 */

export interface CountryRuleApplication {
  readonly port: CountryRulePort;
  readonly countryCode?: string;
  readonly period: PeriodBounds;
  readonly snapshot: EmploymentSnapshot;
  readonly block: CompensationCurrencyFacts;
  readonly earnings: readonly EarningLine[];
  readonly deductions: readonly DeductionLine[];
  readonly gross: MoneyAmount;
  readonly identifier: (kind: string, sequence: number) => string;
}

export interface AppliedLines {
  readonly earnings: readonly EarningLine[];
  readonly deductions: readonly DeductionLine[];
}

export const applyCountryRules = (
  application: CountryRuleApplication,
): PayrollResult<AppliedLines> => {
  if (application.countryCode === undefined) {
    return accept({ earnings: application.earnings, deductions: application.deductions });
  }

  const output = application.port.apply({
    countryCode: application.countryCode,
    periodStart: application.period.periodStart,
    periodEnd: application.period.periodEnd,
    snapshot: application.snapshot,
    currencyCode: application.block.currencyCode,
    currencyExponent: application.block.currencyExponent,
    earnings: application.earnings,
    deductions: application.deductions,
    gross: application.gross,
  });

  if (output === undefined) {
    return accept({ earnings: application.earnings, deductions: application.deductions });
  }

  const earnings = [
    ...application.earnings,
    ...output.earnings.map((line, index) =>
      statutoryEarning(application, line, application.earnings.length + index),
    ),
  ];
  const deductions = [
    ...application.deductions,
    ...output.deductions.map((line, index) =>
      statutoryDeduction(application, line, application.deductions.length + index),
    ),
  ];

  return output.netFloor === undefined
    ? accept({ earnings, deductions })
    : withNetFloor(application, earnings, deductions, output.netFloor);
};

const statutoryEarning = (
  application: CountryRuleApplication,
  line: CountryRuleLine,
  sequence: number,
): EarningLine => ({
  earningLineId: application.identifier(`earning:${application.block.currencyCode}`, sequence),
  employmentId: application.snapshot.employmentId,
  sequence,
  earningSource: 'country_rule',
  componentCode: line.code,
  payrollTreatmentCode: line.payrollTreatmentCode,
  amount: line.amount,
  calculationReason: line.calculationReason,
  detail: { statutorySourceCode: line.statutorySourceCode },
});

const statutoryDeduction = (
  application: CountryRuleApplication,
  line: CountryRuleLine,
  sequence: number,
): DeductionLine => ({
  deductionLineId: application.identifier(`deduction:${application.block.currencyCode}`, sequence),
  employmentId: application.snapshot.employmentId,
  sequence,
  deductionSource: 'statutory',
  deductionCode: line.code,
  payrollTreatmentCode: line.payrollTreatmentCode,
  amount: line.amount,
  calculationReason: line.calculationReason,
  detail: { statutorySourceCode: line.statutorySourceCode },
  priority: line.priority ?? DEFAULT_STATUTORY_PRIORITY,
});

/** Statutory deductions run before voluntary ones unless a pack states otherwise. */
const DEFAULT_STATUTORY_PRIORITY = 10;

/**
 * A statutory minimum take-home, honoured by giving back the shortfall.
 *
 * Reduced from the **lowest-priority deductions first** — the ones a jurisdiction is least likely to
 * protect — using an exact weighted allocation so the amounts given back sum to the shortfall
 * exactly. A floor that cannot be met even by cancelling every reducible deduction is refused
 * rather than half-applied: producing a net below a floor a pack declared would be worse than
 * saying the configuration cannot be satisfied.
 */
const withNetFloor = (
  application: CountryRuleApplication,
  earnings: readonly EarningLine[],
  deductions: readonly DeductionLine[],
  floor: MoneyAmount,
): PayrollResult<AppliedLines> => {
  const gross = grossOf(application.block, earnings);
  const net = minus(gross, totalOf(application.block, deductions));

  if (net === undefined) return refuse('currency_mismatch_in_result');
  if (net.amountMinor >= floor.amountMinor) return accept({ earnings, deductions });

  const shortfall = floor.amountMinor - net.amountMinor;
  const reducible = [...deductions].sort((left, right) => right.priority - left.priority);
  const capacity = reducible.reduce((total, line) => total + line.amount.amountMinor, 0n);

  if (capacity < shortfall) return refuse('net_floor_unreachable');

  return accept({ earnings, deductions: reduced(reducible, deductions, shortfall) });
};

/**
 * Gives back `shortfall` across the reducible lines, largest priority first, exactly.
 *
 * The allocation is weighted by each line's own amount so a small deduction is not reduced below
 * zero, and `allocated` distributes the remainder rather than rounding each share — the difference
 * between a net that meets the floor and one that misses it by a fil.
 */
const reduced = (
  ordered: readonly DeductionLine[],
  original: readonly DeductionLine[],
  shortfall: bigint,
): readonly DeductionLine[] => {
  const weights = ordered.map((line) => Number(line.amount.amountMinor));
  const relief = allocated(
    {
      ...(ordered[0]?.amount ?? { currencyCode: 'XXX', currencyExponent: 0 }),
      amountMinor: shortfall,
    },
    weights,
  );
  const byLine = new Map<string, bigint>();

  if (relief.ok) {
    ordered.forEach((line, index) => {
      byLine.set(line.deductionLineId, relief.value[index]?.amountMinor ?? 0n);
    });
  }

  return original.map((line) => ({
    ...line,
    amount: {
      ...line.amount,
      amountMinor: line.amount.amountMinor - (byLine.get(line.deductionLineId) ?? 0n),
    },
    calculationReason:
      byLine.get(line.deductionLineId) === undefined
        ? line.calculationReason
        : 'reduced_to_net_floor',
  }));
};
