import type { Metadata } from '../domain/leave-aggregate.js';
import type {
  LeaveRequestState,
  RequestDayState,
  RequestDecisionState,
  RequestEventState,
} from '../domain/leave-request-state.js';
import type {
  DayPortion,
  Decision,
  DurationBasis,
  RequestEventKind,
  RequestState,
} from '../domain/leave-vocabulary.js';

import { asNumber, asVersion, civilDateColumn, orNull, type RowValues } from './row-writer.js';

/**
 * Row shapes and mappers for the request and its three children.
 *
 * `leave_request_day` has no mapper for `span`: the column is `generated always as ... stored`, so
 * the database computes it and a writer that could set it could defeat the exclusion constraint by
 * lying about it. It is never selected either — nothing in the application needs the range, only
 * the portion it was derived from.
 */

export interface LeaveRequestRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly leave_type_id: string;
  readonly leave_policy_id: string;
  readonly from_date: string;
  readonly to_date: string;
  readonly total_minutes: number;
  readonly duration_basis: string;
  readonly state: string;
  readonly reason_code: string | null;
  readonly justification: string | null;
  readonly requested_by: string;
  readonly requested_at: Date;
  readonly submitted_at: Date | null;
  readonly balance_at_request_minutes: number;
  readonly approvals_required: number;
  readonly approved_at: Date | null;
  readonly rejected_at: Date | null;
  readonly cancelled_at: Date | null;
  readonly cancelled_by: string | null;
  readonly cancellation_reason_code: string | null;
  readonly withdrawn_at: Date | null;
  readonly contact_during_absence: string | null;
  readonly address_during_absence: string | null;
  readonly replacement_employment_id: string | null;
  readonly delegation_id: string | null;
  readonly attachment_reference: string | null;
  readonly supersedes_request_id: string | null;
  readonly approval_id: string | null;
  readonly metadata: Metadata;
  readonly version: number;
}

export const REQUEST_COLUMNS = `q.id, q.tenant_id, q.employment_id, q.leave_type_id,
  q.leave_policy_id, ${civilDateColumn('q.from_date', 'from_date')},
  ${civilDateColumn('q.to_date', 'to_date')}, q.total_minutes, q.duration_basis, q.state,
  q.reason_code, q.justification, q.requested_by, q.requested_at, q.submitted_at,
  q.balance_at_request_minutes, q.approvals_required, q.approved_at, q.rejected_at, q.cancelled_at,
  q.cancelled_by, q.cancellation_reason_code, q.withdrawn_at, q.contact_during_absence,
  q.address_during_absence, q.replacement_employment_id, q.delegation_id, q.attachment_reference,
  q.supersedes_request_id, q.approval_id, q.metadata, q.version`;

/** The eighteen nullable columns, mapped once. Eighteen ternaries inline would exceed every budget. */
const optionalFields = (row: LeaveRequestRow): Record<string, unknown> => {
  const pairs: readonly (readonly [string, unknown])[] = [
    ['reasonCode', row.reason_code],
    ['justification', row.justification],
    ['submittedAt', row.submitted_at],
    ['approvedAt', row.approved_at],
    ['rejectedAt', row.rejected_at],
    ['cancelledAt', row.cancelled_at],
    ['cancelledBy', row.cancelled_by],
    ['cancellationReasonCode', row.cancellation_reason_code],
    ['withdrawnAt', row.withdrawn_at],
    ['contactDuringAbsence', row.contact_during_absence],
    ['addressDuringAbsence', row.address_during_absence],
    ['replacementEmploymentId', row.replacement_employment_id],
    ['delegationId', row.delegation_id],
    ['attachmentReference', row.attachment_reference],
    ['supersedesRequestId', row.supersedes_request_id],
    ['approvalId', row.approval_id],
  ];

  return Object.fromEntries(pairs.filter(([, value]) => value !== null));
};

export const toRequest = (row: LeaveRequestRow): LeaveRequestState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  leaveTypeId: row.leave_type_id,
  leavePolicyId: row.leave_policy_id,
  fromDate: row.from_date,
  toDate: row.to_date,
  totalMinutes: asNumber(row.total_minutes),
  durationBasis: row.duration_basis as DurationBasis,
  state: row.state as RequestState,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  balanceAtRequestMinutes: asNumber(row.balance_at_request_minutes),
  approvalsRequired: asNumber(row.approvals_required),
  metadata: row.metadata,
  version: asVersion(row.version),
  ...optionalFields(row),
});

export const requestValues = (state: LeaveRequestState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  leave_type_id: state.leaveTypeId,
  leave_policy_id: state.leavePolicyId,
  from_date: state.fromDate,
  to_date: state.toDate,
  total_minutes: state.totalMinutes,
  duration_basis: state.durationBasis,
  state: state.state,
  reason_code: orNull(state.reasonCode),
  justification: orNull(state.justification),
  requested_by: state.requestedBy,
  requested_at: state.requestedAt,
  submitted_at: orNull(state.submittedAt),
  balance_at_request_minutes: state.balanceAtRequestMinutes,
  approvals_required: state.approvalsRequired,
  approved_at: orNull(state.approvedAt),
  rejected_at: orNull(state.rejectedAt),
  cancelled_at: orNull(state.cancelledAt),
  cancelled_by: orNull(state.cancelledBy),
  cancellation_reason_code: orNull(state.cancellationReasonCode),
  withdrawn_at: orNull(state.withdrawnAt),
  contact_during_absence: orNull(state.contactDuringAbsence),
  address_during_absence: orNull(state.addressDuringAbsence),
  replacement_employment_id: orNull(state.replacementEmploymentId),
  delegation_id: orNull(state.delegationId),
  attachment_reference: orNull(state.attachmentReference),
  supersedes_request_id: orNull(state.supersedesRequestId),
  approval_id: orNull(state.approvalId),
  metadata: JSON.stringify(state.metadata),
});

