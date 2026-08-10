import type { MoneyAmountView } from '../domain/money-amount.js';

/**
 * The views Payroll publishes.
 *
 * Every monetary figure is a `MoneyAmountView`: exact minor units as a **decimal string**, the
 * decimal rendering beside it, and the currency's code and exponent. Never a JSON number — one
 * would lose precision above 2^53 and would invite a `Number()` at the far end, which is where a
 * payslip loses a fil.
 *
 * **Nothing here is a persistence model.** Each view is assembled by a query handler from the
 * stored rows, so a column rename is not a contract change.
 *
 * Two absences are part of the contract. Nothing is ever **totalled across currencies** — a result
 * in two currencies is two results. And no view carries a bank account, a national identifier, a
 * name or any personal data: Payroll holds none (ADR-0038).
 */

export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

export interface PayrollGroupView {
  readonly payrollGroupId: string;
  readonly legalEntityId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly payFrequency: string;
  readonly permittedCurrencies: readonly string[];
  readonly prorationBasis: string;
  readonly roundingMode: string;
  readonly paysSuspended: boolean;
  readonly eligibilityRuleVersion: number;
  /** Which country pack would supply statutory rules. **Nothing implements one** (ADR-0067). */
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly active: boolean;
  readonly version: number;
}

export interface DeductionDefinitionView {
  readonly deductionDefinitionId: string;
  readonly payrollGroupId: string;
  readonly code: string;
  readonly name: LocalizedName;
  /** `statutory`, `benefit` and `loan_advance` are reserved and have **no producer** in Phase 11. */
  readonly deductionSource: string;
  readonly payrollTreatmentCode: string;
  readonly basis: string;
  readonly fixedAmount?: MoneyAmountView;
  readonly basisPoints?: number;
  readonly roundingMode: string;
  readonly priority: number;
  readonly active: boolean;
}

export interface PayrollPeriodView {
  readonly payrollPeriodId: string;
  readonly payrollGroupId: string;
  readonly code: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly paymentDate: string;
  readonly status: string;
  readonly openedAt?: Date;
  readonly closedAt?: Date;
  readonly version: number;
}

/**
 * A run, and everything needed to say what it was calculated from and under which rules.
 *
 * `accountingPreparedAt` and `paymentPreparedAt` are the only progress this system claims. There is
 * no `postedAt` and no `executedAt`, because nothing posts a journal or moves money.
 */
export interface PayrollRunView {
  readonly payrollRunId: string;
  readonly payrollPeriodId: string;
  readonly payrollGroupId: string;
  readonly runSequence: number;
  readonly runKind: string;
  readonly status: string;
  readonly calculationVersion: number;
  readonly ruleSetDigest: string;
  readonly populationDigest?: string;
  readonly snapshotDigest?: string;
  readonly eligibilityRuleVersion: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly populationSize: number;
  readonly resultCount: number;
  readonly exceptionCount: number;
  readonly staleCount: number;
  readonly calculatedAt?: Date;
  readonly calculatedBy?: string;
  readonly approvedAt?: Date;
  readonly approvedBy?: string;
  readonly finalizedAt?: Date;
  readonly finalizedBy?: string;
  readonly reversalOfRunId?: string;
  readonly staleDetectedAt?: Date;
  readonly accountingPreparedAt?: Date;
  readonly paymentPreparedAt?: Date;
  /** False while the cursor has not covered the population. A partial run cannot be approved. */
  readonly complete: boolean;
}

/** What produced a figure: the basis, the fraction, the rounding, and a pack's own source code. */
export interface CalculationDetailView {
  readonly basisAmountMinor?: string;
  readonly numerator?: number;
  readonly denominator?: number;
  readonly prorationBasis?: string;
  readonly prorationCause?: string;
  readonly basisPoints?: number;
  readonly minutes?: number;
  readonly roundingMode?: string;
  readonly statutorySourceCode?: string;
}

export interface EarningLineView {
  readonly earningLineId: string;
  readonly sequence: number;
  /** `attendance_overtime` is declared and **unreachable** in Phase 11 (ADR-0065). */
  readonly earningSource: string;
  readonly componentId?: string;
  readonly componentCode: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmountView;
  readonly calculationReason: string;
  readonly detail: CalculationDetailView;
  readonly sourceReference?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
}

