import { definedOnly } from '../domain/leave-aggregate.js';
import type { BalanceState } from '../domain/balance.js';
import type { AdjustmentState, EntitlementState } from '../domain/entitlement.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { LeaveTypeState } from '../domain/leave-type.js';
import type { LedgerEntryState } from '../domain/ledger.js';
import type { PolicyAssignmentState } from '../domain/policy-assignment.js';
import type { AccrualRunState } from '../domain/runs.js';
import type {
  LeaveRequestState,
  RequestDayState,
  RequestDecisionState,
} from '../domain/leave-request-state.js';
import type {
  AccrualRunView,
  EntitlementView,
  LeaveAdjustmentView,
  LeaveApprovalChainView,
  LeaveBalanceView,
  LeavePolicyView,
  LeaveRequestDayView,
  LeaveRequestView,
  LeaveTypeView,
  LedgerEntryView,
  PolicyAssignmentView,
} from '../contracts/views.js';

/**
 * State to published view, in one place.
 *
 * One place because the alternative is each query building its own shape, and a field spelled two
 * ways in two queries is a contract that means two things. `definedOnly` drops the keys whose value
 * is absent, which `exactOptionalPropertyTypes` requires and which every mapper here would
 * otherwise repeat as a chain of ternaries.
 */

export const typeView = (state: LeaveTypeState): LeaveTypeView => ({
  leaveTypeId: state.id,
  code: state.code,
  name: state.name,
  unit: state.unit,
  paidTreatmentCode: state.paidTreatmentCode,
  accrues: state.accrues,
  requiresAttachment: state.requiresAttachment,
  requiresReplacement: state.requiresReplacement,
  requiresContact: state.requiresContact,
  requiresAddress: state.requiresAddress,
  status: state.status,
  versionNumber: state.versionNumber,
  version: state.version,
  ...definedOnly({
    genderRestriction: state.genderRestriction,
    statutorySourceCode: state.statutorySourceCode,
  }),
});

export const policyView = (
  state: LeavePolicyState,
  assignments: readonly PolicyAssignmentState[],
): LeavePolicyView => ({
  leavePolicyId: state.id,
  leaveTypeId: state.leaveTypeId,
  code: state.code,
  name: state.name,
  versionNumber: state.versionNumber,
  status: state.status,
  effectiveFrom: state.effectiveFrom,
  durationBasis: state.durationBasis,
  accrualMethod: state.accrualMethod,
  carryOverMethod: state.carryOverMethod,
  leaveYearCalendar: state.leaveYearCalendar,
  approvalsRequired: state.approvalsRequired,
  version: state.version,
  assignments: assignments.map(assignmentView),
  ...definedOnly({ effectiveTo: state.effectiveTo, countryPackId: state.countryPackId }),
});

export const assignmentView = (state: PolicyAssignmentState): PolicyAssignmentView => ({
  assignmentId: state.id,
  scope: state.scope,
  effectiveFrom: state.effectiveFrom,
  ...definedOnly({ scopeId: state.scopeId, effectiveTo: state.effectiveTo }),
});

export const entitlementView = (state: EntitlementState): EntitlementView => ({
  entitlementId: state.id,
  employmentId: state.employmentId,
  leaveTypeId: state.leaveTypeId,
  leaveYearStart: state.leaveYearStart,
  leaveYearEnd: state.leaveYearEnd,
  grantedMinutes: state.grantedMinutes,
  source: state.source,
  ...definedOnly({ reasonCode: state.reasonCode }),
});

export const balanceView = (state: BalanceState): LeaveBalanceView => ({
  employmentId: state.employmentId,
  leaveTypeId: state.leaveTypeId,
  leaveYearStart: state.leaveYearStart,
  leaveYearEnd: state.leaveYearEnd,
  openingMinutes: state.openingMinutes,
  accruedMinutes: state.accruedMinutes,
  carriedInMinutes: state.carriedInMinutes,
  consumedMinutes: state.consumedMinutes,
  adjustedMinutes: state.adjustedMinutes,
  expiredMinutes: state.expiredMinutes,
  carriedOutMinutes: state.carriedOutMinutes,
  availableMinutes: state.availableMinutes,
  entriesDigest: state.entriesDigest,
  entryCount: state.entryCount,
  ...definedOnly({
    calculatedAt: state.calculatedAt,
    inputsChangedAt: state.inputsChangedAt,
    closedAt: state.closedAt,
  }),
});

