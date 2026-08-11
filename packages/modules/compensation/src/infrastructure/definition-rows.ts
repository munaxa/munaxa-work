import type { RuleDefinition } from '@work/kernel';

import type { BilingualText, Metadata } from '../domain/compensation-aggregate.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { CompensationPlanState, PlanComponentTerms } from '../domain/compensation-plan.js';
import type { PlanAssignmentState } from '../domain/plan-assignment.js';
import type {
  CalculationBasis,
  ComponentKind,
  DefinitionStatus,
  Recurrence,
  RoundingMode,
  Scope,
} from '../domain/compensation-vocabulary.js';
import type { MoneyAmount } from '../domain/money-amount.js';

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
 * Row shapes and mappers for the four configuration tables.
 *
 * Every date column is selected through `to_char(..., 'YYYY-MM-DD')` rather than as a `date`,
 * because the driver turns a `date` into a JavaScript `Date` at the *process's* local midnight — so
 * an effective-from read on a server west of UTC would come back as the previous day and a plan
 * would take effect a day early for half the world.
 *
 * Every monetary column arrives as a **string** from the driver and becomes a `bigint`. There is no
 * mapper here that produces a `number` from an amount, and there is no code path that could.
 */

export interface CompensationPlanRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly version_number: number;
  readonly status: string;
  readonly salary_structure_id: string | null;
  readonly default_currency_code: string;
  readonly default_currency_exponent: number;
  readonly approval_required: boolean;
  readonly approvals_required: number;
  readonly self_approval_permitted: boolean;
  readonly maximum_increase_basis_points: number | null;
  readonly maximum_decrease_basis_points: number | null;
  readonly country_pack_id: string | null;
  readonly country_pack_version: number | null;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const PLAN_COLUMNS = `p.id, p.tenant_id, p.code, p.name, p.version_number, p.status,
  p.salary_structure_id, p.default_currency_code, p.default_currency_exponent,
  p.approval_required, p.approvals_required, p.self_approval_permitted,
  p.maximum_increase_basis_points, p.maximum_decrease_basis_points,
  p.country_pack_id, p.country_pack_version, p.published_at, p.published_by,
  p.metadata, p.version`;

export const toPlan = (row: CompensationPlanRow): CompensationPlanState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  versionNumber: asNumber(row.version_number),
  status: row.status as DefinitionStatus,
  defaultCurrencyCode: row.default_currency_code.trim(),
  defaultCurrencyExponent: asNumber(row.default_currency_exponent),
  approvalRequired: row.approval_required,
  approvalsRequired: asNumber(row.approvals_required),
  selfApprovalPermitted: row.self_approval_permitted,
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('salaryStructureId', orUndefined(row.salary_structure_id)),
  ...optionalNumber('maximumIncreaseBasisPoints', row.maximum_increase_basis_points),
  ...optionalNumber('maximumDecreaseBasisPoints', row.maximum_decrease_basis_points),
  ...optional('countryPackId', orUndefined(row.country_pack_id)),
  ...optionalNumber('countryPackVersion', row.country_pack_version),
  ...optional('publishedAt', orUndefined(row.published_at)),
  ...optional('publishedBy', orUndefined(row.published_by)),
});

export const planValues = (state: CompensationPlanState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  version_number: state.versionNumber,
  status: state.status,
  salary_structure_id: orNull(state.salaryStructureId),
  default_currency_code: state.defaultCurrencyCode,
  default_currency_exponent: state.defaultCurrencyExponent,
  approval_required: state.approvalRequired,
  approvals_required: state.approvalsRequired,
  self_approval_permitted: state.selfApprovalPermitted,
  maximum_increase_basis_points: orNull(state.maximumIncreaseBasisPoints),
  maximum_decrease_basis_points: orNull(state.maximumDecreaseBasisPoints),
  country_pack_id: orNull(state.countryPackId),
  country_pack_version: orNull(state.countryPackVersion),
  published_at: orNull(state.publishedAt),
  published_by: orNull(state.publishedBy),
  metadata: JSON.stringify(state.metadata),
});

export interface PlanComponentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly compensation_plan_id: string;
  readonly component_id: string;
  readonly mandatory: boolean;
  readonly minimum_minor: string | null;
  readonly maximum_minor: string | null;
  readonly currency_code: string | null;
  readonly currency_exponent: number | null;
  readonly eligibility_rule: RuleDefinition | null;
  readonly version: number;
}

export const PLAN_COMPONENT_COLUMNS = `c.id, c.tenant_id, c.compensation_plan_id, c.component_id,
  c.mandatory, c.minimum_minor, c.maximum_minor, c.currency_code, c.currency_exponent,
  c.eligibility_rule, c.version`;

export const toPlanComponent = (row: PlanComponentRow): PlanComponentTerms => ({
  id: row.id,
  tenantId: row.tenant_id,
  compensationPlanId: row.compensation_plan_id,
  componentId: row.component_id,
  mandatory: row.mandatory,
  version: asNumber(row.version),
  ...optional('minimum', boundOf(row.minimum_minor, row)),
  ...optional('maximum', boundOf(row.maximum_minor, row)),
  ...optional('eligibilityRule', orUndefined(row.eligibility_rule)),
});