export interface RequestDayRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly leave_request_id: string;
  readonly employment_id: string;
  readonly on_date: string;
  readonly portion: string;
  readonly minutes: number;
  readonly start_local: string | null;
  readonly end_local: string | null;
  readonly zone: string;
  readonly expected_minutes: number;
  readonly version: number;
}

export const DAY_COLUMNS = `d.id, d.tenant_id, d.leave_request_id, d.employment_id,
  ${civilDateColumn('d.on_date', 'on_date')}, d.portion, d.minutes, d.start_local, d.end_local,
  d.zone, d.expected_minutes, d.version`;

export const toDay = (row: RequestDayRow): RequestDayState => ({
  id: row.id,
  tenantId: row.tenant_id,
  leaveRequestId: row.leave_request_id,
  employmentId: row.employment_id,
  onDate: row.on_date,
  portion: row.portion as DayPortion,
  minutes: asNumber(row.minutes),
  zone: row.zone,
  expectedMinutes: asNumber(row.expected_minutes),
  version: asVersion(row.version),
  ...(row.start_local === null ? {} : { startLocal: row.start_local }),
  ...(row.end_local === null ? {} : { endLocal: row.end_local }),
});

/** No `span`: the database generates it, and a writer that could set it could defeat the constraint. */
export const dayValues = (state: RequestDayState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  leave_request_id: state.leaveRequestId,
  employment_id: state.employmentId,
  on_date: state.onDate,
  portion: state.portion,
  minutes: state.minutes,
  start_local: orNull(state.startLocal),
  end_local: orNull(state.endLocal),
  zone: state.zone,
  expected_minutes: state.expectedMinutes,
});

export interface DecisionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly leave_request_id: string;
  readonly sequence: number;
  readonly decision: string;
  readonly decided_by: string;
  readonly decided_at: Date;
  readonly requested_by: string;
  readonly comment: string | null;
  readonly reverses_decision_id: string | null;
  readonly version: number;
}

export const DECISION_COLUMNS = `c.id, c.tenant_id, c.leave_request_id, c.sequence, c.decision,
  c.decided_by, c.decided_at, c.requested_by, c.comment, c.reverses_decision_id, c.version`;

export const toDecision = (row: DecisionRow): RequestDecisionState => ({
  id: row.id,
  tenantId: row.tenant_id,
  leaveRequestId: row.leave_request_id,
  sequence: asNumber(row.sequence),
  decision: row.decision as Decision,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  requestedBy: row.requested_by,
  version: asVersion(row.version),
  ...(row.comment === null ? {} : { comment: row.comment }),
  ...(row.reverses_decision_id === null ? {} : { reversesDecisionId: row.reverses_decision_id }),
});

export const decisionValues = (state: RequestDecisionState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  leave_request_id: state.leaveRequestId,
  sequence: state.sequence,
  decision: state.decision,
  decided_by: state.decidedBy,
  decided_at: state.decidedAt,
  // Copied from the request at insert. This is the column that makes the self-approval check
  // constraint enforceable at all — a constraint cannot reach another table.
  requested_by: state.requestedBy,
  comment: orNull(state.comment),
  reverses_decision_id: orNull(state.reversesDecisionId),
});

export interface RequestEventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly leave_request_id: string;
  readonly kind: string;
  readonly from_state: string | null;
  readonly to_state: string | null;
  readonly detail: string | null;
  readonly occurred_at: Date;
  readonly recorded_by: string;
  readonly version: number;
}

export const EVENT_COLUMNS = `v.id, v.tenant_id, v.leave_request_id, v.kind, v.from_state,
  v.to_state, v.detail, v.occurred_at, v.recorded_by, v.version`;

export const toRequestEvent = (row: RequestEventRow): RequestEventState => ({
  id: row.id,
  tenantId: row.tenant_id,
  leaveRequestId: row.leave_request_id,
  kind: row.kind as RequestEventKind,
  occurredAt: row.occurred_at,
  recordedBy: row.recorded_by,
  version: asVersion(row.version),
  ...(row.from_state === null ? {} : { fromState: row.from_state as RequestState }),
  ...(row.to_state === null ? {} : { toState: row.to_state as RequestState }),
  ...(row.detail === null ? {} : { detail: row.detail }),
});

export const requestEventValues = (state: RequestEventState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  leave_request_id: state.leaveRequestId,
  kind: state.kind,
  from_state: orNull(state.fromState),
  to_state: orNull(state.toState),
  detail: orNull(state.detail),
  occurred_at: state.occurredAt,
  recorded_by: state.recordedBy,
});