export const ledgerView = (state: LedgerEntryState): LedgerEntryView => ({
  entryId: state.id,
  employmentId: state.employmentId,
  leaveTypeId: state.leaveTypeId,
  leaveYearStart: state.leaveYearStart,
  kind: state.kind,
  minutes: state.minutes,
  effectiveOn: state.effectiveOn,
  recordedAt: state.recordedAt,
  sourceKind: state.sourceKind,
  sourceId: state.sourceId,
  balanceBeforeMinutes: state.balanceBeforeMinutes,
  balanceAfterMinutes: state.balanceAfterMinutes,
  ...definedOnly({ reversesEntryId: state.reversesEntryId, reasonCode: state.reasonCode }),
});

export const dayView = (state: RequestDayState): LeaveRequestDayView => ({
  onDate: state.onDate,
  portion: state.portion,
  minutes: state.minutes,
  zone: state.zone,
  expectedMinutes: state.expectedMinutes,
  ...definedOnly({ startLocal: state.startLocal, endLocal: state.endLocal }),
});

export const requestView = (
  state: LeaveRequestState,
  days: readonly RequestDayState[],
): LeaveRequestView => ({
  leaveRequestId: state.id,
  employmentId: state.employmentId,
  leaveTypeId: state.leaveTypeId,
  leavePolicyId: state.leavePolicyId,
  fromDate: state.fromDate,
  toDate: state.toDate,
  totalMinutes: state.totalMinutes,
  durationBasis: state.durationBasis,
  state: state.state,
  requestedBy: state.requestedBy,
  requestedAt: state.requestedAt,
  balanceAtRequestMinutes: state.balanceAtRequestMinutes,
  approvalsRequired: state.approvalsRequired,
  version: state.version,
  days: days.map(dayView),
  ...definedOnly({
    reasonCode: state.reasonCode,
    justification: state.justification,
    approvedAt: state.approvedAt,
    cancelledAt: state.cancelledAt,
    cancelledBy: state.cancelledBy,
    supersedesRequestId: state.supersedesRequestId,
    attachmentReference: state.attachmentReference,
  }),
});

/**
 * The approval chain in `ApprovalPort`'s shape.
 *
 * A request under a policy requiring no approval has **no steps and `approvalRequired: false`**.
 * That is the honest rendering of "nobody had to decide this", and it is different from a chain
 * naming a system approver — which is what consuming `AutoApprovingPort` would have produced.
 */
export const approvalChainView = (
  request: LeaveRequestState,
  decisions: readonly RequestDecisionState[],
): LeaveApprovalChainView => ({
  state: request.state,
  approvalRequired: request.approvalsRequired > 0,
  approvalsRequired: request.approvalsRequired,
  steps: decisions.map((decision) => ({
    approver: decision.decidedBy,
    decidedAt: decision.decidedAt,
    decision: decision.decision,
    ...definedOnly({ comment: decision.comment }),
  })),
  ...definedOnly({ approvalId: request.approvalId, completedAt: request.approvedAt }),
});

export const adjustmentView = (state: AdjustmentState): LeaveAdjustmentView => ({
  adjustmentId: state.id,
  employmentId: state.employmentId,
  leaveTypeId: state.leaveTypeId,
  leaveYearStart: state.leaveYearStart,
  minutes: state.minutes,
  effectiveOn: state.effectiveOn,
  reasonCode: state.reasonCode,
  note: state.note,
  adjustedBy: state.adjustedBy,
  adjustedAt: state.adjustedAt,
});

export const accrualRunView = (state: AccrualRunState): AccrualRunView => ({
  accrualRunId: state.id,
  leavePolicyId: state.leavePolicyId,
  leaveTypeId: state.leaveTypeId,
  periodStart: state.periodStart,
  periodEnd: state.periodEnd,
  runBy: state.runBy,
  runAt: state.runAt,
  employmentsExamined: state.employmentsExamined,
  entriesWritten: state.entriesWritten,
  entriesSkipped: state.entriesSkipped,
  refusals: state.refusals,
});
