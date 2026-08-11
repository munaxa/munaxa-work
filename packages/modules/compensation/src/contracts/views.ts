import type { MoneyAmountView } from '../domain/money-amount.js';

/**
 * The views Compensation publishes.
 *
 * Every monetary figure is a `MoneyAmountView`: exact minor units as a **decimal string**, the
 * decimal rendering beside it, and the currency's code and exponent. Never a JSON number — one
 * would lose precision above 2^53 and would invite a `Number()` at the far end, which is where a
 * payslip loses a fil.
 *
 * **Nothing here is a persistence model.** Each view is assembled by a query handler from the
 * authoritative rows, so a column rename is not a contract change.
 */

export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

export interface CompensationPlanView {
  readonly compensationPlanId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly versionNumber: number;
  readonly status: string;
  readonly salaryStructureId?: string;
  readonly defaultCurrencyCode: string;
  readonly defaultCurrencyExponent: number;
  readonly approvalRequired: boolean;
  readonly approvalsRequired: number;
  readonly selfApprovalPermitted: boolean;
  readonly maximumIncreaseBasisPoints?: number;
  readonly maximumDecreaseBasisPoints?: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly publishedAt?: Date;
  readonly assignments: readonly PlanAssignmentView[];
  readonly components: readonly PlanComponentView[];
}

export interface PlanAssignmentView {
  readonly planAssignmentId: string;
  readonly scope: string;
  readonly scopeId?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
}

export interface PlanComponentView {
  readonly componentId: string;
  readonly mandatory: boolean;
  readonly minimum?: MoneyAmountView;
  readonly maximum?: MoneyAmountView;
}

