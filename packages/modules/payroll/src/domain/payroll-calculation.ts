import type { CountryRulePort } from './country-rule.js';
import { applyCountryRules } from './country-rule-application.js';
import { deductionsFor, totalOf, type DeductionDefinitionState } from './deductions.js';
import { earningsFor, grossOf } from './earnings.js';
import { minus, type MoneyAmount } from './money-amount.js';
import type { DeductionLine, EarningLine, PayrollResultState } from './payroll-lines.js';
import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import {
  snapshotBlockers,
  snapshotDigest,
  type CompensationCurrencyFacts,
  type EmploymentSnapshot,
} from './payroll-snapshot.js';
import type { PeriodBounds, ProrationPolicy } from './proration.js';

/**
 * **The pure calculation.** Snapshot in, results out — no clock, no database, no source call.
 *
 * That purity is what makes ADR-0064's promise testable rather than asserted: replaying a finalized
 * run's snapshot at its recorded calculation version must reproduce the persisted result line for
 * line, and a refactor that breaks it fails a test rather than a payslip.
 *
 * The order of the stages is load-bearing. Earnings before deductions, because a share-of-gross
 * deduction needs a gross. Unpaid leave before configured deductions, because a percentage taken
 * against a gross that still included unpaid days would be overstated. Country rules after both,
 * because a statute applies to what the contract produced. Invariants last, because an invariant
 * checked before the final figure exists checks nothing.
 */

/** The version of this algorithm. Persisted on every run and result; see ADR-0064 and D-10. */
export const CALCULATION_VERSION = 1;

export interface CalculationPolicy extends ProrationPolicy {
  readonly permittedCurrencies: readonly string[];
  readonly countryCode?: string;
}

export interface CalculationRequest {
  readonly period: PeriodBounds;
  readonly snapshot: EmploymentSnapshot;
  readonly policy: CalculationPolicy;
  readonly definitions: readonly DeductionDefinitionState[];
  readonly countryRules: CountryRulePort;
  readonly payrollRunId: string;
  /** Supplied by the caller so identifiers are generated outside the pure core. */
  readonly identifier: (kind: string, sequence: number) => string;
}

export interface CalculationOutcome {
  readonly results: readonly PayrollResultState[];
  readonly exceptions: readonly {
    readonly code: string;
    readonly detail?: Readonly<Record<string, string>>;
  }[];
}

/**
 * One employment, calculated.
 *
 * A blocked snapshot produces **exceptions and no results**, never a result of zero. A payroll that
 * quietly pays nothing to somebody whose compensation is missing looks exactly like a correct
 * payroll of zero, which is why every blocker is reported by name.
 */
export const calculateEmployment = (
  request: CalculationRequest,
): PayrollResult<CalculationOutcome> => {
  const blockers = snapshotBlockers(request.snapshot);

  if (blockers.length > 0) {
    return accept({ results: [], exceptions: blockers.map((code) => ({ code })) });
  }

  const employment = request.snapshot.employment;
  const compensation = request.snapshot.compensation;

  if (employment === undefined || compensation === undefined) {
    return refuse('snapshot_incomplete');
  }
  if (employment.endDate !== undefined && employment.endDate < request.period.periodStart) {
    return accept({ results: [], exceptions: [{ code: 'employment_ended_before_period' }] });
  }

  return blocksOf(request, compensation.currencies);
};

const blocksOf = (
  request: CalculationRequest,
  currencies: readonly CompensationCurrencyFacts[],
): PayrollResult<CalculationOutcome> => {
  const results: PayrollResultState[] = [];
  const exceptions: { code: string; detail?: Readonly<Record<string, string>> }[] = [];

  for (const block of currencies) {
    if (!request.policy.permittedCurrencies.includes(block.currencyCode)) {
      exceptions.push({
        code: 'currency_not_permitted',
        detail: { currencyCode: block.currencyCode },
      });
      continue;
    }

    const result = calculateBlock(request, block);

    if (!result.ok) return result;
    if (result.value.result === undefined) exceptions.push(...result.value.exceptions);
    else results.push(result.value.result);
  }

  return accept({ results, exceptions });
};

interface BlockOutcome {
  readonly result?: PayrollResultState;
  readonly exceptions: readonly { readonly code: string }[];
}

