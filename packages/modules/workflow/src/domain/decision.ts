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
import {
  skipRemaining,
  stepAfter,
  type WorkflowInstanceState,
  type WorkflowStepState,
} from './instance.js';
import { definedOf } from './defined.js';

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
 * **A rejection ends the instance.** With one step awaiting at a time there is no tally to run and
 * no denominator to argue about (D-6): the step is rejected, the remaining steps are skipped, and
 * the instance is rejected. Majority, unanimity and first-response-wins are Phase 16B, and there is
 * no vocabulary in this module in which to express any of them.
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
  /** The step that becomes `awaiting`, when the instance continues. Absent when it ends. */
  readonly next?: WorkflowStepState;
  /** The steps abandoned by a rejection. Empty on an approval. */
  readonly skipped: readonly WorkflowStepState[];
  readonly instance: WorkflowInstanceState;
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

  return accept(
    request.decision === 'rejected'
      ? rejectedOutcome(instance, steps, decided, decision, request.at)
      : approvedOutcome(instance, steps, decided, decision, request.at),
  );
};

/** A rejection: this step ends, everything still open is skipped, and the instance is rejected. */
const rejectedOutcome = (
  instance: WorkflowInstanceState,
  steps: readonly WorkflowStepState[],
  step: WorkflowStepState,
  decision: WorkflowDecisionState,
  at: Date,
): DecidedStep => ({
  decision,
  step,
  skipped: skipRemaining(steps.filter((other) => other.stepId !== step.stepId)),
  instance: { ...instance, status: 'rejected', completedAt: at },
});

/**
 * An approval: the next step by ordinal starts awaiting, or the instance completes.
 *
 * "The next step" is a lookup by ordinal rather than by array position, and it is total because
 * `publishVersion` refused any version whose ordinals were not contiguous from one.
 */
const approvedOutcome = (
  instance: WorkflowInstanceState,
  steps: readonly WorkflowStepState[],
  step: WorkflowStepState,
  decision: WorkflowDecisionState,
  at: Date,
): DecidedStep => {
  const following = stepAfter(steps, step.ordinal);

  if (following === undefined) {
    return {
      decision,
      step,
      skipped: [],
      instance: { ...instance, status: 'completed', completedAt: at },
    };
  }

  return {
    decision,
    step,
    next: { ...following, status: 'awaiting' },
    skipped: [],
    instance,
  };
};

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