export interface SalaryStructureView {
  readonly salaryStructureId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: string;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface PayRangeView {
  readonly minimum: MoneyAmountView;
  readonly midpoint: MoneyAmountView;
  readonly maximum: MoneyAmountView;
}

export interface PayGradeView {
  readonly payGradeId: string;
  readonly salaryStructureId?: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: string;
  readonly range: PayRangeView;
  /**
   * Organization's opaque job-architecture label, where a tenant chose to relate the two.
   *
   * A label rather than a foreign key (D-8): Organization's `position.grade` is a band somebody
   * authored, this is a monetary range, and a foreign key would make Compensation unable to price
   * anything Organization had not graded.
   */
  readonly positionGradeLabel?: string;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface PayScaleView {
  readonly payScaleId: string;
  readonly payGradeId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly range: PayRangeView;
  /** A code, stored and never acted on. Nothing here moves anybody between steps. */
  readonly progressionModel: string;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface SalaryStepView {
  readonly salaryStepId: string;
  readonly payScaleId?: string;
  readonly payGradeId?: string;
  readonly stepNumber: number;
  readonly code?: string;
  readonly amount: MoneyAmountView;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface CompensationComponentView {
  readonly componentId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly kind: string;
  readonly calculationBasis: string;
  readonly basisComponentId?: string;
  readonly percentageBasisPoints?: number;
  readonly roundingMode: string;
  readonly recurrence: string;
  /** A tenant or country-pack code. **Travels uninterpreted**; Compensation never reads it. */
  readonly payrollTreatmentCode: string;
  readonly proratable: boolean;
  readonly statutorySourceCode?: string;
  readonly status: string;
  readonly versionNumber: number;
}

/** Where an amount came from, when it was resolved from a percentage. Published so a screen and
 *  Payroll cannot arrive at different figures by rounding differently (D-3). */
export interface PercentageResolutionView {
  readonly basisComponentId: string;
  readonly percentageBasisPoints: number;
  readonly roundingMode: string;
  readonly basisAmount: MoneyAmountView;
}

export interface RecurringCompensationView {
  readonly recurringId: string;
  readonly employmentId: string;
  readonly componentId: string;
  readonly componentCode: string;
  readonly compensationPlanId: string;
  readonly payGradeId?: string;
  readonly payScaleId?: string;
  readonly salaryStepId?: string;
  readonly amount: MoneyAmountView;
  readonly resolvedFrom?: PercentageResolutionView;
  /** Business time: what was true on this date. */
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  /** System time: when we learned it. The pair is what makes a retroactive change explainable. */
  readonly recordedAt: Date;
  readonly recordedBy: string;
  readonly source: string;
  readonly reasonCode?: string;
  readonly approvalState: string;
  readonly supersedesId?: string;
}

export interface OneTimeCompensationView {
  readonly oneTimeId: string;
  readonly employmentId: string;
  readonly componentId: string;
  readonly componentCode: string;
  readonly amount: MoneyAmountView;
  readonly payableOn: string;
  readonly reasonCode: string;
  readonly source: string;
  readonly recordedAt: Date;
  readonly approvalState: string;
}

/**
 * An adjustment, and the reason behind it.
 *
 * `note` and `reasonCode` are **separately permissioned** from the figures: a caller holding
 * `compensation.read` but not `compensation.adjust` sees the amounts and not the sentence somebody
 * wrote about why they changed.
 */
export interface CompensationAdjustmentView {
  readonly adjustmentId: string;
  readonly employmentId: string;
  readonly componentId?: string;
  readonly adjustmentType: string;
  readonly previousAmount?: MoneyAmountView;
  readonly newAmount?: MoneyAmountView;
  readonly effectiveFrom: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly requestedBy: string;
  readonly recordedAt: Date;
  readonly approvalState: string;
}

export interface CompensationChangeView {
  readonly changeId: string;
  readonly employmentId: string;
  readonly componentId?: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly changeKind: string;
  readonly effectiveFrom?: string;
  readonly recordedAt: Date;
  readonly actor: string;
  readonly reasonCode?: string;
  readonly source: string;
}

/**
 * The approval chain, in `ApprovalPort`'s shape.
 *
 * Field for field the same as Recruitment's and Leave's, so Phase 16 Workflow changes the *source*
 * of a decision without changing this contract. `required: false` with no steps is how a plan that
 * needs no approval is published — never a fabricated `system:auto-approval` step.
 */
export interface CompensationApprovalStepView {
  readonly sequence: number;
  readonly decision: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly comment?: string;
  readonly reversesDecisionId?: string;
}

export interface CompensationApprovalChainView {
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly required: boolean;
  readonly approvalsRequired: number;
  readonly state: string;
  readonly steps: readonly CompensationApprovalStepView[];
}

/** One employment's compensation as at a date, grouped by currency and never summed across them. */
export interface EmploymentCompensationView {
  readonly employmentId: string;
  readonly asOf: string;
  readonly compensationPlanId?: string;
  readonly components: readonly RecurringCompensationView[];
  /** One entry per currency. **Nothing is ever totalled across currencies** (§20.4). */
  readonly totalsByCurrency: readonly MoneyAmountView[];
}

/**
 * **The Phase 11 contract.** What Payroll consumes.
 *
 * Three rules govern it. `amountMinor` is a decimal string, not a number.
 * `payrollTreatmentCode` travels uninterpreted. `partialPeriod` states a fact and prorates nothing
 * — whether a mid-period change is scaled by calendar days, working days or a statutory formula is
 * a payroll and jurisdictional question.
 *
 * What it does **not** contain is as much a part of the contract as what it does: no gross, no net,
 * no tax, no social security, no overtime pay, no unpaid-leave deduction, no end-of-service and no
 * currency conversion.
 */
export interface CompensationPeriodComponentView {
  readonly componentId: string;
  readonly componentCode: string;
  readonly kind: string;
  readonly payrollTreatmentCode: string;
  readonly proratable: boolean;
  readonly amount: MoneyAmountView;
  readonly resolvedFrom?: PercentageResolutionView;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  /** True where the period does not span the whole payroll period. Payroll decides proration. */
  readonly partialPeriod: boolean;
}

export interface CompensationPeriodOneTimeView {
  readonly oneTimeId: string;
  readonly componentId: string;
  readonly componentCode: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmountView;
  readonly payableOn: string;
}

export interface CompensationCurrencyBlockView {
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly recurring: readonly CompensationPeriodComponentView[];
  readonly oneTime: readonly CompensationPeriodOneTimeView[];
}

export interface CompensationPeriodView {
  readonly employmentId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** One block per currency. Nothing is ever summed across currencies. */
  readonly currencies: readonly CompensationCurrencyBlockView[];
  readonly compensationPlanId?: string;
  readonly planVersion?: number;
  /** The same inputs give the same digest, so a disputed figure is explainable. */
  readonly inputsDigest: string;
  readonly calculationVersion: number;
}

/** What has moved since Payroll last looked. The reconciliation read; nothing is pushed. */
export interface CompensationChangedSinceView {
  readonly recordedAfter: Date;
  readonly employmentIds: readonly string[];
  readonly recurring: readonly RecurringCompensationView[];
  readonly oneTime: readonly OneTimeCompensationView[];
  /** True when the page filled — the caller should ask again from the last `recordedAt`. */
  readonly truncated: boolean;
}

export interface ImportBatchView {
  readonly importBatchId: string;
  readonly source: string;
  readonly sourceLabel?: string;
  readonly submittedAt: Date;
  readonly submittedBy: string;
  readonly rowsSubmitted: number;
  readonly rowsCreated: number;
  readonly rowsSkipped: number;
  readonly rowsFailed: number;
}

export interface CompensationDashboardView {
  readonly plansPublished: number;
  readonly componentsConfigured: number;
  readonly awaitingApproval: number;
  readonly effectiveThisMonth: number;
  readonly futureDatedChanges: number;
  /** Employments with no compensation at all. A real answer, reported rather than shown as zero. */
  readonly employmentsWithoutCompensation: number;
}
