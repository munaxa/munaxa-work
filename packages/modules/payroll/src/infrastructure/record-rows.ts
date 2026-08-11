import type { ApprovalDecisionState } from '../domain/payroll-approval.js';
import type { PayrollAdjustmentState } from '../domain/payroll-adjustment.js';
import type { AccountingLine, PaymentInstruction } from '../domain/payroll-outputs.js';
import type {
  AccountingDirection,
  AdjustmentKind,
  ApprovalDecision,
} from '../domain/payroll-vocabulary.js';
import { asBigInt, asNumber, orNull, type RowValues } from './row-writer.js';

/**
 * Rows to state and back, for the record tables: adjustments, decisions and the two outputs.
 *
 * Apart from the result mappers because these are the rows nothing ever updates — an answer to
 * "what happened" rather than a figure. Every amount still round-trips as a decimal string.
 */

const present = <TKey extends string, TValue>(
  key: TKey,
  value: TValue | null,
): Partial<Record<TKey, TValue>> =>
  value === null ? {} : ({ [key]: value } as Record<TKey, TValue>);

const money = (
  amountMinor: string,
  row: { readonly currency_code: string; readonly currency_exponent: number },
): { amountMinor: bigint; currencyCode: string; currencyExponent: number } => ({
  amountMinor: asBigInt(amountMinor),
  currencyCode: row.currency_code.trim(),
  currencyExponent: asNumber(row.currency_exponent),
});

export interface AdjustmentRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly employment_id: string;
  readonly kind: string;
  readonly code: string;
  readonly payroll_treatment_code: string;
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly reason_code: string;
  readonly note: string;
  readonly retroactive_of_period_id: string | null;
  readonly retroactive_of_run_id: string | null;
  readonly requested_by: string;
  readonly recorded_at: Date;
  readonly version: number;
}

export const adjustmentState = (row: AdjustmentRow): PayrollAdjustmentState => ({
  payrollAdjustmentId: row.id,
  payrollRunId: row.payroll_run_id,
  employmentId: row.employment_id,
  kind: row.kind as AdjustmentKind,
  code: row.code,
  payrollTreatmentCode: row.payroll_treatment_code,
  amount: money(row.amount_minor, row),
  reasonCode: row.reason_code,
  note: row.note,
  requestedBy: row.requested_by,
  recordedAt: row.recorded_at,
  version: asNumber(row.version),
  ...present('retroactiveOfPeriodId', row.retroactive_of_period_id),
  ...present('retroactiveOfRunId', row.retroactive_of_run_id),
});

export const adjustmentValues = (state: PayrollAdjustmentState, tenantId: string): RowValues => ({
  id: state.payrollAdjustmentId,
  tenant_id: tenantId,
  payroll_run_id: state.payrollRunId,
  employment_id: state.employmentId,
  kind: state.kind,
  code: state.code,
  payroll_treatment_code: state.payrollTreatmentCode,
  amount_minor: state.amount.amountMinor.toString(),
  currency_code: state.amount.currencyCode,
  currency_exponent: state.amount.currencyExponent,
  reason_code: state.reasonCode,
  note: state.note,
  retroactive_of_period_id: orNull(state.retroactiveOfPeriodId),
  retroactive_of_run_id: orNull(state.retroactiveOfRunId),
  requested_by: state.requestedBy,
  recorded_at: state.recordedAt,
});

export interface DecisionRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly sequence: number;
  readonly decision: string;
  readonly decided_by: string;
  readonly decided_at: Date;
  readonly requested_by: string;
  readonly comment: string | null;
  readonly reverses_decision_id: string | null;
}

export const decisionState = (row: DecisionRow): ApprovalDecisionState => ({
  approvalDecisionId: row.id,
  payrollRunId: row.payroll_run_id,
  sequence: asNumber(row.sequence),
  decision: row.decision as ApprovalDecision,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  requestedBy: row.requested_by,
  ...present('comment', row.comment),
  ...present('reversesDecisionId', row.reverses_decision_id),
});

export const decisionValues = (state: ApprovalDecisionState, tenantId: string): RowValues => ({
  id: state.approvalDecisionId,
  tenant_id: tenantId,
  payroll_run_id: state.payrollRunId,
  sequence: state.sequence,
  decision: state.decision,
  decided_by: state.decidedBy,
  decided_at: state.decidedAt,
  requested_by: state.requestedBy,
  comment: orNull(state.comment),
  reverses_decision_id: orNull(state.reversesDecisionId),
});

export interface AccountingRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly payroll_result_id: string;
  readonly employment_id: string;
  readonly direction: string;
  readonly account_reference: string;
  readonly cost_center_id: string | null;
  readonly unit_id: string | null;
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly source_reference: string;
  readonly journal_reference: string;
}

export const accountingState = (row: AccountingRow): AccountingLine => ({
  accountingLineId: row.id,
  payrollRunId: row.payroll_run_id,
  employmentId: row.employment_id,
  direction: row.direction as AccountingDirection,
  accountReference: row.account_reference,
  amount: money(row.amount_minor, row),
  sourceReference: row.source_reference,
  journalReference: row.journal_reference,
  ...present('costCenterId', row.cost_center_id),
  ...present('unitId', row.unit_id),
});

export const accountingValues = (line: AccountingLine, tenantId: string): RowValues => ({
  id: line.accountingLineId,
  tenant_id: tenantId,
  payroll_run_id: line.payrollRunId,
  payroll_result_id: line.sourceReference,
  employment_id: line.employmentId,
  direction: line.direction,
  account_reference: line.accountReference,
  cost_center_id: orNull(line.costCenterId),
  unit_id: orNull(line.unitId),
  amount_minor: line.amount.amountMinor.toString(),
  currency_code: line.amount.currencyCode,
  currency_exponent: line.amount.currencyExponent,
  source_reference: line.sourceReference,
  journal_reference: line.journalReference,
  finalized_at: null,
});

export interface PaymentRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly payroll_result_id: string;
  readonly employment_id: string;
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly payment_date: string;
  readonly payment_method_code: string;
  readonly payment_reference: string;
  readonly payee_account_ref: string | null;
  readonly status: string;
}

export const paymentState = (row: PaymentRow): PaymentInstruction => ({
  paymentInstructionId: row.id,
  payrollRunId: row.payroll_run_id,
  payrollResultId: row.payroll_result_id,
  employmentId: row.employment_id,
  amount: money(row.amount_minor, row),
  paymentDate: row.payment_date,
  paymentMethodCode: row.payment_method_code,
  paymentReference: row.payment_reference,
  status: row.status as PaymentInstruction['status'],
  ...present('payeeAccountRef', row.payee_account_ref),
});

export const paymentValues = (instruction: PaymentInstruction, tenantId: string): RowValues => ({
  id: instruction.paymentInstructionId,
  tenant_id: tenantId,
  payroll_run_id: instruction.payrollRunId,
  payroll_result_id: instruction.payrollResultId,
  employment_id: instruction.employmentId,
  amount_minor: instruction.amount.amountMinor.toString(),
  currency_code: instruction.amount.currencyCode,
  currency_exponent: instruction.amount.currencyExponent,
  payment_date: instruction.paymentDate,
  payment_method_code: instruction.paymentMethodCode,
  payment_reference: instruction.paymentReference,
  // **Reserved, and null in this phase.** There is no bank-account domain to reference, and no
  // credential of any kind is ever stored here (ADR-0067).
  payee_account_ref: orNull(instruction.payeeAccountRef),
  status: instruction.status,
  finalized_at: null,
});