const boundOf = (
  minor: string | null,
  row: { readonly currency_code: string | null; readonly currency_exponent: number | null },
): MoneyAmount | undefined =>
  minor === null || row.currency_code === null || row.currency_exponent === null
    ? undefined
    : {
        amountMinor: asBigInt(minor),
        currencyCode: row.currency_code.trim(),
        currencyExponent: asNumber(row.currency_exponent),
      };

export const planComponentValues = (state: PlanComponentTerms): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  compensation_plan_id: state.compensationPlanId,
  component_id: state.componentId,
  mandatory: state.mandatory,
  minimum_minor: orNullMinor(state.minimum?.amountMinor),
  maximum_minor: orNullMinor(state.maximum?.amountMinor),
  currency_code: orNull(state.minimum?.currencyCode ?? state.maximum?.currencyCode),
  currency_exponent: orNull(state.minimum?.currencyExponent ?? state.maximum?.currencyExponent),
  eligibility_rule:
    state.eligibilityRule === undefined ? null : JSON.stringify(state.eligibilityRule),
});

export interface PlanAssignmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly compensation_plan_id: string;
  readonly scope: string;
  readonly scope_id: string | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly reason_code: string | null;
  readonly version: number;
}

export const ASSIGNMENT_COLUMNS = `a.id, a.tenant_id, a.compensation_plan_id, a.scope, a.scope_id,
  ${civilDateColumn('a.effective_from', 'effective_from')},
  ${civilDateColumn('a.effective_to', 'effective_to')},
  a.reason_code, a.version`;

export const toAssignment = (row: PlanAssignmentRow): PlanAssignmentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  compensationPlanId: row.compensation_plan_id,
  scope: row.scope as Scope,
  effectiveFrom: row.effective_from,
  version: asNumber(row.version),
  ...optional('scopeId', orUndefined(row.scope_id)),
  ...optional('effectiveTo', orUndefined(row.effective_to)),
  ...optional('reasonCode', orUndefined(row.reason_code)),
});

export const assignmentValues = (state: PlanAssignmentState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  compensation_plan_id: state.compensationPlanId,
  scope: state.scope,
  scope_id: orNull(state.scopeId),
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  reason_code: orNull(state.reasonCode),
});

export interface ComponentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly kind: string;
  readonly calculation_basis: string;
  readonly basis_component_id: string | null;
  readonly percentage_basis_points: number | null;
  readonly rounding_mode: string;
  readonly recurrence: string;
  readonly payroll_treatment_code: string;
  readonly proratable: boolean;
  readonly eligibility_rule: RuleDefinition | null;
  readonly statutory_source_code: string | null;
  readonly status: string;
  readonly version_number: number;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const COMPONENT_COLUMNS = `c.id, c.tenant_id, c.code, c.name, c.kind, c.calculation_basis,
  c.basis_component_id, c.percentage_basis_points, c.rounding_mode, c.recurrence,
  c.payroll_treatment_code, c.proratable, c.eligibility_rule, c.statutory_source_code,
  c.status, c.version_number, c.published_at, c.published_by, c.metadata, c.version`;

export const toComponent = (row: ComponentRow): CompensationComponentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  kind: row.kind as ComponentKind,
  calculationBasis: row.calculation_basis as CalculationBasis,
  roundingMode: row.rounding_mode as RoundingMode,
  recurrence: row.recurrence as Recurrence,
  payrollTreatmentCode: row.payroll_treatment_code,
  proratable: row.proratable,
  status: row.status as DefinitionStatus,
  versionNumber: asNumber(row.version_number),
  metadata: row.metadata,
  version: asNumber(row.version),
  ...optional('basisComponentId', orUndefined(row.basis_component_id)),
  ...optionalNumber('percentageBasisPoints', row.percentage_basis_points),
  ...optional('eligibilityRule', orUndefined(row.eligibility_rule)),
  ...optional('statutorySourceCode', orUndefined(row.statutory_source_code)),
  ...optional('publishedAt', orUndefined(row.published_at)),
  ...optional('publishedBy', orUndefined(row.published_by)),
});

export const componentValues = (state: CompensationComponentState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  kind: state.kind,
  calculation_basis: state.calculationBasis,
  basis_component_id: orNull(state.basisComponentId),
  percentage_basis_points: orNull(state.percentageBasisPoints),
  rounding_mode: state.roundingMode,
  recurrence: state.recurrence,
  payroll_treatment_code: state.payrollTreatmentCode,
  proratable: state.proratable,
  eligibility_rule:
    state.eligibilityRule === undefined ? null : JSON.stringify(state.eligibilityRule),
  statutory_source_code: orNull(state.statutorySourceCode),
  status: state.status,
  version_number: state.versionNumber,
  published_at: orNull(state.publishedAt),
  published_by: orNull(state.publishedBy),
  metadata: JSON.stringify(state.metadata),
});

/** One optional key, present only when the column held something. */
const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

const optionalNumber = (key: string, value: number | null): Record<string, number> =>
  value === null ? {} : { [key]: asNumber(value) };
