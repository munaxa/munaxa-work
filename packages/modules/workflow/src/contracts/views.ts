import type {
  ApprovalDecisionKind,
  ApprovalStateName,
  ApproverKind,
  BranchOutcome,
  BranchRule,
  ConditionOperator,
  DecisionAuthority,
  LocalizedName,
  WorkflowDefinitionStatus,
  WorkflowHistoryEvent,
  WorkflowInstanceStatus,
  WorkflowStepStatus,
  WorkflowVersionStatus,
} from '../domain/workflow-vocabulary.js';
import type { ServiceLevelState, ServiceLevelUnit } from '../domain/service-level.js';

/**
 * What Workflow publishes.
 *
 * **Views only.** No handler, no store, no dependency type and no domain aggregate leaves this
 * module: a consumer that could reach a handler could bypass this module's permission checks, and
 * one that could reach a store could bypass its tenancy. Nothing here is a Prisma type or a row.
 *
 * **List, detail and history are separate**, deliberately. A single view carrying an instance, its
 * steps, its decisions and its timeline would make the queue read everything the detail screen needs
 * for every row — which is how a bounded read becomes an N+1 one screen at a time.
 *
 * **The actor and the authority are two fields and never one.** `decidedByMembershipId` is the
 * person who actually decided; `onBehalfOfMembershipId` is the approver whose authority they used,
 * present only under delegation. Collapsing them would let a screen say a director approved
 * something their deputy approved.
 *
 * There is no `escalationLevel` and no `pattern` here, for the same reason there is no column for
 * either. `BranchTallyView` exists because Phase 16B built the tally, and `StepServiceLevelView`
 * because Phase 16C built the target — and both are **derived at read time**, which is why neither
 * has a version or an identifier of its own: there is no tally row and no due-time row anywhere to be
 * out of date.
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

// ------------------------------------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------------------------------------

export interface WorkflowDefinitionView {
  readonly definitionId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly description?: LocalizedName;
  /** What a business module calls the thing being decided. Opaque, and never interpreted here. */
  readonly subjectType: string;
  readonly status: WorkflowDefinitionStatus;
  readonly retiredOn?: string;
  readonly version: number;
}

/**
 * One condition on a branch, in the closed form the domain evaluates.
 *
 * Published because an administrator reading a process needs to see *why* a stage might not run, and
 * a screen that showed a branch with no explanation would describe a process nobody could predict.
 * The value is a string or a whole number, or a list of either for `in` — there is no expression
 * here to render and none to write.
 */
export interface BranchConditionView {
  readonly key: string;
  readonly operator: ConditionOperator;
  readonly value: string | number | readonly (string | number)[];
}

/**
 * How a branch reaches an outcome, as configured.
 *
 * Absent `rule` means `unanimous` and absent `quorum` means one, which is exactly what every step
 * configured before Phase 16B is. The view states them as they were stored rather than filling the
 * defaults in, because a screen that showed `unanimous` on a step nobody configured that way would
 * be reporting a decision the tenant did not make.
 */
/**
 * How long a step is expected to take once it becomes awaiting, as configured.
 *
 * Two fields rather than a duration, because "two days" and "forty-eight hours" are the same length
 * of time and not the same sentence: an administrator typed one of them, and a screen has to show
 * them back what they typed. A whole count, never a fraction and never a proportion.
 *
 * **It is a target and not a deadline.** Nothing fires when it passes, no step becomes `expired`, and
 * no approval ends: what it buys is a question a reader can ask (D-16C-06).
 */
export interface ServiceLevelTargetView {
  readonly count: number;
  readonly unit: ServiceLevelUnit;
}

/**
 * How one running step stands against its target, **as at the instant it was read**.
 *
 * Every field below the unit is derived, at read time, from three things: the target, the instant the
 * step became awaiting, and the reading instant. None of them is stored — a written due time would
 * disagree with its own inputs the first time somebody corrected a target, and a written `overdue`
 * would need something to write it, which is a scheduler this phase does not have (D-16C-01) or a
 * synthetic actor ADR-0045 refuses (D-16C-02).
 *
 * **`state` has three values and `expired` is not one of them.** `none` is a step nobody is waiting
 * on yet, or one with no target at all. Due exactly on the boundary is `within`: two hours to approve
 * means two whole hours.
 *
 * **`overdueByMinutes` is a whole number, truncated.** A step three seconds past its target is
 * overdue by zero minutes and not by one, in a module where every published number is an integer and
 * none is a percentage. Absent while the step is within its target.
 */
