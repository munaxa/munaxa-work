import type { MoneyAmount } from './money-amount.js';
import type { DeductionLine, EarningLine } from './payroll-lines.js';
import type { EmploymentSnapshot } from './payroll-snapshot.js';
import type { RoundingMode } from './payroll-vocabulary.js';

/**
 * The seam between a generic payroll engine and a jurisdiction's law — **and nothing implements it**.
 *
 * `packages/country-packs` is an empty stub reserved for Phase 11.1. No rate, threshold, bracket,
 * formula or authority name appears anywhere in this module: not Jordanian, Saudi or UAE law, not
 * GOSI, not Mudad, not Muqeem, not WPS, not a tax rate, not a social-security rate, not a minimum
 * wage, not an end-of-service formula. A tenant with no pack gets a payroll with no statutory
 * lines, which is a correct generic payroll rather than a broken one (ADR-0067).
 *
 * Four properties make the interface worth defining before anything satisfies it:
 *
 * **It is pure.** Snapshot in, lines out. A pack cannot query the database, read a clock or call
 * another module — so a five-year-old payroll can be reproduced under the rules that were in force,
 * which is the entire reason the calculation is reproducible at all (ADR-0064).
 *
 * **It is versioned.** The pack identifier and version are pinned on the run and recorded in the
 * snapshot, so "which rules applied" is a fact about the run rather than a lookup that has moved on.
 *
 * **It is additive.** A pack contributes lines; it does not rewrite the generic ones. What Payroll
 * calculated from a contract stays visible beside what a statute added.
 *
 * **Its output is labelled.** Every line carries a `statutorySourceCode`, so a statutory figure is
 * distinguishable from a tenant one on a payslip and in an audit — which is what an employee
 * disputing a deduction actually needs to know.
 */

/** What the engine hands a pack: the facts, and what the generic stages already produced. */
export interface CountryRuleInput {
  readonly countryCode: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly snapshot: EmploymentSnapshot;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly earnings: readonly EarningLine[];
  readonly deductions: readonly DeductionLine[];
  readonly gross: MoneyAmount;
}

/** A line a pack asks for, before the engine gives it an identifier and a sequence. */
export interface CountryRuleLine {
  readonly code: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmount;
  readonly calculationReason: string;
  readonly statutorySourceCode: string;
  readonly priority?: number;
}

/**
 * What a pack returns.
 *
 * `netFloor` is the one place a pack may constrain the generic engine rather than add to it: a
 * statutory minimum take-home, applied by reducing lower-priority deductions in priority order
 * using an exact allocation, so the reduction sums back and nothing is invented. `roundingOverride`
 * applies to the pack's **own** lines only — a pack may say how its statute rounds; it may not
 * restate how a tenant's allowance was rounded.
 */
export interface CountryRuleOutput {
  readonly earnings: readonly CountryRuleLine[];
  readonly deductions: readonly CountryRuleLine[];
  readonly netFloor?: MoneyAmount;
  readonly roundingOverride?: RoundingMode;
}

export interface CountryRulePort {
  /** The pack in force for a country at a version, or nothing where none is configured. */
  apply(input: CountryRuleInput): CountryRuleOutput | undefined;
}

/**
 * The only implementation that ships: **none**.
 *
 * It returns nothing for every country, which is the correct behaviour for a product with no
 * country pack, and it is what every test asserts against — a payroll calculated with no statutory
 * line, rather than one calculated with a plausible-looking guess at somebody's tax law.
 */
export const noCountryRules: CountryRulePort = {
  apply: () => undefined,
};
