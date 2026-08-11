import type { RuleDefinition } from '@work/kernel';

import type { BilingualText, Metadata } from '../domain/leave-aggregate.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { LeaveTypeState } from '../domain/leave-type.js';
import type { BlackoutState, PolicyAssignmentState } from '../domain/policy-assignment.js';
import type {
  AccrualMethod,
  CarryOverMethod,
  DefinitionStatus,
  DurationBasis,
  LeaveUnit,
  LeaveYearCalendar,
  ProrationBasis,
  Scope,
} from '../domain/leave-vocabulary.js';

import {
  asNumber,
  asVersion,
  civilDateColumn,
  orNull,
  orUndefined,
  type RowValues,
} from './row-writer.js';

/**
 * Row shapes and mappers for the four definition tables.
 *
 * Every date column is selected through `to_char(..., 'YYYY-MM-DD')` rather than as a `date`,
 * because the driver turns a `date` into a JavaScript `Date` at the *process's* local midnight — so
 * an effective-from read on a server west of UTC would come back as the previous day and a policy
 * would take effect a day early for half the world.
 *
 * The mappers are split into small functions rather than written as one object literal per table:
 * `leave_policy` has thirty-odd columns, and a single mapper for it would exceed the complexity
 * budget by a wide margin and read as a wall of ternaries.
 */

export interface LeaveTypeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly unit: string;
  readonly paid_treatment_code: string;
  readonly accrues: boolean;
  readonly requires_attachment: boolean;
  readonly requires_replacement: boolean;
  readonly requires_contact: boolean;
  readonly requires_address: boolean;
  readonly gender_restriction: string | null;
  readonly statutory_source_code: string | null;
  readonly status: string;
  readonly version_number: number;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const TYPE_COLUMNS = `t.id, t.tenant_id, t.code, t.name, t.unit, t.paid_treatment_code,
  t.accrues, t.requires_attachment, t.requires_replacement, t.requires_contact,
  t.requires_address, t.gender_restriction, t.statutory_source_code, t.status,
  t.version_number, t.published_at, t.published_by, t.metadata, t.version`;

export const toType = (row: LeaveTypeRow): LeaveTypeState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  unit: row.unit as LeaveUnit,
  paidTreatmentCode: row.paid_treatment_code,
  accrues: row.accrues,
  requiresAttachment: row.requires_attachment,
  requiresReplacement: row.requires_replacement,
  requiresContact: row.requires_contact,
  requiresAddress: row.requires_address,
  status: row.status as DefinitionStatus,
  versionNumber: asNumber(row.version_number),
  metadata: row.metadata,
  version: asVersion(row.version),
  ...(orUndefined(row.gender_restriction) === undefined
    ? {}
    : { genderRestriction: row.gender_restriction as string }),
  ...(orUndefined(row.statutory_source_code) === undefined
    ? {}
    : { statutorySourceCode: row.statutory_source_code as string }),
  ...(orUndefined(row.published_at) === undefined ? {} : { publishedAt: row.published_at as Date }),
  ...(orUndefined(row.published_by) === undefined
    ? {}
    : { publishedBy: row.published_by as string }),
});

export const typeValues = (state: LeaveTypeState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  unit: state.unit,
  paid_treatment_code: state.paidTreatmentCode,
  accrues: state.accrues,
  requires_attachment: state.requiresAttachment,
  requires_replacement: state.requiresReplacement,
  requires_contact: state.requiresContact,
  requires_address: state.requiresAddress,
  gender_restriction: orNull(state.genderRestriction),
  statutory_source_code: orNull(state.statutorySourceCode),
  status: state.status,
  version_number: state.versionNumber,
  published_at: orNull(state.publishedAt),
  published_by: orNull(state.publishedBy),
  metadata: JSON.stringify(state.metadata),
});

