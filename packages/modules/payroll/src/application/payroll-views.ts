import { moneyView } from '../domain/money-amount.js';
import { definedOnly } from '../domain/optional-fields.js';
import { standingApprovals } from '../domain/payroll-approval.js';
import type { DeductionDefinitionState } from '../domain/deductions.js';
import type { ApprovalDecisionState } from '../domain/payroll-approval.js';
import type { PayrollAdjustmentState } from '../domain/payroll-adjustment.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type {
  DeductionLine,
  EarningLine,
  PayrollExceptionState,
  PayrollResultState,
} from '../domain/payroll-lines.js';
import type { AccountingLine, PaymentInstruction } from '../domain/payroll-outputs.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type { PayrollRunState } from '../domain/payroll-run.js';
import type {
  AccountingLineView,
  DeductionDefinitionView,
  DeductionLineView,
  EarningLineView,
  LocalizedName,
  PaymentInstructionView,
  PayrollAdjustmentView,
  PayrollApprovalChainView,
  PayrollExceptionView,
  PayrollGroupView,
  PayrollPeriodView,
  PayrollResultView,
  PayrollRunView,
} from '../contracts/views.js';

/**
 * State to view, in one place, so eighteen query handlers cannot drift into eighteen spellings of
 * the same conversion.
 *
 * Two rules are enforced here rather than trusted to each caller. Every monetary field goes through
 * `moneyView`, so no figure reaches the wire as a JSON number. And optional fields are spread
 * through `definedOnly`, so an absent value is an **absent key** — which matters most for an
 * adjustment's `note`: a `null` would tell a caller who may not read it that a note exists.
 */

const named = (name: Readonly<Record<string, string>>): LocalizedName => ({
  en: name['en'] ?? '',
  ar: name['ar'] ?? '',
});

export const groupView = (state: PayrollGroupState): PayrollGroupView => ({
  payrollGroupId: state.payrollGroupId,
  legalEntityId: state.legalEntityId,
  code: state.code,
  name: named(state.name),
  payFrequency: state.payFrequency,
  permittedCurrencies: state.permittedCurrencies,
  prorationBasis: state.prorationBasis,
  roundingMode: state.roundingMode,
  paysSuspended: state.paysSuspended,
  eligibilityRuleVersion: state.eligibilityRuleVersion,
  active: state.active,
  version: state.version,
  ...definedOnly({
    countryPackId: state.countryPackId,
    countryPackVersion: state.countryPackVersion,
  }),
});

export const deductionDefinitionView = (
  state: DeductionDefinitionState,
): DeductionDefinitionView => ({
  deductionDefinitionId: state.deductionDefinitionId,
  payrollGroupId: state.payrollGroupId,
  code: state.code,
  name: named(state.name),
  deductionSource: state.deductionSource,
  payrollTreatmentCode: state.payrollTreatmentCode,
  basis: state.basis,
  roundingMode: state.roundingMode,
  priority: state.priority,
  active: state.active,
  ...definedOnly({
    fixedAmount: state.fixedAmount === undefined ? undefined : moneyView(state.fixedAmount),
    basisPoints: state.basisPoints,
  }),
});

export const periodView = (state: PayrollPeriodState): PayrollPeriodView => ({
  payrollPeriodId: state.payrollPeriodId,
  payrollGroupId: state.payrollGroupId,
  code: state.code,
  periodStart: state.periodStart,
  periodEnd: state.periodEnd,
  paymentDate: state.paymentDate,
  status: state.status,
  version: state.version,
  ...definedOnly({ openedAt: state.openedAt, closedAt: state.closedAt }),
});

export const runView = (state: PayrollRunState): PayrollRunView => ({
  payrollRunId: state.payrollRunId,
  payrollPeriodId: state.payrollPeriodId,
  payrollGroupId: state.payrollGroupId,
  runSequence: state.runSequence,
  runKind: state.runKind,
  status: state.status,
  calculationVersion: state.calculationVersion,
  ruleSetDigest: state.ruleSetDigest,
  eligibilityRuleVersion: state.eligibilityRuleVersion,
  populationSize: state.populationSize,
  resultCount: state.resultCount,
  exceptionCount: state.exceptionCount,
  staleCount: state.staleCount,
  // The cursor being spent is what makes a run complete; a partial run cannot be approved.
  complete: state.cursor === undefined && state.status !== 'draft',
  ...definedOnly({
    populationDigest: state.populationDigest,
    snapshotDigest: state.snapshotDigest,
    countryPackId: state.countryPackId,
    countryPackVersion: state.countryPackVersion,
    calculatedAt: state.calculatedAt,
    calculatedBy: state.calculatedBy,
    approvedAt: state.approvedAt,
    approvedBy: state.approvedBy,
    finalizedAt: state.finalizedAt,
    finalizedBy: state.finalizedBy,
    reversalOfRunId: state.reversalOfRunId,
    staleDetectedAt: state.staleDetectedAt,
    accountingPreparedAt: state.accountingPreparedAt,
    paymentPreparedAt: state.paymentPreparedAt,
  }),
});

