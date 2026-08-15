import {
  AUTO_APPROVAL,
  WORKFLOW_STEP_TRANSITIONS,
  type ApprovalDecisionKind,
  type ApprovalStateName,
  type DecisionAuthority,
  type WorkflowInstanceStatus,
  type WorkflowStepStatus,
} from './workflow-vocabulary.js';
import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';
import { skipRemaining, type WorkflowInstanceState, type WorkflowStepState } from './instance.js';
import { definedOf } from './defined.js';
import { branchAt, branchOf, tallyOf, type BranchTally, type BranchVote } from './branch.js';
import { chooseBranch } from './branch-plan.js';

/**
 * An approver deciding one step, and everything that follows from it.
 *
 * **A decision is append-only.** `WorkflowDecisionState` is written once and never updated: there is
 * no `amend`, no `revise` and no `retract` in this file, and a trigger will refuse both `update` and
 * `delete` at the table. This is ADR-0045's argument — *"an edited decision is not evidence"* — and
 * Career's readiness assessments and Attendance's raw time events are the same construction. A
 * correction is a new instance, never a rewritten decision.
 *
 * **Nobody is impersonated.** A delegated decision records **two** memberships: the delegate who
 * actually acted, and the assigned approver whose authority they used. `decidedByMembershipId` is
 * always the person who pressed the button. Writing the delegator's name into that column and
 * calling it their approval is precisely the dishonesty this seam exists to prevent, and it is why
 * the two are separate columns rather than one that means different things on different rows.
 *
 * **Whether a delegation is in force is not decided here.** Identity owns delegation (AD-010) and
 * answers `identity.active-delegations-for` for a period agreed in advance. The domain is told the
 * authority and checks it for **coherence** — a delegated decision must name the step's own approver
 * as the person it acts for — and nothing else. Re-deriving Identity's answer here would be the
 * second delegation system the plan refuses to build (D-2).
 *
 * **`system:auto-approval` is refused.** Fourteen check constraints across Performance, Learning and
 * Career already refuse that actor on the act that matters. Workflow refuses it on every decision it
 * records, because a routed approval that nobody made is worse than no routing at all (ADR-0045).
 *
 * **A decision decides a step; a tally decides a branch.** In 16A the two were the same thing,
 * because a branch had one step. Now a decision is recorded, the branch it belongs to is tallied
 * under its own rule, and only then does anything follow: the branch may still be awaiting, in which
 * case the instance is untouched and the other approvers keep their queue entries.
 *
 * **A branch ends the moment its outcome is arithmetically determined**, and every step of it still
 * awaiting is moved to `skipped`. Leaving them would leave a decided approval sitting on somebody's
 * queue, which is the failure `skipped` was introduced to prevent. There is no `superseded` state:
 * `skipped` already means "this was not decided and never will be", and a second word for it would
 * be a second thing to translate and to explain.
 *
 * **A rejected branch rejects the instance.** Not because a rejection is special-cased, but because
 * a branch that cannot be approved is a step of the process that failed, and 16A's rule — a failed
 * step ends the approval — is unchanged.
 */

export interface WorkflowDecisionState {
  readonly decisionId: string;
  readonly instanceId: string;
  readonly stepId: string;
  readonly decision: ApprovalDecisionKind;
  /** The membership that actually decided. Never the delegator, even under delegation. */
  readonly decidedByMembershipId: string;
  readonly authority: DecisionAuthority;
  /** The assigned approver whose authority was used. Present only on a delegated decision. */
  readonly onBehalfOfMembershipId?: string;
  readonly decidedAt: Date;
  readonly comment?: string;
  readonly version: number;
}

export interface DecideRequest {
  readonly decisionId: string;
  readonly decision: ApprovalDecisionKind;
  readonly decidedByMembershipId: string;
  readonly authority: DecisionAuthority;
  /** Required when `authority` is `delegated`; refused when it is `assigned`. */
  readonly onBehalfOfMembershipId?: string;
  readonly at: Date;
  readonly comment?: string;
}

export interface DecidedStep {
  readonly decision: WorkflowDecisionState;
  readonly step: WorkflowStepState;
  /**
   * The steps that become `awaiting` — the next branch that runs.
   *
   * Empty while this branch is still open, and empty when the approval ends. `tally.outcome` is what
   * distinguishes those two, and a caller reading only this array would conflate them.
   */
  readonly next: readonly WorkflowStepState[];
  /**
   * Every step abandoned: the rest of this branch once it terminated early, plus the branches a
   * condition skipped on the way to the next one.
   */
  readonly skipped: readonly WorkflowStepState[];
  readonly instance: WorkflowInstanceState;
  /** How this branch stood once the decision was counted. Computed, never stored. */
  readonly tally: BranchTally;
}