/** One currency block: earnings, deductions, country rules, gross, net, invariants. */
const calculateBlock = (
  request: CalculationRequest,
  block: CompensationCurrencyFacts,
): PayrollResult<BlockOutcome> => {
  const employment = request.snapshot.employment;

  if (employment === undefined) return refuse('snapshot_incomplete');

  const earnings = earningsFor(
    {
      period: request.period,
      employment,
      policy: request.policy,
      identifier: (sequence) => request.identifier(`earning:${block.currencyCode}`, sequence),
    },
    block,
  );

  if (!earnings.ok) return earnings;

  const gross = grossOf(block, earnings.value);
  const deductions = deductionsFor(
    {
      period: request.period,
      employment,
      policy: request.policy,
      identifier: (sequence) => request.identifier(`deduction:${block.currencyCode}`, sequence),
    },
    {
      gross,
      ...(request.snapshot.attendance === undefined
        ? {}
        : { attendance: request.snapshot.attendance }),
      ...(request.snapshot.leave === undefined ? {} : { leave: request.snapshot.leave }),
      definitions: request.definitions.filter((definition) =>
        definition.fixedAmount === undefined
          ? true
          : definition.fixedAmount.currencyCode === block.currencyCode,
      ),
    },
  );

  if (!deductions.ok) return deductions;

  return withCountryRules(request, block, earnings.value, deductions.value, gross);
};

const withCountryRules = (
  request: CalculationRequest,
  block: CompensationCurrencyFacts,
  earnings: readonly EarningLine[],
  deductions: readonly DeductionLine[],
  gross: MoneyAmount,
): PayrollResult<BlockOutcome> => {
  const applied = applyCountryRules({
    port: request.countryRules,
    period: request.period,
    snapshot: request.snapshot,
    block,
    earnings,
    deductions,
    gross,
    identifier: request.identifier,
    ...(request.policy.countryCode === undefined
      ? {}
      : { countryCode: request.policy.countryCode }),
  });

  if (!applied.ok) return applied;
  return settle(request, block, applied.value.earnings, applied.value.deductions);
};

/** Gross, net, and the invariants that must hold before a result is allowed to exist. */
const settle = (
  request: CalculationRequest,
  block: CompensationCurrencyFacts,
  earnings: readonly EarningLine[],
  deductions: readonly DeductionLine[],
): PayrollResult<BlockOutcome> => {
  const employment = request.snapshot.employment;

  if (employment === undefined) return refuse('snapshot_incomplete');

  const gross = grossOf(block, earnings);
  const totalDeductions = totalOf(block, deductions);
  const net = minus(gross, totalDeductions);

  if (net === undefined) return refuse('currency_mismatch_in_result');
  if (net.amountMinor < 0n) {
    return accept({ exceptions: [{ code: 'net_would_be_negative' }] });
  }

  return accept({
    result: {
      payrollResultId: request.identifier(`result:${block.currencyCode}`, 0),
      payrollRunId: request.payrollRunId,
      employmentId: employment.employmentId,
      currencyCode: block.currencyCode,
      currencyExponent: block.currencyExponent,
      gross,
      totalDeductions,
      net,
      earnings,
      deductions,
      snapshotDigest: snapshotDigest(request.snapshot),
      calculationVersion: CALCULATION_VERSION,
    },
    exceptions: [],
  });
};

/**
 * The invariants, asserted on a finished result.
 *
 * Separate from the calculation so they can be run again over **persisted** rows — which is where
 * they matter. A gross that equals the sum of its lines in memory and not in the database is a
 * persistence bug, and this is what finds it.
 */
export const resultInvariants = (result: PayrollResultState): readonly string[] => {
  const problems: string[] = [];
  const earnings = result.earnings.reduce((total, line) => total + line.amount.amountMinor, 0n);
  const deductions = result.deductions.reduce((total, line) => total + line.amount.amountMinor, 0n);

  if (result.gross.amountMinor !== earnings) problems.push('gross_does_not_match_earning_lines');
  if (result.totalDeductions.amountMinor !== deductions) {
    problems.push('total_does_not_match_deduction_lines');
  }
  if (result.net.amountMinor !== result.gross.amountMinor - result.totalDeductions.amountMinor) {
    problems.push('net_does_not_match_gross_less_deductions');
  }
  if (
    result.earnings.some((line) => line.amount.currencyCode !== result.currencyCode) ||
    result.deductions.some((line) => line.amount.currencyCode !== result.currencyCode)
  ) {
    problems.push('line_in_unexpected_currency');
  }
  return problems;
};
