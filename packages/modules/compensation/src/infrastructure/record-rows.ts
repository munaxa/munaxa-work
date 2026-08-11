import type { Metadata } from '../domain/compensation-aggregate.js';
import type { AdjustmentState } from '../domain/adjustment.js';
import type { OneTimeState } from '../domain/one-time.js';
import type { RecurringState } from '../domain/recurring.js';
import type { ApprovalState, CompensationSource } from '../domain/compensation-vocabulary.js';

import { amountOf, amountValues } from './structure-rows.js';
import {
  asBigInt,
  asNumber,
  civilDateColumn,
  orNull,
  orNullMinor,
  orUndefined,
  type RowValues,
} from './row-writer.js';

/**
 * Row shapes and mappers for the authoritative records and the adjustment beside them.
 *
 * Every monetary column arrives as a **string** from the driver — which is what `bigint` columns do
 * by default, precisely so nothing above 2^53 is silently mangled — and becomes a `bigint`. There
 * is no mapper here that produces a `number` from an amount.
 */

export interface RecurringRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly component_id: string;
  readonly compensation_plan_id: string;
  readonly pay_grade_id: string | null;
  readonly pay_scale_id: string | null;
  readonly salary_step_id: string | null;
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly percentage_basis_points: number | null;
  readonly basis_component_id: string | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly recorded_at: Date;
  readonly recorded_by: string;
  readonly source: string;
  readonly source_id: string | null;
  readonly reason_code: string | null;
  readonly note: string | null;
  readonly approval_state: string;
  readonly approved_at: Date | null;
  readonly supersedes_id: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const RECURRING_COLUMNS = `r.id, r.tenant_id, r.employment_id, r.component_id,
  r.compensation_plan_id, r.pay_grade_id, r.pay_scale_id, r.salary_step_id,
  r.amount_minor, r.currency_code, r.currency_exponent,
  r.percentage_basis_points, r.basis_component_id,
  ${civilDateColumn('r.effective_from', 'effective_from')},
  ${civilDateColumn('r.effective_to', 'effective_to')},
  r.recorded_at, r.recorded_by, r.source, r.source_id, r.reason_code, r.note,
  r.approval_state, r.approved_at, r.supersedes_id, r.metadata, r.version`;

export const toRecurring = (row: RecurringRow): RecurringState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  componentId: row.component_id,
  compensationPlanId: row.compensation_plan_id,
  amount: amountOf(row),
  effectiveFrom: row.effective_from,
  recordedAt: row.recorded_at,
  recordedBy: row.recorded_by,
  source: row.source as CompensationSource,
  approvalState: row.approval_state as ApprovalState,
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('payGradeId', orUndefined(row.pay_grade_id)),
  ...optional('payScaleId', orUndefined(row.pay_scale_id)),
  ...optional('salaryStepId', orUndefined(row.salary_step_id)),
  ...optionalNumber('percentageBasisPoints', row.percentage_basis_points),
  ...optional('basisComponentId', orUndefined(row.basis_component_id)),
  ...optional('effectiveTo', orUndefined(row.effective_to)),
  ...optional('sourceId', orUndefined(row.source_id)),
  ...optional('reasonCode', orUndefined(row.reason_code)),
  ...optional('note', orUndefined(row.note)),
  ...optional('approvedAt', orUndefined(row.approved_at)),
  ...optional('supersedesId', orUndefined(row.supersedes_id)),
});

export const recurringValues = (state: RecurringState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  component_id: state.componentId,
  compensation_plan_id: state.compensationPlanId,
  pay_grade_id: orNull(state.payGradeId),
  pay_scale_id: orNull(state.payScaleId),
  salary_step_id: orNull(state.salaryStepId),
  ...amountValues(state.amount),
  percentage_basis_points: orNull(state.percentageBasisPoints),
  basis_component_id: orNull(state.basisComponentId),
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  recorded_at: state.recordedAt,
  recorded_by: state.recordedBy,
  source: state.source,
  source_id: orNull(state.sourceId),
  reason_code: orNull(state.reasonCode),
  note: orNull(state.note),
  approval_state: state.approvalState,
  approved_at: orNull(state.approvedAt),
  supersedes_id: orNull(state.supersedesId),
  metadata: JSON.stringify(state.metadata),
});