export interface LeavePolicyRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly leave_type_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly version_number: number;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly eligibility_rule: RuleDefinition<boolean> | null;
  readonly minimum_service_months: number;
  readonly available_during_probation: boolean;
  readonly maximum_consecutive_minutes: number | null;
  readonly maximum_per_request_minutes: number | null;
  readonly maximum_per_year_minutes: number | null;
  readonly minimum_notice_days: number;
  readonly maximum_backdate_days: number;
  readonly hourly_permitted: boolean;
  readonly hourly_minimum_minutes: number | null;
  readonly hourly_maximum_per_day_minutes: number | null;
  readonly hourly_maximum_per_month_minutes: number | null;
  readonly half_day_permitted: boolean;
  readonly duration_basis: string;
  readonly negative_balance_limit_minutes: number | null;
  readonly accrual_method: string;
  readonly accrual_amount_minutes: number;
  readonly proration_basis: string;
  readonly carry_over_method: string;
  readonly carry_over_cap_minutes: number | null;
  readonly carry_over_cap_percent: number | null;
  readonly carry_over_expiry_months: number | null;
  readonly leave_year_calendar: string;
  readonly leave_year_start_month: number;
  readonly leave_year_start_day: number;
  readonly approval_required: boolean;
  readonly approvals_required: number;
  readonly self_approval_permitted: boolean;
  readonly encashable: boolean;
  readonly encashment_cap_minutes: number | null;
  readonly attachment_required_beyond_minutes: number | null;
  readonly country_pack_id: string | null;
  readonly country_pack_version: string | null;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const POLICY_COLUMNS = `p.id, p.tenant_id, p.leave_type_id, p.code, p.name,
  p.version_number, p.status, ${civilDateColumn('p.effective_from', 'effective_from')},
  ${civilDateColumn('p.effective_to', 'effective_to')}, p.eligibility_rule,
  p.minimum_service_months, p.available_during_probation, p.maximum_consecutive_minutes,
  p.maximum_per_request_minutes, p.maximum_per_year_minutes, p.minimum_notice_days,
  p.maximum_backdate_days, p.hourly_permitted, p.hourly_minimum_minutes,
  p.hourly_maximum_per_day_minutes, p.hourly_maximum_per_month_minutes, p.half_day_permitted,
  p.duration_basis, p.negative_balance_limit_minutes, p.accrual_method, p.accrual_amount_minutes,
  p.proration_basis, p.carry_over_method, p.carry_over_cap_minutes, p.carry_over_cap_percent,
  p.carry_over_expiry_months, p.leave_year_calendar, p.leave_year_start_month,
  p.leave_year_start_day, p.approval_required, p.approvals_required, p.self_approval_permitted,
  p.encashable, p.encashment_cap_minutes, p.attachment_required_beyond_minutes,
  p.country_pack_id, p.country_pack_version, p.published_at, p.published_by, p.metadata, p.version`;

/** The nullable minute caps, mapped once rather than as thirteen ternaries in the main mapper. */
const optionalNumbers = (row: LeavePolicyRow): Record<string, number> => {
  const pairs: readonly (readonly [string, number | null])[] = [
    ['maximumConsecutiveMinutes', row.maximum_consecutive_minutes],
    ['maximumPerRequestMinutes', row.maximum_per_request_minutes],
    ['maximumPerYearMinutes', row.maximum_per_year_minutes],
    ['hourlyMinimumMinutes', row.hourly_minimum_minutes],
    ['hourlyMaximumPerDayMinutes', row.hourly_maximum_per_day_minutes],
    ['hourlyMaximumPerMonthMinutes', row.hourly_maximum_per_month_minutes],
    ['negativeBalanceLimitMinutes', row.negative_balance_limit_minutes],
    ['carryOverCapMinutes', row.carry_over_cap_minutes],
    ['carryOverCapPercent', row.carry_over_cap_percent],
    ['carryOverExpiryMonths', row.carry_over_expiry_months],
    ['encashmentCapMinutes', row.encashment_cap_minutes],
    ['attachmentRequiredBeyondMinutes', row.attachment_required_beyond_minutes],
  ];

  return Object.fromEntries(
    pairs.filter(([, value]) => value !== null).map(([key, value]) => [key, asNumber(value)]),
  );
};

const optionalText = (row: LeavePolicyRow): Record<string, unknown> => {
  const pairs: readonly (readonly [string, unknown])[] = [
    ['effectiveTo', row.effective_to],
    ['eligibilityRule', row.eligibility_rule],
    ['countryPackId', row.country_pack_id],
    ['countryPackVersion', row.country_pack_version],
    ['publishedAt', row.published_at],
    ['publishedBy', row.published_by],
  ];

  return Object.fromEntries(pairs.filter(([, value]) => value !== null));
};

export const toPolicy = (row: LeavePolicyRow): LeavePolicyState => ({
  id: row.id,
  tenantId: row.tenant_id,
  leaveTypeId: row.leave_type_id,
  code: row.code,
  name: row.name,
  versionNumber: asNumber(row.version_number),
  status: row.status as DefinitionStatus,
  effectiveFrom: row.effective_from,
  minimumServiceMonths: asNumber(row.minimum_service_months),
  availableDuringProbation: row.available_during_probation,
  minimumNoticeDays: asNumber(row.minimum_notice_days),
  maximumBackdateDays: asNumber(row.maximum_backdate_days),
  hourlyPermitted: row.hourly_permitted,
  halfDayPermitted: row.half_day_permitted,
  durationBasis: row.duration_basis as DurationBasis,
  accrualMethod: row.accrual_method as AccrualMethod,
  accrualAmountMinutes: asNumber(row.accrual_amount_minutes),
  prorationBasis: row.proration_basis as ProrationBasis,
  carryOverMethod: row.carry_over_method as CarryOverMethod,
  leaveYearCalendar: row.leave_year_calendar as LeaveYearCalendar,
  leaveYearStartMonth: asNumber(row.leave_year_start_month),
  leaveYearStartDay: asNumber(row.leave_year_start_day),
  approvalRequired: row.approval_required,
  approvalsRequired: asNumber(row.approvals_required),
  selfApprovalPermitted: row.self_approval_permitted,
  encashable: row.encashable,
  metadata: row.metadata,
  version: asVersion(row.version),
  ...optionalNumbers(row),
  ...optionalText(row),
});

