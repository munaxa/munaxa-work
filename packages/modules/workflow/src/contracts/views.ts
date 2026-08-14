import type {
  ApprovalDecisionKind,
  ApprovalStateName,
  ApproverKind,
  DecisionAuthority,
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
 * There is no `slaDueAt`, no `escalationLevel`, no `tally` and no `pattern` here, for the same
 * reason there is no column for any of them.
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
  readonly description?: string;
  /** What a business module calls the thing being decided. Opaque, and never interpreted here. */
  readonly subjectType: string;
  readonly status: WorkflowDefinitionStatus;
  readonly retiredOn?: string;
  readonly version: number;
}

export interface WorkflowStepTemplateView {
  readonly stepTemplateId: string;
  readonly ordinal: number;
  readonly name: LocalizedTextView;
  readonly approverKind: ApproverKind;
  readonly approverMembershipId: string;
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

export interface WorkflowStepView {
  readonly stepId: string;
  readonly instanceId: string;
  readonly ordinal: number;
  readonly approverKind: ApproverKind;
  readonly approverMembershipId: string;
  readonly status: WorkflowStepStatus;
  readonly version: number;
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

/** One approval, with its steps and the decisions made on them. A fixed number of reads. */
export interface WorkflowInstanceDetailView {
  readonly instance: WorkflowInstanceView;
  readonly steps: readonly WorkflowStepView[];
  readonly decisions: readonly WorkflowDecisionView[];
  /** The step a decision is being asked for. Absent once the approval has ended. */
  readonly awaiting?: WorkflowStepView;
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
