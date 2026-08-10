import type {
  CalculationDetail,
  DeductionLine,
  EarningLine,
  PayrollExceptionState,
  PayrollResultState,
} from '../domain/payroll-lines.js';
import type { DeductionSource, EarningSource } from '../domain/payroll-vocabulary.js';
import { asBigInt, asNumber, orNull, type RowValues } from './row-writer.js';

/**
 * Rows to state and back, for everything that carries money.
 *
 * **Every amount round-trips as a decimal string.** `amount_minor` is `bigint` in the database, the
 * driver returns it as text, and `asBigInt` parses it exactly. Nothing here calls `Number` on a
 * monetary column, and the >2^53 suite exists to prove that end to end.
 */

const present = <TKey extends string, TValue>(
  key: TKey,
  value: TValue | null,
): Partial<Record<TKey, TValue>> =>
  value === null ? {} : ({ [key]: value } as Record<TKey, TValue>);

export interface ResultRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly employment_id: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly gross_amount_minor: string;
  readonly deductions_amount_minor: string;
  readonly net_amount_minor: string;
  readonly snapshot_digest: string;
  readonly calculation_version: number;
  readonly finalized_at: Date | null;
  readonly version: number;
}

/**
 * A result, without its lines.
 *
 * The lines are read separately because a payslip needs them and a results page does not: loading
 * eleven lines per employment to render a list of net figures is the N+1 this module cannot afford
 * at a hundred thousand rows.
 */
export const resultState = (row: ResultRow): PayrollResultState => ({
  payrollResultId: row.id,
  payrollRunId: row.payroll_run_id,
  employmentId: row.employment_id,
  currencyCode: row.currency_code.trim(),
  currencyExponent: asNumber(row.currency_exponent),
  gross: money(row.gross_amount_minor, row),
  totalDeductions: money(row.deductions_amount_minor, row),
  net: money(row.net_amount_minor, row),
  earnings: [],
  deductions: [],
  snapshotDigest: row.snapshot_digest,
  calculationVersion: asNumber(row.calculation_version),
});

const money = (
  amountMinor: string,
  row: { readonly currency_code: string; readonly currency_exponent: number },
): { amountMinor: bigint; currencyCode: string; currencyExponent: number } => ({
  amountMinor: asBigInt(amountMinor),
  currencyCode: row.currency_code.trim(),
  currencyExponent: asNumber(row.currency_exponent),
});

export const resultValues = (state: PayrollResultState, tenantId: string): RowValues => ({
  id: state.payrollResultId,
  tenant_id: tenantId,
  payroll_run_id: state.payrollRunId,
  employment_id: state.employmentId,
  currency_code: state.currencyCode,
  currency_exponent: state.currencyExponent,
  gross_amount_minor: state.gross.amountMinor.toString(),
  deductions_amount_minor: state.totalDeductions.amountMinor.toString(),
  net_amount_minor: state.net.amountMinor.toString(),
  snapshot_digest: state.snapshotDigest,
  calculation_version: state.calculationVersion,
  finalized_at: null,
});

export interface EarningLineRow {
  readonly id: string;
  readonly sequence: number;
  readonly earning_source: string;
  readonly component_id: string | null;
  readonly component_code: string;
  readonly payroll_treatment_code: string;
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly calculation_reason: string;
  readonly detail: CalculationDetail;
  readonly source_reference: string | null;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly employment_id: string;
}

export const earningState = (row: EarningLineRow): EarningLine => ({
  earningLineId: row.id,
  employmentId: row.employment_id,
  sequence: asNumber(row.sequence),
  earningSource: row.earning_source as EarningSource,
  componentCode: row.component_code,
  payrollTreatmentCode: row.payroll_treatment_code,
  amount: money(row.amount_minor, row),
  calculationReason: row.calculation_reason,
  detail: row.detail,
  ...present('componentId', row.component_id),
  ...present('sourceReference', row.source_reference),
  ...present('effectiveFrom', row.effective_from),
  ...present('effectiveTo', row.effective_to),
});