export const policyValues = (state: LeavePolicyState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  leave_type_id: state.leaveTypeId,
  code: state.code,
  name: JSON.stringify(state.name),
  version_number: state.versionNumber,
  status: state.status,
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  eligibility_rule:
    state.eligibilityRule === undefined ? null : JSON.stringify(state.eligibilityRule),
  minimum_service_months: state.minimumServiceMonths,
  available_during_probation: state.availableDuringProbation,
  maximum_consecutive_minutes: orNull(state.maximumConsecutiveMinutes),
  maximum_per_request_minutes: orNull(state.maximumPerRequestMinutes),
  maximum_per_year_minutes: orNull(state.maximumPerYearMinutes),
  minimum_notice_days: state.minimumNoticeDays,
  maximum_backdate_days: state.maximumBackdateDays,
  hourly_permitted: state.hourlyPermitted,
  hourly_minimum_minutes: orNull(state.hourlyMinimumMinutes),
  hourly_maximum_per_day_minutes: orNull(state.hourlyMaximumPerDayMinutes),
  hourly_maximum_per_month_minutes: orNull(state.hourlyMaximumPerMonthMinutes),
  half_day_permitted: state.halfDayPermitted,
  duration_basis: state.durationBasis,
  negative_balance_limit_minutes: orNull(state.negativeBalanceLimitMinutes),
  accrual_method: state.accrualMethod,
  accrual_amount_minutes: state.accrualAmountMinutes,
  proration_basis: state.prorationBasis,
  carry_over_method: state.carryOverMethod,
  carry_over_cap_minutes: orNull(state.carryOverCapMinutes),
  carry_over_cap_percent: orNull(state.carryOverCapPercent),
  carry_over_expiry_months: orNull(state.carryOverExpiryMonths),
  leave_year_calendar: state.leaveYearCalendar,
  leave_year_start_month: state.leaveYearStartMonth,
  leave_year_start_day: state.leaveYearStartDay,
  approval_required: state.approvalRequired,
  approvals_required: state.approvalsRequired,
  self_approval_permitted: state.selfApprovalPermitted,
  encashable: state.encashable,
  encashment_cap_minutes: orNull(state.encashmentCapMinutes),
  attachment_required_beyond_minutes: orNull(state.attachmentRequiredBeyondMinutes),
  country_pack_id: orNull(state.countryPackId),
  country_pack_version: orNull(state.countryPackVersion),
  published_at: orNull(state.publishedAt),
  published_by: orNull(state.publishedBy),
  metadata: JSON.stringify(state.metadata),
});

export interface AssignmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly leave_policy_id: string;
  readonly scope: string;
  readonly scope_id: string | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly reason_code: string | null;
  readonly version: number;
}

export const ASSIGNMENT_COLUMNS = `a.id, a.tenant_id, a.leave_policy_id, a.scope, a.scope_id,
  ${civilDateColumn('a.effective_from', 'effective_from')},
  ${civilDateColumn('a.effective_to', 'effective_to')}, a.reason_code, a.version`;

export const toAssignment = (row: AssignmentRow): PolicyAssignmentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  leavePolicyId: row.leave_policy_id,
  scope: row.scope as Scope,
  effectiveFrom: row.effective_from,
  version: asVersion(row.version),
  ...(row.scope_id === null ? {} : { scopeId: row.scope_id }),
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
});

export const assignmentValues = (state: PolicyAssignmentState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  leave_policy_id: state.leavePolicyId,
  scope: state.scope,
  scope_id: orNull(state.scopeId),
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  reason_code: orNull(state.reasonCode),
});

export interface BlackoutRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly leave_type_id: string | null;
  readonly scope: string;
  readonly scope_id: string | null;
  readonly name: BilingualText;
  readonly from_date: string;
  readonly to_date: string;
  readonly reason_code: string | null;
  readonly version: number;
}

export const BLACKOUT_COLUMNS = `b.id, b.tenant_id, b.leave_type_id, b.scope, b.scope_id, b.name,
  ${civilDateColumn('b.from_date', 'from_date')}, ${civilDateColumn('b.to_date', 'to_date')},
  b.reason_code, b.version`;

export const toBlackout = (row: BlackoutRow): BlackoutState => ({
  id: row.id,
  tenantId: row.tenant_id,
  scope: row.scope as Scope,
  name: row.name,
  fromDate: row.from_date,
  toDate: row.to_date,
  version: asVersion(row.version),
  ...(row.leave_type_id === null ? {} : { leaveTypeId: row.leave_type_id }),
  ...(row.scope_id === null ? {} : { scopeId: row.scope_id }),
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
});

export const blackoutValues = (state: BlackoutState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  leave_type_id: orNull(state.leaveTypeId),
  scope: state.scope,
  scope_id: orNull(state.scopeId),
  name: JSON.stringify(state.name),
  from_date: state.fromDate,
  to_date: state.toDate,
  reason_code: orNull(state.reasonCode),
});
