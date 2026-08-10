import type { MoneyAmount } from './money-amount.js';
import type {
  DeductionSource,
  EarningSource,
  ProrationBasis,
  ProrationCause,
  RoundingMode,
} from './payroll-vocabulary.js';

/**
 * The lines a payslip is made of, and the explanation each one carries.
 *
 * `detail` is the field that makes ADR-0064's promise keepable. A line that says "127.500 JOD"
 * explains nothing; a line that says "1500.000 × 17 ÷ 30 calendar days, half-up, because the
 * employment started mid-period" explains itself without anyone re-running anything. Every
 * multiplication and every rounding this module performs is recorded in one of these.
 *
 * **`sourceReference` points at the fact, not at the source's table.** It is the compensation
 * recurring identifier, the one-time identifier, the attendance snapshot identifier — an identifier
 * Payroll was given, held in the snapshot, and can still resolve years later without asking anybody.
 */

export interface CalculationDetail {
  /** The amount before proration or scaling, where one was applied. */
  readonly basisAmountMinor?: string;
  readonly numerator?: number;
  readonly denominator?: number;
  readonly prorationBasis?: ProrationBasis;
  readonly prorationCause?: ProrationCause;
  readonly basisPoints?: number;
  readonly minutes?: number;
  readonly roundingMode?: RoundingMode;
  /** A country pack's own identifier for the rule that produced this line. Never interpreted. */
  readonly statutorySourceCode?: string;
}

export interface EarningLine {
  readonly earningLineId: string;
  readonly employmentId: string;
  readonly sequence: number;
  readonly earningSource: EarningSource;
  readonly componentId?: string;
  readonly componentCode: string;
  /** Compensation's uninterpreted code, interpreted here and carried onward unchanged. */
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmount;
  readonly calculationReason: string;
  readonly detail: CalculationDetail;
  readonly sourceReference?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
}

export interface DeductionLine {
  readonly deductionLineId: string;
  readonly employmentId: string;
  readonly sequence: number;
  readonly deductionSource: DeductionSource;
  readonly deductionDefinitionId?: string;
  readonly deductionCode: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmount;
  readonly calculationReason: string;
  readonly detail: CalculationDetail;
  readonly sourceReference?: string;
  /** Lower runs first, and is what a net floor reduces in reverse. */
  readonly priority: number;
}

/**
 * One employment's result **in one currency**.
 *
 * One row per `(run, employment, currency)`, because an employment paid a local salary and a
 * foreign-currency allowance has two gross figures and two net figures and **no total**. Combining
 * them needs a conversion nothing in this repository owns (ADR-0067).
 *
 * `gross`, `totalDeductions` and `net` are persisted rather than recomputed on read, and an
 * invariant test asserts each equals the sum of its lines. A stored total that can drift from its
 * lines is a reconciliation bug waiting to be found by an employee.
 */
export interface PayrollResultState {
  readonly payrollResultId: string;
  readonly payrollRunId: string;
  readonly employmentId: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly gross: MoneyAmount;
  readonly totalDeductions: MoneyAmount;
  readonly net: MoneyAmount;
  readonly earnings: readonly EarningLine[];
  readonly deductions: readonly DeductionLine[];
  readonly snapshotDigest: string;
  readonly calculationVersion: number;
}

/** An employment that could not be calculated, or was calculated with a doubt recorded. */
export interface PayrollExceptionState {
  readonly payrollExceptionId: string;
  readonly payrollRunId: string;
  readonly employmentId: string;
  readonly exceptionCode: string;
  readonly detail?: Readonly<Record<string, string>>;
  readonly resolvedAt?: Date;
  readonly resolvedBy?: string;
}
