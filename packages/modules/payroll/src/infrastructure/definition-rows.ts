import type { RuleDefinition } from '@work/kernel';

import type { DeductionDefinitionState } from '../domain/deductions.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type { PayFrequency, ProrationBasis, RoundingMode } from '../domain/payroll-vocabulary.js';
import type { PeriodStatus } from '../domain/payroll-vocabulary.js';
import { asBigInt, asNumber, orNull, orNullMinor, type RowValues } from './row-writer.js';

/**
 * Rows to state and back, for the configuration tables.
 *
 * Two conventions carry through every mapper in this module. **`version` never appears in a values
 * map** — `auditForInsert` writes it on insert and `Repository.updateRow` appends
 * `version = version + 1`, so including it produces "multiple assignments to same column", which is
 * the defect Phase 10 found the hard way. And **every monetary column round-trips as a string**:
 * `bigint` arrives from the driver as text and is parsed with `BigInt`, never `Number`.
 */

export interface PayrollGroupRow {
  readonly id: string;
  readonly legal_entity_id: string;
  readonly code: string;
  readonly name: Record<string, string>;
  readonly pay_frequency: string;
  readonly permitted_currencies: { readonly code: string; readonly exponent: number }[];
  readonly proration_basis: string;
  readonly rounding_mode: string;
  readonly pays_suspended: boolean;
  readonly eligibility_rule: RuleDefinition | null;
  readonly eligibility_rule_version: number;
  readonly country_pack_id: string | null;
  readonly country_pack_version: number | null;
  readonly expense_account: string;
  readonly deduction_account: string;
  readonly payable_account: string;
  readonly payment_method_code: string;
  readonly active: boolean;
  readonly version: number;
}

export const groupState = (row: PayrollGroupRow): PayrollGroupState => ({
  payrollGroupId: row.id,
  legalEntityId: row.legal_entity_id,
  code: row.code,
  name: row.name,
  payFrequency: row.pay_frequency as PayFrequency,
  permittedCurrencies: row.permitted_currencies.map((currency) => currency.code),
  currencyExponents: Object.fromEntries(
    row.permitted_currencies.map((currency) => [currency.code, currency.exponent]),
  ),
  prorationBasis: row.proration_basis as ProrationBasis,
  roundingMode: row.rounding_mode as RoundingMode,
  paysSuspended: row.pays_suspended,
  ...(row.eligibility_rule === null ? {} : { eligibilityRule: row.eligibility_rule }),
  eligibilityRuleVersion: asNumber(row.eligibility_rule_version),
  ...(row.country_pack_id === null ? {} : { countryPackId: row.country_pack_id }),
  ...(row.country_pack_version === null
    ? {}
    : { countryPackVersion: asNumber(row.country_pack_version) }),
  expenseAccount: row.expense_account,
  deductionAccount: row.deduction_account,
  payableAccount: row.payable_account,
  paymentMethodCode: row.payment_method_code,
  active: row.active,
  version: asNumber(row.version),
});

export const groupValues = (state: PayrollGroupState, tenantId: string): RowValues => ({
  id: state.payrollGroupId,
  tenant_id: tenantId,
  legal_entity_id: state.legalEntityId,
  code: state.code,
  name: JSON.stringify(state.name),
  pay_frequency: state.payFrequency,
  permitted_currencies: JSON.stringify(
    state.permittedCurrencies.map((code) => ({
      code,
      exponent: state.currencyExponents[code] ?? 0,
    })),
  ),
  proration_basis: state.prorationBasis,
  rounding_mode: state.roundingMode,
  pays_suspended: state.paysSuspended,
  eligibility_rule:
    state.eligibilityRule === undefined ? null : JSON.stringify(state.eligibilityRule),
  eligibility_rule_version: state.eligibilityRuleVersion,
  country_pack_id: orNull(state.countryPackId),
  country_pack_version: orNull(state.countryPackVersion),
  expense_account: state.expenseAccount,
  deduction_account: state.deductionAccount,
  payable_account: state.payableAccount,
  payment_method_code: state.paymentMethodCode,
  active: state.active,
});

