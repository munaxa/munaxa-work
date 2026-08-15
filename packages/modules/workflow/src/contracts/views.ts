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
 * There is no `slaDueAt`, no `escalationLevel` and no `pattern` here, for the same reason there is
 * no column for any of them. `BranchTallyView` exists because Phase 16B built the tally — and it is
 * **derived at read time from the decisions**, which is why it has no version and no identifier of
 * its own: there is no tally row anywhere to be out of date.
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
  readonly branchRule?: BranchRule;
  /** A minimum number of responses before the rule is evaluated. A count, never a proportion. */
  readonly quorum?: number;
  readonly condition?: readonly BranchConditionView[];
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