export interface StepServiceLevelView {
  readonly count: number;
  readonly unit: ServiceLevelUnit;
  /** The instant this step became awaiting. Absent on a step nobody is waiting on. */
  readonly awaitingOn?: string;
  /** When it falls due, derived. Absent for the same reason `awaitingOn` is. */
  readonly dueOn?: string;
  readonly state: ServiceLevelState;
  readonly overdueByMinutes?: number;
}

export interface WorkflowStepTemplateView {
  readonly stepTemplateId: string;
  /** The branch this step is in. Several templates may share one; all of them are asked at once. */
  readonly ordinal: number;
  readonly name: LocalizedTextView;
  readonly approverKind: ApproverKind;
  /** Present when `approverKind` is `membership`. */
  readonly approverMembershipId?: string;
  /** Present when `approverKind` is `group`. Resolved into its members when an instance starts. */
  readonly approverGroupId?: string;
  /**
   * Absent when `approverKind` is `manager`, and there is no field that would be present instead.
   *
   * A manager template names nobody: whose manager it means is the person who raised the approval,
   * fixed rather than configured (P-1). A screen renders the kind and no identifier, because there is
   * no identifier — the person is resolved once, when an approval starts, and appears on its steps.
   */
  readonly branchRule?: BranchRule;
  /** A minimum number of responses before the rule is evaluated. A count, never a proportion. */
  readonly quorum?: number;
  readonly condition?: readonly BranchConditionView[];
  /** What was configured, exactly as configured. Absent means this step has no due time. */
  readonly serviceLevel?: ServiceLevelTargetView;
}

// ------------------------------------------------------------------------------------------------
// Approval groups
// ------------------------------------------------------------------------------------------------

/**
 * A named list of memberships a tenant maintains.
 *
 * **Not a directory.** There is no role here, no query, no nesting and no status: a group is a list
 * somebody wrote down, resolved into individual approvers when an approval starts and never
 * consulted again by one that is already running.
 */
export interface ApprovalGroupView {
  readonly approvalGroupId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly version: number;
}

export interface ApprovalGroupMemberView {
  readonly approvalGroupMemberId: string;
  readonly approvalGroupId: string;
  /** Identity's identifier, held as a value. Nothing here resolves it to a person or a position. */
  readonly membershipId: string;
  readonly addedOn: string;
}

/** One group with the memberships on it, in a deterministic order. */
export interface ApprovalGroupDetailView {
  readonly group: ApprovalGroupView;
  readonly members: readonly ApprovalGroupMemberView[];
}

export interface WorkflowVersionView {
  readonly workflowVersionId: string;
  readonly definitionId: string;
  readonly versionNumber: number;
  readonly status: WorkflowVersionStatus;
  readonly publishedOn?: string;
  readonly stepCount: number;
  readonly version: number;
}

/** One definition with its versions and the steps of whichever version is currently published. */
export interface WorkflowDefinitionDetailView {
  readonly definition: WorkflowDefinitionView;
  readonly versions: readonly WorkflowVersionView[];
  /** Absent where no version is published — a definition nothing can start an approval from. */
  readonly publishedSteps?: readonly WorkflowStepTemplateView[];
}

// ------------------------------------------------------------------------------------------------
// Running approvals
// ------------------------------------------------------------------------------------------------

export interface WorkflowInstanceView {
  /** The approval identifier. This is the value `ApprovalPort` returns and adopting modules store. */
  readonly instanceId: string;
  readonly definitionId: string;
  readonly workflowVersionId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly requestedByMembershipId: string;
  readonly status: WorkflowInstanceStatus;
  readonly startedOn: string;
  readonly completedOn?: string;
  readonly version: number;
}

/**
 * One step of a running approval.
 *
 * `approverKind` is always `membership` here, and that is the point of the group snapshot: a
 * template may name a group, a step never does, because the group was resolved into its members
 * before this row existed. `sourceGroupId` records which list the person came from — provenance for
 * "why was I asked?", and nothing that routes reads it.
 */
export interface WorkflowStepView {
  readonly stepId: string;
  readonly instanceId: string;
  readonly ordinal: number;
  readonly approverKind: ApproverKind;
  readonly approverMembershipId: string;
  readonly status: WorkflowStepStatus;
  /** The group this approver was snapshotted from, when they came from one. */
  readonly sourceGroupId?: string;
  readonly branchRule?: BranchRule;
  readonly quorum?: number;
  readonly condition?: readonly BranchConditionView[];
  /**
   * The target this step started with, and how it stands as at the instant this was read.
   *
   * Absent where the step was configured with no target. The instant it counts from is the moment
   * *this step* became awaiting, not the moment the approval started (P-5), so the third step of a
   * chain is not overdue because the second took a fortnight.
   */
  readonly serviceLevel?: StepServiceLevelView;
  readonly version: number;
}

