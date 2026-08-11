/**
 * The public contract of Compensation.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories,
 * its tables and its aggregates are private and stay private.
 *
 * Five absences carry more weight than anything present.
 *
 * **No computed payment.** No gross, no net, no tax, no social security, no overtime pay, no
 * unpaid-leave deduction, no arrears and no end-of-service figure. Compensation states what an
 * employment is *entitled to*; what is actually paid for a period depends on attendance, leave,
 * proration and a jurisdiction's law, and every one of those is Payroll's (Phase 11).
 *
 * **No deduction.** Not a definition, not an assignment, not a netting. Statutory deductions are
 * Payroll's and loan recovery is Phase 10.1's, and a competing concept here would create the second
 * owner this architecture forbids (D-1).
 *
 * **No currency conversion.** Not a rate, not a table, not a function. An employment may hold
 * components in different currencies — a local salary and a foreign-currency allowance is a real
 * arrangement — and every published total is **per currency**. Nothing is ever summed across them.
 *
 * **No statutory content.** No minimum wage, no mandated housing or transport allowance, no tax
 * treatment, no social-security rule, no pension formula and no statutory progression. Every one is
 * configuration a tenant or a country pack supplies (00B). `payrollTreatmentCode` and
 * `statutorySourceCode` are codes this module stores and never interprets.
 *
 * **No employment or personal fact.** No person, no employee number, no employment status. A
 * consumer asking whether somebody is employed is asking Employment, as at a date (ADR-0051).
 *
 * Every monetary figure crosses this boundary as **exact minor units in a decimal string**, with
 * the currency's code and exponent beside it. Never a JSON number.
 *
 * Contracts are versioned. A breaking change to anything exported here requires an ADR.
 */

export type {
  ApprovalState,
  CalculationBasis,
  ChangeKind,
  CompensationSource,
  ComponentKind,
  Decision,
  DefinitionStatus,
  ImportSource,
  Recurrence,
  RoundingMode,
  Scope,
  SubjectKind,
} from '../domain/compensation-vocabulary.js';

/**
 * The state sets themselves, not just their types.
 *
 * A consumer narrowing an untyped string — a request parameter, a row — needs the set, and the
 * alternative is every consumer writing its own copy of the list.
 */
export {
  APPROVAL_STATES,
  CALCULATION_BASES,
  CHANGE_KINDS,
  COMPENSATION_SOURCES,
  COMPONENT_KINDS,
  DECISIONS,
  DEFINITION_STATUSES,
  IMPORT_SOURCES,
  RECURRENCES,
  ROUNDING_MODES,
  SCOPES,
  SCOPE_SPECIFICITY,
  SUBJECT_KINDS,
} from '../domain/compensation-vocabulary.js';

/** Money, as it crosses every boundary: exact minor units in a decimal string. */
export type { MoneyAmountView } from '../domain/money-amount.js';

export type {
  CompensationAdjustmentView,
  CompensationApprovalChainView,
  CompensationApprovalStepView,
  CompensationChangeView,
  CompensationChangedSinceView,
  CompensationComponentView,
  CompensationCurrencyBlockView,
  CompensationDashboardView,
  CompensationPeriodComponentView,
  CompensationPeriodOneTimeView,
  CompensationPeriodView,
  CompensationPlanView,
  EmploymentCompensationView,
  ImportBatchView,
  LocalizedName,
  OneTimeCompensationView,
  PayGradeView,
  PayRangeView,
  PayScaleView,
  PercentageResolutionView,
  PlanAssignmentView,
  PlanComponentView,
  RecurringCompensationView,
  SalaryStepView,
  SalaryStructureView,
} from './views.js';
