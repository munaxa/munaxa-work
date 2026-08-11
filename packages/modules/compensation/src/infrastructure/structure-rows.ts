import type { BilingualText, Metadata } from '../domain/compensation-aggregate.js';
import type { DefinitionStatus } from '../domain/compensation-vocabulary.js';
import type { MoneyAmount } from '../domain/money-amount.js';
import type { PayGradeState, PayRange, SalaryStructureState } from '../domain/salary-structure.js';
import type { PayScaleState, SalaryStepState } from '../domain/pay-scale.js';

import {
  asBigInt,
  asNumber,
  civilDateColumn,
  orNull,
  orUndefined,
  type RowValues,
} from './row-writer.js';

/**
 * Row shapes and mappers for the four hierarchy tables.
 *
 * The three range columns share one currency and one exponent per row, which is why `rangeOf` takes
 * the whole row: a range whose minimum and maximum were in different currencies is not a range, and
 * the schema makes it unrepresentable rather than merely discouraged.
 */

interface RangeColumns {
  readonly minimum_minor: string;
  readonly midpoint_minor: string;
  readonly maximum_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
}

const rangeOf = (row: RangeColumns): PayRange => {
  const currencyCode = row.currency_code.trim();
  const currencyExponent = asNumber(row.currency_exponent);

  return {
    minimum: { amountMinor: asBigInt(row.minimum_minor), currencyCode, currencyExponent },
    midpoint: { amountMinor: asBigInt(row.midpoint_minor), currencyCode, currencyExponent },
    maximum: { amountMinor: asBigInt(row.maximum_minor), currencyCode, currencyExponent },
  };
};

const rangeValues = (range: PayRange): RowValues => ({
  minimum_minor: range.minimum.amountMinor.toString(),
  midpoint_minor: range.midpoint.amountMinor.toString(),
  maximum_minor: range.maximum.amountMinor.toString(),
  currency_code: range.minimum.currencyCode,
  currency_exponent: range.minimum.currencyExponent,
});

export interface StructureRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly description: string | null;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const STRUCTURE_COLUMNS = `s.id, s.tenant_id, s.code, s.name, s.description, s.status,
  ${civilDateColumn('s.effective_from', 'effective_from')},
  ${civilDateColumn('s.effective_to', 'effective_to')},
  s.metadata, s.version`;

export const toStructure = (row: StructureRow): SalaryStructureState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  status: row.status as DefinitionStatus,
  effectiveFrom: row.effective_from,
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('description', orUndefined(row.description)),
  ...optional('effectiveTo', orUndefined(row.effective_to)),
});

export const structureValues = (state: SalaryStructureState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: orNull(state.description),
  status: state.status,
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  metadata: JSON.stringify(state.metadata),
});

export interface GradeRow extends RangeColumns {
  readonly id: string;
  readonly tenant_id: string;
  readonly salary_structure_id: string | null;
  readonly code: string;
  readonly name: BilingualText;
  readonly description: string | null;
  readonly position_grade_label: string | null;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const GRADE_COLUMNS = `g.id, g.tenant_id, g.salary_structure_id, g.code, g.name,
  g.description, g.minimum_minor, g.midpoint_minor, g.maximum_minor, g.currency_code,
  g.currency_exponent, g.position_grade_label, g.status,
  ${civilDateColumn('g.effective_from', 'effective_from')},
  ${civilDateColumn('g.effective_to', 'effective_to')},
  g.metadata, g.version`;

export const toGrade = (row: GradeRow): PayGradeState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  range: rangeOf(row),
  status: row.status as DefinitionStatus,
  effectiveFrom: row.effective_from,
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('salaryStructureId', orUndefined(row.salary_structure_id)),
  ...optional('description', orUndefined(row.description)),
  ...optional('positionGradeLabel', orUndefined(row.position_grade_label)),
  ...optional('effectiveTo', orUndefined(row.effective_to)),
});

export const gradeValues = (state: PayGradeState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  salary_structure_id: orNull(state.salaryStructureId),
  code: state.code,
  name: JSON.stringify(state.name),
  description: orNull(state.description),
  ...rangeValues(state.range),
  position_grade_label: orNull(state.positionGradeLabel),
  status: state.status,
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  metadata: JSON.stringify(state.metadata),
});

export interface ScaleRow extends RangeColumns {
  readonly id: string;
  readonly tenant_id: string;
  readonly pay_grade_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly progression_model: string;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const SCALE_COLUMNS = `s.id, s.tenant_id, s.pay_grade_id, s.code, s.name,
  s.minimum_minor, s.midpoint_minor, s.maximum_minor, s.currency_code, s.currency_exponent,
  s.progression_model, s.status,
  ${civilDateColumn('s.effective_from', 'effective_from')},
  ${civilDateColumn('s.effective_to', 'effective_to')},
  s.metadata, s.version`;

export const toScale = (row: ScaleRow): PayScaleState => ({
  id: row.id,
  tenantId: row.tenant_id,
  payGradeId: row.pay_grade_id,
  code: row.code,
  name: row.name,
  range: rangeOf(row),
  progressionModel: row.progression_model,
  status: row.status as DefinitionStatus,
  effectiveFrom: row.effective_from,
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('effectiveTo', orUndefined(row.effective_to)),
});

export const scaleValues = (state: PayScaleState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  pay_grade_id: state.payGradeId,
  code: state.code,
  name: JSON.stringify(state.name),
  ...rangeValues(state.range),
  progression_model: state.progressionModel,
  status: state.status,
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  metadata: JSON.stringify(state.metadata),
});

export interface StepRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly pay_scale_id: string | null;
  readonly pay_grade_id: string | null;
  readonly step_number: number;
  readonly code: string | null;
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const STEP_COLUMNS = `t.id, t.tenant_id, t.pay_scale_id, t.pay_grade_id, t.step_number,
  t.code, t.amount_minor, t.currency_code, t.currency_exponent,
  ${civilDateColumn('t.effective_from', 'effective_from')},
  ${civilDateColumn('t.effective_to', 'effective_to')},
  t.metadata, t.version`;

export const amountOf = (row: {
  readonly amount_minor: string;
  readonly currency_code: string;
  readonly currency_exponent: number;
}): MoneyAmount => ({
  amountMinor: asBigInt(row.amount_minor),
  currencyCode: row.currency_code.trim(),
  currencyExponent: asNumber(row.currency_exponent),
});

export const amountValues = (amount: MoneyAmount): RowValues => ({
  amount_minor: amount.amountMinor.toString(),
  currency_code: amount.currencyCode,
  currency_exponent: amount.currencyExponent,
});

export const toStep = (row: StepRow): SalaryStepState => ({
  id: row.id,
  tenantId: row.tenant_id,
  stepNumber: asNumber(row.step_number),
  amount: amountOf(row),
  effectiveFrom: row.effective_from,
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('payScaleId', orUndefined(row.pay_scale_id)),
  ...optional('payGradeId', orUndefined(row.pay_grade_id)),
  ...optional('code', orUndefined(row.code)),
  ...optional('effectiveTo', orUndefined(row.effective_to)),
});

export const stepValues = (state: SalaryStepState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  pay_scale_id: orNull(state.payScaleId),
  pay_grade_id: orNull(state.payGradeId),
  step_number: state.stepNumber,
  code: orNull(state.code),
  ...amountValues(state.amount),
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  metadata: JSON.stringify(state.metadata),
});

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };
