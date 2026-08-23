import type {
  ApprovalDecisionKind,
  ApprovalStateName,
  ApproverKind,
  BranchOutcome,
  BranchRule,
  DecisionAuthority,
  WorkflowHistoryEvent,
  WorkflowInstanceStatus,
  WorkflowStepStatus,
} from '../domain/workflow-vocabulary.js';

import type { BranchConditionView, StepServiceLevelView } from './views.js';

/**
 * What Workflow publishes about approvals that are actually **running** — and about the one step a
 * machine is allowed to ask for.
 *
 * Split from `views.ts` at the seam the file already had a banner for: everything there describes a
 * process somebody **configured**, everything here describes one that is **under way**. They change
 * for different reasons and are read by different screens, and the two halves had grown past the
 * file budget as one.
 *
 * **List, detail and history are separate**, deliberately. A single view carrying an instance, its
 * steps, its decisions and its timeline would make the queue read everything the detail screen needs
 * for every row — which is how a bounded read becomes an N+1 one screen at a time.
 *
 * **The actor and the authority are two fields and never one.** `decidedByMembershipId` is the person
 * who actually decided; `onBehalfOfMembershipId` is the approver whose authority they used, present
 * only under delegation. Collapsing them would let a screen say a director approved something their
 * deputy approved.
 *
 * There is no `escalationLevel` and no `pattern` here, for the same reason there is no column for
 * either. `BranchTallyView` exists because Phase 16B built the tally — **derived at read time**, which
 * is why it has no version and no identifier of its own: there is no tally row anywhere to be out of
 * date.
 */

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
  /**
   * Whether this approver was **added by escalation** rather than snapshotted when the approval
   * started (D-16D-09).
   *
   * **Required rather than optional, and that is the point.** An absent field cannot be told apart
   * from an older server, so "absent" would drift into meaning "probably not escalated" — the exact
   * ambiguity this exists to remove. It is total over every step ever written: rows from before the
   * escalation migration have no marker in the database and read `false`, correctly, because
   * escalation did not exist when they were written. Nothing was backfilled.
   *
   * **It publishes that, never when, who or why.** The instant lives in the database and stays there;
   * the actor and the moment are in the timeline, under `step-escalated`, where a permission decides
   * who may read them.
   *
   * **It is a projection, not a second source of truth.** The domain already computes
   * `assignedOf = members.filter(m => m.escalatedAt === undefined)`, and this is that same predicate
   * seen from outside. It changes no arithmetic: `assigned`, `threshold`, `outstanding`, `outcome`
   * and `quorum` are the tally's, and the tally remains the only published authority on the
   * denominator. **A consumer must never count these to recompute one.**
   */
  readonly escalated: boolean;
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

/**
 * One step whose automatic service-level reminder is due — the whole of what a job runner needs.
 *
 * **Two identifiers, and deliberately nothing else.** They are exactly the arguments
 * `workflow.remind-step` takes, so a runner can carry a candidate straight to the command without
 * learning anything about the approval on the way. A step's ordinal, its approver, its target, the
 * subject it is about — none of them helps a runner decide anything, because a runner decides
 * nothing; the command re-derives the whole condition when it executes.
 *
 * **No `tenantId`.** The execution context already establishes which tenant this is, and returning it
 * would invite a caller to pass it back as a business identifier somewhere. A tenant is a fact about
 * the caller, never a field they carry.
 *
 * **No person.** Not the approver, not the requester, not a manager, not a workforce user. The
 * recipient is resolved later and separately, by `identity.membership-recipient`, from the step the
 * command re-reads. This view discovers **work**, not people, which is what keeps D-16D-16 closed.
 */
export interface DueReminderView {
  readonly instanceId: string;
  readonly stepId: string;
}
