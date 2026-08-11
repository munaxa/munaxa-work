import type { BilingualText } from '../domain/leave-aggregate.js';

/**
 * What Leave publishes: the shapes a consumer, the API and the SDK may depend on.
 *
 * Four absences carry more weight than anything present.
 *
 * **No money.** Not a rate, not a multiplier, not an amount, not a value. `paidTreatmentCode` is a
 * tenant or country-pack code Leave stores and never interprets, and `encashableMinutes` is
 * eligibility rather than worth. What a leave day costs is Payroll's (§21).
 *
 * **No employment fact.** No person, no employee number, no employment status. A consumer asking
 * whether somebody is employed is asking Employment, as at a date (ADR-0051). There is no `on_leave`
 * status anywhere in this product — an absence is not a change of employment status (ADR-0040).
 *
 * **No attendance.** No punch, no worked minutes, no schedule. Leave says a date is authorized;
 * what actually happened on it is Attendance's record.
 *
 * **No document.** `attachmentReference` is a reference and nothing in this module verifies that it
 * resolves to anything, because no `DocumentPort` adapter exists in this repository.
 *
 * Contracts are versioned. A breaking change to anything here requires an ADR.
 */

export interface LeaveTypeView {
  readonly leaveTypeId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly unit: string;
  readonly paidTreatmentCode: string;
  readonly accrues: boolean;
  readonly requiresAttachment: boolean;
  readonly requiresReplacement: boolean;
  readonly requiresContact: boolean;
  readonly requiresAddress: boolean;
  readonly genderRestriction?: string;
  readonly statutorySourceCode?: string;
  readonly status: string;
  readonly versionNumber: number;
  readonly version: number;
}

export interface LeavePolicyView {
  readonly leavePolicyId: string;
  readonly leaveTypeId: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly versionNumber: number;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly durationBasis: string;
  readonly accrualMethod: string;
  readonly carryOverMethod: string;
  readonly leaveYearCalendar: string;
  readonly approvalsRequired: number;
  readonly countryPackId?: string;
  readonly version: number;
  readonly assignments: readonly PolicyAssignmentView[];
}