export const resultView = (state: PayrollResultState, finalized: boolean): PayrollResultView => ({
  payrollResultId: state.payrollResultId,
  payrollRunId: state.payrollRunId,
  employmentId: state.employmentId,
  currencyCode: state.currencyCode,
  currencyExponent: state.currencyExponent,
  gross: moneyView(state.gross),
  totalDeductions: moneyView(state.totalDeductions),
  net: moneyView(state.net),
  snapshotDigest: state.snapshotDigest,
  calculationVersion: state.calculationVersion,
  finalized,
});

export const earningView = (line: EarningLine): EarningLineView => ({
  earningLineId: line.earningLineId,
  sequence: line.sequence,
  earningSource: line.earningSource,
  componentCode: line.componentCode,
  payrollTreatmentCode: line.payrollTreatmentCode,
  amount: moneyView(line.amount),
  calculationReason: line.calculationReason,
  detail: line.detail,
  ...definedOnly({
    componentId: line.componentId,
    sourceReference: line.sourceReference,
    effectiveFrom: line.effectiveFrom,
    effectiveTo: line.effectiveTo,
  }),
});

export const deductionView = (line: DeductionLine): DeductionLineView => ({
  deductionLineId: line.deductionLineId,
  sequence: line.sequence,
  deductionSource: line.deductionSource,
  deductionCode: line.deductionCode,
  payrollTreatmentCode: line.payrollTreatmentCode,
  amount: moneyView(line.amount),
  calculationReason: line.calculationReason,
  detail: line.detail,
  priority: line.priority,
  ...definedOnly({ sourceReference: line.sourceReference }),
});

export const exceptionView = (state: PayrollExceptionState): PayrollExceptionView => ({
  payrollExceptionId: state.payrollExceptionId,
  employmentId: state.employmentId,
  exceptionCode: state.exceptionCode,
  ...definedOnly({ detail: state.detail, resolvedAt: state.resolvedAt }),
});

/**
 * An adjustment, with the note **omitted** for a caller who may not read it.
 *
 * Reading a figure is not reading the reason behind it. An absent key says nothing about whether a
 * note exists; `null` would say one does, which is itself a disclosure about somebody's pay.
 */
export const adjustmentView = (
  state: PayrollAdjustmentState,
  mayReadNote: boolean,
): PayrollAdjustmentView => ({
  payrollAdjustmentId: state.payrollAdjustmentId,
  employmentId: state.employmentId,
  kind: state.kind,
  code: state.code,
  amount: moneyView(state.amount),
  reasonCode: state.reasonCode,
  requestedBy: state.requestedBy,
  recordedAt: state.recordedAt,
  ...definedOnly({
    note: mayReadNote ? state.note : undefined,
    retroactiveOfPeriodId: state.retroactiveOfPeriodId,
  }),
});

export const approvalChainView = (
  payrollRunId: string,
  chain: readonly ApprovalDecisionState[],
): PayrollApprovalChainView => ({
  payrollRunId,
  // Approval is always required for a payroll run. There is no configuration that skips it, and no
  // `system:auto-approval` step is ever fabricated to fill the chain (ADR-0060, D-12).
  required: true,
  state: standingApprovals(chain) > 0 ? 'approved' : 'pending',
  steps: chain.map((step) => ({
    sequence: step.sequence,
    decision: step.decision,
    decidedBy: step.decidedBy,
    decidedAt: step.decidedAt,
    ...definedOnly({ comment: step.comment, reversesDecisionId: step.reversesDecisionId }),
  })),
});

export const accountingView = (line: AccountingLine): AccountingLineView => ({
  accountingLineId: line.accountingLineId,
  employmentId: line.employmentId,
  direction: line.direction,
  accountReference: line.accountReference,
  amount: moneyView(line.amount),
  journalReference: line.journalReference,
  ...definedOnly({ costCenterId: line.costCenterId, unitId: line.unitId }),
});

export const paymentView = (instruction: PaymentInstruction): PaymentInstructionView => ({
  paymentInstructionId: instruction.paymentInstructionId,
  employmentId: instruction.employmentId,
  amount: moneyView(instruction.amount),
  paymentDate: instruction.paymentDate,
  paymentMethodCode: instruction.paymentMethodCode,
  paymentReference: instruction.paymentReference,
  status: instruction.status,
  ...definedOnly({ payeeAccountRef: instruction.payeeAccountRef }),
});