const stepPermits = (from: WorkflowStepStatus, to: WorkflowStepStatus): boolean =>
  WORKFLOW_STEP_TRANSITIONS[from].includes(to);

/**
 * Whether this person may decide this step, and on what authority.
 *
 * Separated from `decide` so the rule reads as the access decision it is rather than as one branch
 * among several. Three refusals, and the middle one is the one that matters: an `assigned` decision
 * from somebody who is not the assigned approver is the ordinary unauthorized case, and a
 * `delegated` decision that names somebody *other* than the step's approver is an attempt to use
 * one person's delegation to decide another person's step.
 */
export const authorityIsCoherent = (
  step: WorkflowStepState,
  request: DecideRequest,
): WorkflowResult<DecisionAuthority> => {
  if (request.authority === 'assigned') {
    if (request.onBehalfOfMembershipId !== undefined) return refuse('authority-not-delegated');
    if (request.decidedByMembershipId !== step.approverMembershipId) {
      return refuse('decision-not-the-assigned-approver');
    }
    return accept('assigned');
  }

  if (request.onBehalfOfMembershipId === undefined) return refuse('delegation-subject-required');
  if (request.onBehalfOfMembershipId !== step.approverMembershipId) {
    return refuse('delegation-names-another-approver');
  }
  if (request.decidedByMembershipId === step.approverMembershipId) {
    // Deciding your own step needs no delegation, and recording one would put a delegation in the
    // audit trail that Identity never granted.
    return refuse('delegation-not-required');
  }
  return accept('delegated');
};

/**
 * Recording a decision on the step a decision is being asked for.
 *
 * The instance's own state moves as a consequence rather than by a separate command: there is no way
 * to complete or reject an instance except by deciding its last step or by rejecting one of them,
 * and no endpoint through which a caller could assign a terminal state directly.
 */
export const decide = (
  instance: WorkflowInstanceState,
  step: WorkflowStepState,
  steps: readonly WorkflowStepState[],
  request: DecideRequest,
  /** The decisions already recorded on this instance. The votes this branch is tallied from. */
  votes: readonly BranchVote[] = [],
): WorkflowResult<DecidedStep> => {
  if (instance.status !== 'running') return refuse('instance-not-running');
  if (step.instanceId !== instance.instanceId) return refuse('step-not-on-this-instance');
  if (!stepPermits(step.status, request.decision)) return refuse('step-not-awaiting-a-decision');
  if (request.decidedByMembershipId === AUTO_APPROVAL) return refuse('decision-requires-a-person');

  const authority = authorityIsCoherent(step, request);

  if (!authority.ok) return refuse(authority.error.reason);

  const decision: WorkflowDecisionState = {
    decisionId: request.decisionId,
    instanceId: instance.instanceId,
    stepId: step.stepId,
    decision: request.decision,
    decidedByMembershipId: request.decidedByMembershipId,
    authority: authority.value,
    decidedAt: request.at,
    version: 1,
    ...definedOf({
      onBehalfOfMembershipId: request.onBehalfOfMembershipId,
      comment: request.comment,
    }),
  };
  const decided: WorkflowStepState = { ...step, status: request.decision };
  // The branch as it stands *including* this decision. The caller passes every vote recorded on the
  // instance; this one is added here so a tally is never computed from a half-written branch.
  //
  // **The votes are narrowed to this branch before they are counted**, and that narrowing is the
  // domain's rather than the caller's. An instance that has already approved two earlier branches
  // carries two votes that have nothing to do with this one, and counting them would approve a
  // majority of five on its third response instead of its third *approval* — a caller passing
  // exactly the right subset would be the only thing standing between that and a wrong outcome.
  const branch = branchAt(steps, step.ordinal);
  const inBranch = new Set(branch.map((other) => other.stepId));
  const tally = tallyOf(branchOf(step), branch.length, [
    ...votes.filter((vote) => inBranch.has(vote.stepId) && vote.stepId !== step.stepId),
    { stepId: step.stepId, decision: request.decision, decidedAt: request.at },
  ]);

  // Steps that already carry a decision are excluded from everything that follows. A branch that
  // ends must not move a colleague's recorded answer to `skipped` — that would replace "they
  // approved" with "nobody asked them", which is a decision being overwritten rather than skipped.
  const answered = new Set([...votes.map((vote) => vote.stepId), step.stepId]);
  const open = steps.filter((other) => !answered.has(other.stepId));

  const outcome: Outcome = {
    instance,
    steps,
    open,
    step: decided,
    decision,
    tally,
    at: request.at,
  };

  if (tally.outcome === 'awaiting') return accept(stillOpen(outcome));
  if (tally.outcome === 'rejected') return accept(rejectedOutcome(outcome));
  return approvedOutcome(outcome);
};