export interface PolicyAssignmentView {
  readonly assignmentId: string;
  readonly scope: string;
  readonly scopeId?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface EntitlementView {
  readonly entitlementId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly leaveYearEnd: string;
  readonly grantedMinutes: number;
  readonly source: string;
  readonly reasonCode?: string;
}

/**
 * A balance, as the projection holds it.
 *
 * `availableMinutes` may be **negative** where the policy permits a deficit. Nothing clamps it,
 * because a clamped balance would hide exactly the situation somebody needs to see.
 *
 * `entriesDigest` and `calculatedAt` are published deliberately: a consumer that can see the digest
 * can tell whether the figure it holds still matches the ledger, and `inputsChangedAt` says plainly
 * that a recalculation is outstanding. A stale balance that looked identical to a correct one is
 * the worst failure this module has.
 */
export interface LeaveBalanceView {
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly leaveYearEnd: string;
  readonly openingMinutes: number;
  readonly accruedMinutes: number;
  readonly carriedInMinutes: number;
  readonly consumedMinutes: number;
  readonly adjustedMinutes: number;
  readonly expiredMinutes: number;
  readonly carriedOutMinutes: number;
  readonly availableMinutes: number;
  readonly entriesDigest: string;
  readonly entryCount: number;
  readonly calculatedAt?: Date;
  /** Present means a recalculation is outstanding and this figure may be behind the ledger. */
  readonly inputsChangedAt?: Date;
  readonly closedAt?: Date;
}

/**
 * A balance projected to the end of the leave year.
 *
 * Marked as a **projection** on the contract, and the word is load-bearing: it assumes continued
 * employment and unchanged policy, and it says so. This is what an employee plans against and what
 * a manager approves against, and presenting it as a fact would have somebody book a holiday
 * against entitlement that a resignation would remove.
 */
export interface ProjectedBalanceView extends LeaveBalanceView {
  readonly projectedAccrualMinutes: number;
  readonly projectedAvailableMinutes: number;
  readonly projectionBasis: string;
  readonly assumesContinuedEmployment: true;
}

export interface LedgerEntryView {
  readonly entryId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly kind: string;
  readonly minutes: number;
  readonly effectiveOn: string;
  readonly recordedAt: Date;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly reversesEntryId?: string;
  readonly reasonCode?: string;
  readonly balanceBeforeMinutes: number;
  readonly balanceAfterMinutes: number;
}

export interface LeaveRequestDayView {
  readonly onDate: string;
  readonly portion: string;
  readonly minutes: number;
  readonly startLocal?: string;
  readonly endLocal?: string;
  readonly zone: string;
  readonly expectedMinutes: number;
}

export interface LeaveRequestView {
  readonly leaveRequestId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leavePolicyId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly totalMinutes: number;
  readonly durationBasis: string;
  readonly state: string;
  readonly reasonCode?: string;
  /**
   * The requester's own words.
   *
   * Sensitive: on a sick-leave request this is close to health data, which is why `leave.read` and
   * `leave.balance.read` are different permissions and why no domain event carries it (§30).
   */
  readonly justification?: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly balanceAtRequestMinutes: number;
  readonly approvalsRequired: number;
  readonly approvedAt?: Date;
  readonly cancelledAt?: Date;
  readonly cancelledBy?: string;
  readonly supersedesRequestId?: string;
  readonly attachmentReference?: string;
  readonly version: number;
  readonly days: readonly LeaveRequestDayView[];
}

/**
 * The approval chain, published in `ApprovalPort`'s own shape.
 *
 * The field names and their order match `ApprovalStep` and `ApprovalStatus` deliberately. Leave
 * records its own decisions and does not consume `ApprovalPort` — the only adapter in this
 * repository approves everything automatically as `system:auto-approval`, and treating that as a
 * human decision about paid absence would be recording something that did not happen (ADR-0045).
 *
 * When Phase 16 lands, the **source** of these steps changes from Leave's decision table to
 * Workflow, and this contract does not.
 *
 * A request under a policy requiring no approval has **no steps at all**, and `approvalRequired` is
 * false. The screen says "no approval was required" rather than naming a system approver.
 */
export interface LeaveApprovalStepView {
  readonly approver: string;
  readonly decidedAt: Date;
  readonly decision: string;
  readonly comment?: string;
}

export interface LeaveApprovalChainView {
  readonly approvalId?: string;
  readonly state: string;
  readonly approvalRequired: boolean;
  readonly approvalsRequired: number;
  readonly steps: readonly LeaveApprovalStepView[];
  readonly completedAt?: Date;
}

export interface LeaveAdjustmentView {
  readonly adjustmentId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly minutes: number;
  readonly effectiveOn: string;
  readonly reasonCode: string;
  readonly note: string;
  readonly adjustedBy: string;
  readonly adjustedAt: Date;
}

export interface AccrualRunView {
  readonly accrualRunId: string;
  readonly leavePolicyId: string;
  readonly leaveTypeId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly runBy: string;
  readonly runAt: Date;
  readonly employmentsExamined: number;
  readonly entriesWritten: number;
  readonly entriesSkipped: number;
  readonly refusals: number;
}

/** Who is away, for the administrative calendar. No reason text: this is a list, not a file. */
export interface LeaveCalendarEntryView {
  readonly employmentId: string;
  readonly onDate: string;
  readonly portion: string;
  readonly minutes: number;
  readonly leaveTypeId: string;
  readonly leaveRequestId: string;
  readonly state: string;
}

/**
 * What Payroll (Phase 11) will read, published now so it never reads a Leave table.
 *
 * `paidTreatmentCode` travels uninterpreted. `days` is a conversion whose basis is stated on the
 * view rather than assumed, and `encashableMinutes` is **eligibility only** — how many minutes the
 * policy permits to be encashed, never what they are worth.
 *
 * `calculationVersion` and `inputsDigest` are what make a payroll run reproducible and a disputed
 * figure explainable.
 */
export interface LeavePayrollPeriodView {
  readonly employmentId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly lines: readonly {
    readonly leaveTypeId: string;
    readonly leaveTypeCode: string;
    readonly paidTreatmentCode: string;
    readonly minutes: number;
    readonly days: number;
    readonly conversionBasisHoursPerWeek?: number;
    readonly requestIds: readonly string[];
  }[];
  readonly encashableMinutes: number;
  readonly calculationVersion: number;
  readonly inputsDigest: string;
}

/**
 * The dashboard's numbers, including the two that reveal a *failure*.
 *
 * Balances awaiting recalculation is on this view for the reason Attendance's equivalent is: it is
 * the number that grows when something is quietly not working, and a number a human can see is a
 * number a human notices growing.
 */
export interface LeaveDashboardView {
  readonly pendingApprovals: number;
  readonly onLeaveToday: number;
  readonly balancesAwaitingRecalculation: number;
  readonly leaveTypesConfigured: number;
  readonly publishedPolicies: number;
}