export interface DeductionLineView {
  readonly deductionLineId: string;
  readonly sequence: number;
  readonly deductionSource: string;
  readonly deductionCode: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmountView;
  readonly calculationReason: string;
  readonly detail: CalculationDetailView;
  readonly sourceReference?: string;
  readonly priority: number;
}

/** One employment's result **in one currency**. Two currencies is two of these and no total. */
export interface PayrollResultView {
  readonly payrollResultId: string;
  readonly payrollRunId: string;
  readonly employmentId: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly gross: MoneyAmountView;
  readonly totalDeductions: MoneyAmountView;
  readonly net: MoneyAmountView;
  readonly snapshotDigest: string;
  readonly calculationVersion: number;
  readonly finalized: boolean;
}

export interface PayrollExceptionView {
  readonly payrollExceptionId: string;
  readonly employmentId: string;
  readonly exceptionCode: string;
  readonly detail?: Readonly<Record<string, string>>;
  readonly resolvedAt?: Date;
}

export interface PayrollAdjustmentView {
  readonly payrollAdjustmentId: string;
  readonly employmentId: string;
  readonly kind: string;
  readonly code: string;
  readonly amount: MoneyAmountView;
  readonly reasonCode: string;
  /** Present only for a caller holding `payroll.adjust`. Absent is meaningful. */
  readonly note?: string;
  readonly retroactiveOfPeriodId?: string;
  readonly requestedBy: string;
  readonly recordedAt: Date;
}

/** The approval chain, in `ApprovalPort`'s shape, so Phase 16 changes the source and not this. */
export interface PayrollApprovalStepView {
  readonly sequence: number;
  readonly decision: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly comment?: string;
  readonly reversesDecisionId?: string;
}

export interface PayrollApprovalChainView {
  readonly payrollRunId: string;
  readonly required: boolean;
  readonly state: string;
  readonly steps: readonly PayrollApprovalStepView[];
}

/** What reconciliation found. Nothing here repaired anything. */
export interface PayrollReconciliationView {
  readonly employmentId: string;
  readonly staleSource: string;
  readonly previousDigest?: string;
  readonly currentDigest?: string;
  readonly detectedAt: Date;
}

/**
 * The accounting output: balanced debit and credit lines, in Payroll's own table.
 *
 * `accountReference` is an **opaque tenant code**. There is no Finance module, no ledger and no
 * chart of accounts in this repository, and nothing here posts (ADR-0067).
 */
export interface AccountingLineView {
  readonly accountingLineId: string;
  readonly employmentId: string;
  readonly direction: string;
  readonly accountReference: string;
  readonly costCenterId?: string;
  readonly unitId?: string;
  readonly amount: MoneyAmountView;
  readonly journalReference: string;
}

/**
 * A payment instruction that **nothing executes**.
 *
 * No account number, no IBAN, no card token, no credential. `payeeAccountRef` is reserved and null
 * in this phase; there is no bank domain to populate it from. `status` is `prepared` and nothing
 * further.
 */
export interface PaymentInstructionView {
  readonly paymentInstructionId: string;
  readonly employmentId: string;
  readonly amount: MoneyAmountView;
  readonly paymentDate: string;
  readonly paymentMethodCode: string;
  readonly paymentReference: string;
  readonly payeeAccountRef?: string;
  readonly status: string;
}

/**
 * The payslip **data**, and only the data.
 *
 * Payroll owns this; rendering, storage and delivery belong to a future Document domain, and no
 * `DocumentPort` exists in this repository — so no PDF is produced and no file is stored
 * (ADR-0067). It carries no name and no personal data: whatever renders it resolves those under its
 * own permissions (ADR-0038).
 */
export interface PayslipView {
  readonly payrollResultId: string;
  readonly employmentId: string;
  readonly periodCode: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly paymentDate: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly gross: MoneyAmountView;
  readonly totalDeductions: MoneyAmountView;
  readonly net: MoneyAmountView;
  readonly earnings: readonly EarningLineView[];
  readonly deductions: readonly DeductionLineView[];
  readonly calculationVersion: number;
  readonly snapshotDigest: string;
  readonly finalized: boolean;
}

export interface PayrollDashboardView {
  readonly openPeriods: number;
  readonly runsAwaitingApproval: number;
  /** The number that grows when something is quietly not working. A human can watch it grow. */
  readonly staleRuns: number;
  readonly unresolvedExceptions: number;
  readonly finalizedThisMonth: number;
  readonly groupsConfigured: number;
}