export const earningValues = (
  line: EarningLine,
  context: { readonly tenantId: string; readonly resultId: string; readonly runId: string },
): RowValues => ({
  id: line.earningLineId,
  tenant_id: context.tenantId,
  payroll_result_id: context.resultId,
  payroll_run_id: context.runId,
  employment_id: line.employmentId,
  sequence: line.sequence,
  earning_source: line.earningSource,
  component_id: orNull(line.componentId),
  component_code: line.componentCode,
  payroll_treatment_code: line.payrollTreatmentCode,
  amount_minor: line.amount.amountMinor.toString(),
  currency_code: line.amount.currencyCode,
  currency_exponent: line.amount.currencyExponent,
  calculation_reason: line.calculationReason,
  detail: JSON.stringify(line.detail),
  source_reference: orNull(line.sourceReference),
  effective_from: orNull(line.effectiveFrom),
  effective_to: orNull(line.effectiveTo),
  finalized_at: null,
});

export interface DeductionLineRow {
  readonly id: string;
  readonly sequence: number;
  readonly deduction_source: string;
  readonly deduction_definition_id: string | null;
  readonly deduction_code: string;
  readonly payroll_treatment_code: string;
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly calculation_reason: string;
  readonly detail: CalculationDetail;
  readonly source_reference: string | null;
  readonly priority: number;
  readonly employment_id: string;
}

export const deductionState = (row: DeductionLineRow): DeductionLine => ({
  deductionLineId: row.id,
  employmentId: row.employment_id,
  sequence: asNumber(row.sequence),
  deductionSource: row.deduction_source as DeductionSource,
  deductionCode: row.deduction_code,
  payrollTreatmentCode: row.payroll_treatment_code,
  amount: money(row.amount_minor, row),
  calculationReason: row.calculation_reason,
  detail: row.detail,
  priority: asNumber(row.priority),
  ...present('deductionDefinitionId', row.deduction_definition_id),
  ...present('sourceReference', row.source_reference),
});

export const deductionValues = (
  line: DeductionLine,
  context: { readonly tenantId: string; readonly resultId: string; readonly runId: string },
): RowValues => ({
  id: line.deductionLineId,
  tenant_id: context.tenantId,
  payroll_result_id: context.resultId,
  payroll_run_id: context.runId,
  employment_id: line.employmentId,
  sequence: line.sequence,
  deduction_source: line.deductionSource,
  deduction_definition_id: orNull(line.deductionDefinitionId),
  deduction_code: line.deductionCode,
  payroll_treatment_code: line.payrollTreatmentCode,
  amount_minor: line.amount.amountMinor.toString(),
  currency_code: line.amount.currencyCode,
  currency_exponent: line.amount.currencyExponent,
  calculation_reason: line.calculationReason,
  detail: JSON.stringify(line.detail),
  source_reference: orNull(line.sourceReference),
  priority: line.priority,
  finalized_at: null,
});

export interface ExceptionRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly employment_id: string;
  readonly exception_code: string;
  readonly detail: Record<string, string>;
  readonly resolved_at: Date | null;
  readonly resolved_by: string | null;
}

export const exceptionState = (row: ExceptionRow): PayrollExceptionState => ({
  payrollExceptionId: row.id,
  payrollRunId: row.payroll_run_id,
  employmentId: row.employment_id,
  exceptionCode: row.exception_code,
  detail: row.detail,
  ...present('resolvedAt', row.resolved_at),
  ...present('resolvedBy', row.resolved_by),
});

export const exceptionValues = (state: PayrollExceptionState, tenantId: string): RowValues => ({
  id: state.payrollExceptionId,
  tenant_id: tenantId,
  payroll_run_id: state.payrollRunId,
  employment_id: state.employmentId,
  exception_code: state.exceptionCode,
  detail: JSON.stringify(state.detail ?? {}),
  resolved_at: orNull(state.resolvedAt),
  resolved_by: orNull(state.resolvedBy),
});