/**
 * How one branch stands: who was asked, who has answered, and what it takes.
 *
 * **Every number here is an integer count and none is a proportion.** `assigned` is the denominator
 * snapshotted when the approval started and it does not move — somebody who has not answered is
 * counted as outstanding, never excluded. `threshold` is how many approvals this rule needs over
 * that denominator: the whole of it under `unanimous`, `floor(assigned / 2) + 1` under `majority`,
 * one under `first-response`. There is no percentage and no weight, because there is no column for
 * either and no arithmetic that could produce one.
 *
 * **Computed, never stored.** A tally is a function of the decisions that exist; a stored counter
 * would be a second source of truth that disagrees with the decisions the moment two approvers
 * commit at once.
 */
export interface BranchTallyView {
  readonly ordinal: number;
  readonly rule: BranchRule;
  readonly assigned: number;
  readonly approvals: number;
  readonly rejections: number;
  readonly responses: number;
  readonly outstanding: number;
  readonly threshold: number;
  readonly quorum: number;
  readonly quorumMet: boolean;
  readonly outcome: BranchOutcome;
}

export interface WorkflowDecisionView {
  readonly decisionId: string;
  readonly stepId: string;
  readonly decision: ApprovalDecisionKind;
  /** The membership that actually decided. Never the delegator, even under delegation. */
  readonly decidedByMembershipId: string;
  readonly authority: DecisionAuthority;
  /** The approver whose authority a delegate used. Present only on a delegated decision. */
  readonly onBehalfOfMembershipId?: string;
  readonly decidedOn: string;
  readonly comment?: string;
}

/**
 * One approval, with its steps, the decisions made on them, and how each branch stands.
 *
 * **`awaitingSteps` is the honest field and `awaiting` is kept beside it.** A branch of four has
 * four steps awaiting a decision at once; the singular is the first of them, in branch and
 * identifier order, and it exists because the 16A shape is published. A caller that reads only the
 * singular sees one of the people being asked rather than a wrong one — but it sees one of four.
 */
export interface WorkflowInstanceDetailView {
  readonly instance: WorkflowInstanceView;
  readonly steps: readonly WorkflowStepView[];
  readonly decisions: readonly WorkflowDecisionView[];
  /** Every step a decision is being asked for. Empty once the approval has ended. */
  readonly awaitingSteps: readonly WorkflowStepView[];
  /** The first of them. Absent once the approval has ended. See above. */
  readonly awaiting?: WorkflowStepView;
  /** One entry per branch, in order. Computed from the decisions, never stored. */
  readonly tallies: readonly BranchTallyView[];
}

/**
 * One entry in an approval's timeline: who was asked, who answered, on whose authority, and when.
 *
 * It carries **no comment**. A rejection comment is one person's written opinion of another's
 * request, and it lives on the decision where a permission decides who may read it — not in a
 * timeline a queue screen renders beside a name.
 */
export interface WorkflowHistoryView {
  readonly historyId: string;
  readonly instanceId: string;
  readonly event: WorkflowHistoryEvent;
  readonly occurredOn: string;
  readonly stepId?: string;
  readonly ordinal?: number;
  readonly actorMembershipId?: string;
  readonly onBehalfOfMembershipId?: string;
}

/** One row of the caller's own queue: the step, and enough of its approval to act on it. */
export interface PendingApprovalView {
  readonly stepId: string;
  readonly instanceId: string;
  readonly ordinal: number;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly definitionCode: string;
  readonly startedOn: string;
  /**
   * How this row stands against its target, as at the instant the queue was read.
   *
   * Per row and derived, which is what keeps it from being a dashboard. There is no tenant-wide
   * overdue count anywhere in this module, no aggregate and no ranking: this queue is bounded, it is
   * the caller's own, and what it adds is a column beside rows it was already returning.
   */
  readonly serviceLevel?: StepServiceLevelView;
  readonly version: number;
}

/**
 * An approval's state in `ApprovalPort`'s own vocabulary, and the chain as the requester sees it.
 *
 * Published in the port's shape so the seam Checkpoint 7 builds changes where a decision comes from
 * and not what it looks like — the same treatment Leave, Compensation, Payroll and Letters gave
 * their own chains. `expired` is one of the port's five states and **Phase 16A never produces it**.
 */
export interface ApprovalStepView {
  readonly approver: string;
  readonly decision?: ApprovalDecisionKind;
  readonly decidedOn?: string;
}

export interface ApprovalStatusView {
  readonly approvalId: string;
  readonly state: ApprovalStateName;
  readonly steps: readonly ApprovalStepView[];
  readonly completedOn?: string;
}