export interface DeductionDefinitionRow {
  readonly id: string;
  readonly payroll_group_id: string;
  readonly code: string;
  readonly name: Record<string, string>;
  readonly deduction_source: string;
  readonly payroll_treatment_code: string;
  readonly basis: string;
  readonly amount_minor: string | null;
  readonly currency_code: string | null;
  readonly currency_exponent: number | null;
  readonly basis_points: number | null;
  readonly rounding_mode: string;
  readonly priority: number;
  readonly active: boolean;
  readonly version: number;
}

export const deductionDefinitionState = (
  row: DeductionDefinitionRow,
): DeductionDefinitionState => ({
  deductionDefinitionId: row.id,
  payrollGroupId: row.payroll_group_id,
  code: row.code,
  name: row.name,
  deductionSource: row.deduction_source as DeductionDefinitionState['deductionSource'],
  payrollTreatmentCode: row.payroll_treatment_code,
  basis: row.basis as DeductionDefinitionState['basis'],
  ...(row.amount_minor === null || row.currency_code === null || row.currency_exponent === null
    ? {}
    : {
        fixedAmount: {
          amountMinor: asBigInt(row.amount_minor),
          currencyCode: row.currency_code,
          currencyExponent: asNumber(row.currency_exponent),
        },
      }),
  ...(row.basis_points === null ? {} : { basisPoints: asNumber(row.basis_points) }),
  roundingMode: row.rounding_mode as RoundingMode,
  priority: asNumber(row.priority),
  active: row.active,
  version: asNumber(row.version),
});

export const deductionDefinitionValues = (
  state: DeductionDefinitionState,
  tenantId: string,
): RowValues => ({
  id: state.deductionDefinitionId,
  tenant_id: tenantId,
  payroll_group_id: state.payrollGroupId,
  code: state.code,
  name: JSON.stringify(state.name),
  deduction_source: state.deductionSource,
  payroll_treatment_code: state.payrollTreatmentCode,
  basis: state.basis,
  amount_minor: orNullMinor(state.fixedAmount?.amountMinor),
  currency_code: orNull(state.fixedAmount?.currencyCode),
  currency_exponent: orNull(state.fixedAmount?.currencyExponent),
  basis_points: orNull(state.basisPoints),
  rounding_mode: state.roundingMode,
  priority: state.priority,
  active: state.active,
});

export interface PayrollPeriodRow {
  readonly id: string;
  readonly payroll_group_id: string;
  readonly code: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly payment_date: string;
  readonly status: string;
  readonly opened_at: Date | null;
  readonly opened_by: string | null;
  readonly closed_at: Date | null;
  readonly closed_by: string | null;
  readonly version: number;
}

export const periodState = (row: PayrollPeriodRow): PayrollPeriodState => ({
  payrollPeriodId: row.id,
  payrollGroupId: row.payroll_group_id,
  code: row.code,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  paymentDate: row.payment_date,
  status: row.status as PeriodStatus,
  ...(row.opened_at === null ? {} : { openedAt: row.opened_at }),
  ...(row.opened_by === null ? {} : { openedBy: row.opened_by }),
  ...(row.closed_at === null ? {} : { closedAt: row.closed_at }),
  ...(row.closed_by === null ? {} : { closedBy: row.closed_by }),
  version: asNumber(row.version),
});

export const periodValues = (state: PayrollPeriodState, tenantId: string): RowValues => ({
  id: state.payrollPeriodId,
  tenant_id: tenantId,
  payroll_group_id: state.payrollGroupId,
  code: state.code,
  period_start: state.periodStart,
  period_end: state.periodEnd,
  payment_date: state.paymentDate,
  status: state.status,
  opened_at: orNull(state.openedAt),
  opened_by: orNull(state.openedBy),
  closed_at: orNull(state.closedAt),
  closed_by: orNull(state.closedBy),
});

/** Read as text so a civil date is not shifted by the process's local midnight. See `row-writer`. */
export const PERIOD_COLUMNS = `p.id, p.payroll_group_id, p.code,
  to_char(p.period_start, 'YYYY-MM-DD') as period_start,
  to_char(p.period_end, 'YYYY-MM-DD') as period_end,
  to_char(p.payment_date, 'YYYY-MM-DD') as payment_date,
  p.status, p.opened_at, p.opened_by, p.closed_at, p.closed_by, p.version`;