export interface OneTimeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly component_id: string;
  readonly compensation_plan_id: string;
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly payable_on: string;
  readonly reason_code: string;
  readonly note: string | null;
  readonly source: string;
  readonly source_id: string | null;
  readonly recorded_at: Date;
  readonly recorded_by: string;
  readonly approval_state: string;
  readonly approved_at: Date | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const ONE_TIME_COLUMNS = `o.id, o.tenant_id, o.employment_id, o.component_id,
  o.compensation_plan_id, o.amount_minor, o.currency_code, o.currency_exponent,
  ${civilDateColumn('o.payable_on', 'payable_on')},
  o.reason_code, o.note, o.source, o.source_id, o.recorded_at, o.recorded_by,
  o.approval_state, o.approved_at, o.metadata, o.version`;

export const toOneTime = (row: OneTimeRow): OneTimeState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  componentId: row.component_id,
  compensationPlanId: row.compensation_plan_id,
  amount: amountOf(row),
  payableOn: row.payable_on,
  reasonCode: row.reason_code,
  source: row.source as CompensationSource,
  recordedAt: row.recorded_at,
  recordedBy: row.recorded_by,
  approvalState: row.approval_state as ApprovalState,
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('note', orUndefined(row.note)),
  ...optional('sourceId', orUndefined(row.source_id)),
  ...optional('approvedAt', orUndefined(row.approved_at)),
});

export const oneTimeValues = (state: OneTimeState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  component_id: state.componentId,
  compensation_plan_id: state.compensationPlanId,
  ...amountValues(state.amount),
  payable_on: state.payableOn,
  reason_code: state.reasonCode,
  note: orNull(state.note),
  source: state.source,
  source_id: orNull(state.sourceId),
  recorded_at: state.recordedAt,
  recorded_by: state.recordedBy,
  approval_state: state.approvalState,
  approved_at: orNull(state.approvedAt),
  metadata: JSON.stringify(state.metadata),
});

export interface AdjustmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly component_id: string | null;
  readonly adjustment_type: string;
  readonly previous_amount_minor: string | null;
  readonly new_amount_minor: string | null;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly effective_from: string;
  readonly reason_code: string;
  readonly note: string;
  readonly requested_by: string;
  readonly recorded_at: Date;
  readonly approval_state: string;
  readonly recurring_id: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const ADJUSTMENT_COLUMNS = `a.id, a.tenant_id, a.employment_id, a.component_id,
  a.adjustment_type, a.previous_amount_minor, a.new_amount_minor, a.currency_code,
  a.currency_exponent, ${civilDateColumn('a.effective_from', 'effective_from')},
  a.reason_code, a.note, a.requested_by, a.recorded_at, a.approval_state, a.recurring_id,
  a.metadata, a.version`;

export const toAdjustment = (row: AdjustmentRow): AdjustmentState => {
  const currencyCode = row.currency_code.trim();
  const currencyExponent = asNumber(row.currency_exponent);

  return {
    id: row.id,
    tenantId: row.tenant_id,
    employmentId: row.employment_id,
    adjustmentType: row.adjustment_type,
    currencyCode,
    currencyExponent,
    effectiveFrom: row.effective_from,
    reasonCode: row.reason_code,
    note: row.note,
    requestedBy: row.requested_by,
    recordedAt: row.recorded_at,
    approvalState: row.approval_state as ApprovalState,
    metadata: row.metadata,
    version: asNumber(row.version),
    ...optional('componentId', orUndefined(row.component_id)),
    ...optional('recurringId', orUndefined(row.recurring_id)),
    ...optional(
      'previousAmount',
      row.previous_amount_minor === null
        ? undefined
        : { amountMinor: asBigInt(row.previous_amount_minor), currencyCode, currencyExponent },
    ),
    ...optional(
      'newAmount',
      row.new_amount_minor === null
        ? undefined
        : { amountMinor: asBigInt(row.new_amount_minor), currencyCode, currencyExponent },
    ),
  };
};

export const adjustmentValues = (state: AdjustmentState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  component_id: orNull(state.componentId),
  adjustment_type: state.adjustmentType,
  previous_amount_minor: orNullMinor(state.previousAmount?.amountMinor),
  new_amount_minor: orNullMinor(state.newAmount?.amountMinor),
  currency_code: state.currencyCode,
  currency_exponent: state.currencyExponent,
  effective_from: state.effectiveFrom,
  reason_code: state.reasonCode,
  note: state.note,
  requested_by: state.requestedBy,
  recorded_at: state.recordedAt,
  approval_state: state.approvalState,
  recurring_id: orNull(state.recurringId),
  metadata: JSON.stringify(state.metadata),
});

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

const optionalNumber = (key: string, value: number | null): Record<string, number> =>
  value === null ? {} : { [key]: asNumber(value) };