/**
 * Everything the three outcomes are built from, gathered once.
 *
 * An object rather than seven positional parameters, because `steps` and `open` are both lists of
 * steps and swapping them at a call site would compile and quietly skip the wrong people.
 */
interface Outcome {
  readonly instance: WorkflowInstanceState;
  /** Every step of the instance, as it was read. */
  readonly steps: readonly WorkflowStepState[];
  /** The steps that carry no decision — the ones that may still be skipped. */
  readonly open: readonly WorkflowStepState[];
  readonly step: WorkflowStepState;
  readonly decision: WorkflowDecisionState;
  readonly tally: BranchTally;
  readonly at: Date;
}

/**
 * The branch is still open: this person has answered and the others have not.
 *
 * Nothing moves. The instance keeps its version, the remaining steps keep their queue entries, and
 * the only rows written are the decision and this one step.
 */
const stillOpen = ({ instance, step, decision, tally }: Outcome): DecidedStep => ({
  decision,
  step,
  next: [],
  skipped: [],
  instance,
  tally,
});

/**
 * The branch cannot be approved: everything still open is skipped and the instance is rejected.
 *
 * "Everything still open" is every step of every remaining branch, not merely this one's — a
 * rejected approval has nothing left to ask anybody, which is 16A's behaviour unchanged.
 */
const rejectedOutcome = ({ instance, open, step, decision, tally, at }: Outcome): DecidedStep => ({
  decision,
  step,
  next: [],
  skipped: skipRemaining(open),
  instance: { ...instance, status: 'rejected', completedAt: at },
  tally,
});

/**
 * The branch is approved: the next branch whose condition holds starts, or the instance completes.
 *
 * Two kinds of step are skipped here and they are skipped for different reasons. The **rest of this
 * branch** is skipped because the outcome is already determined — a majority of five reached at
 * three leaves two people who no longer need to answer, and leaving their queue entries would be
 * asking for a decision that cannot change anything. The **branches in between** are skipped because
 * their conditions did not hold.
 *
 * A condition that cannot be evaluated is *not* handled here: `chooseBranch` refuses, and the caller
 * refuses with it, so nothing at all is written. That is the fail-closed rule, and it is why this
 * function returns a result rather than a value.
 */
const approvedOutcome = ({
  instance,
  steps,
  open,
  step,
  decision,
  tally,
  at,
}: Outcome): WorkflowResult<DecidedStep> => {
  // The rest of *this* branch, minus anybody who has already answered it.
  const outstanding = skipRemaining(branchAt(open, step.ordinal));
  const chosen = chooseBranch(steps, step.ordinal, instance.context);

  // Fail closed, and all the way out. A condition that cannot be evaluated refuses the **decision**
  // — the approver is told, nothing is written, and the approval stays exactly where it was. An
  // earlier draft of this function treated an unevaluable condition as "nothing follows" and
  // completed the approval, which is the precise failure the missing-key rule exists to prevent.
  if (!chosen.ok) return refuse(chosen.error.reason, chosen.error.detail);

  const skipped = [...outstanding, ...chosen.value.skipped].map(asSkipped);

  if (chosen.value.running.length === 0) {
    return accept({
      decision,
      step,
      next: [],
      skipped,
      instance: { ...instance, status: 'completed', completedAt: at },
      tally,
    });
  }

  return accept({
    decision,
    step,
    next: chosen.value.running.map((following) => ({ ...following, status: 'awaiting' })),
    skipped,
    instance,
    tally,
  });
};

const asSkipped = (step: WorkflowStepState): WorkflowStepState => ({ ...step, status: 'skipped' });

/**
 * An instance's status as `ApprovalPort` names it.
 *
 * The mapping lives here, in one place, so the seam has a single definition that can be tested
 * rather than a conversion rewritten at each call site. `expired` is unreachable in Phase 16A —
 * nothing expires anything, because SLA is 16B and `JobPort` has no adapter — and its absence from
 * the mapping is the honest form of that.
 */
export const approvalStateOf = (status: WorkflowInstanceStatus): ApprovalStateName => {
  const states: Readonly<Record<WorkflowInstanceStatus, ApprovalStateName>> = {
    running: 'pending',
    completed: 'approved',
    rejected: 'rejected',
    cancelled: 'cancelled',
  };

  return states[status];
};
