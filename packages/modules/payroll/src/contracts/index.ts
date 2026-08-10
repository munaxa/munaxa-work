/**
 * What Payroll publishes, and the shape of every absence in it.
 *
 * Payroll is the last module in the chain: Employment says somebody is employed, Compensation says
 * what they are entitled to, and this says what is actually paid for a period. Nothing downstream
 * exists yet, so these views have no consumer inside the repository — they are published for a
 * future Finance, payment, document and self-service phase to read, and for the admin workspace.
 *
 * Every monetary value crosses the boundary as an exact decimal string with its currency code and
 * exponent, never a JSON number (ADR-0061). Nothing is totalled across currencies. No view carries
 * a name, a national identifier or a bank account, because Payroll holds none.
 */
export type {
  AccountingLineView,
  CalculationDetailView,
  DeductionDefinitionView,
  DeductionLineView,
  EarningLineView,
  LocalizedName,
  PaymentInstructionView,
  PayrollAdjustmentView,
  PayrollApprovalChainView,
  PayrollApprovalStepView,
  PayrollDashboardView,
  PayrollExceptionView,
  PayrollGroupView,
  PayrollPeriodView,
  PayrollReconciliationView,
  PayrollResultView,
  PayrollRunView,
  PayslipView,
} from './views.js';

export type { MoneyAmountView } from '../domain/money-amount.js';
