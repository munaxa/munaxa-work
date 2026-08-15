import {
  isSubjectType,
  type ApproverKind,
  type WorkflowInstanceStatus,
  type WorkflowStepStatus,
} from './workflow-vocabulary.js';
import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';
import { definedOf } from './defined.js';
import { chooseBranch, planSteps, type GroupSnapshot } from './branch-plan.js';
import type { BranchCondition } from './condition.js';
import type { BranchRule } from './workflow-vocabulary.js';
import type { WorkflowStepTemplateState, WorkflowVersionState } from './definition.js';

/**
 * A running process, and its steps.
 *
 * **The steps are copied, not referenced.** `startInstance` returns a step per template, carrying
 * the ordinal, the name and the approver the template named at that moment. Archiving the version,
 * retiring the definition or publishing a replacement therefore changes nothing about an approval
 * already under way — which is AD-003 made structural rather than promised. Onboarding copies a
 * plan version's tasks at creation for exactly this reason (ADR-0048), and Performance snapshots a
 * scale so a completed rating still explains itself (ADR-0068).
 *
 * **The subject is opaque.** `subjectType` and `subjectId` are what the requesting module supplied
 * through `ApprovalPort`, and Workflow reads neither. There is no join, no foreign key and no
 * lookup: a business module's identifier means whatever that module means by it (AD-001).
 *
 * **`context` is stored and read by nothing in 16A.** `ApprovalRequest.context` is described by the
 * port as "facts the routing rules may read", and 16A has no routing rules — branching is 16B
 * (D-7). It is kept because it is the request's own payload and an auditor asking "what was this
 * decided on" should find it, and it is documented as unread so nobody infers a rule from its
 * presence.
 *
 * **A branch is what awaits, not a step.** 16A's invariant was that exactly one step of a running
 * instance is `awaiting`; Phase 16B's is that exactly one **branch** is — every step sharing the
 * lowest unfinished ordinal, all asked at once. A version whose ordinals are all distinct produces
 * branches of one and behaves exactly as it did before, which is why every process configured under
 * 16A keeps running unchanged.
 *
 * **A group is expanded here and never again.** `startInstance` takes the group memberships the
 * caller read and copies them into steps, so a running approval names people rather than a list. The
 * list may then be edited, emptied or deleted without touching it.
 *
 * **`context` is finally read — by conditions, and by nothing else.** 16A stored it and documented
 * that nothing consumed it. A branch's condition is evaluated against it when the branch would
 * start, and a condition that cannot be evaluated refuses the whole operation rather than quietly
 * routing past somebody.
 */

export interface WorkflowInstanceState {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly workflowVersionId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  /** The membership that asked. Resolved from the request, never supplied by a caller (D-13). */
  readonly requestedByMembershipId: string;
  readonly status: WorkflowInstanceStatus;
  readonly startedAt: Date;
  readonly correlationId: string;
  /** The requesting module's own facts. Stored, audited, and read by nothing in 16A. */
  readonly context: Readonly<Record<string, unknown>>;
  readonly completedAt?: Date;
  readonly cancelledBy?: string;
  readonly cancellationReason?: string;
  readonly version: number;
}

/**
 * One step of a running instance.
 *
 * **`approverKind` is always `membership` here, and that is the point of the group snapshot.** A
 * template may name a group; a step never does, because the group was resolved into its members
 * before this row existed. At the moment somebody is actually asked there is only ever a person,
 * which is why the step's own check constraint did not change in 16B.
 *
 * `sourceGroupId` records where that person came from. It is provenance for the audit — "why was I
 * asked?" — and is read by nothing that routes.
 */
export interface WorkflowStepState {
  readonly stepId: string;
  readonly instanceId: string;
  /** The branch this step belongs to. Shared with every other step asked at the same moment. */
  readonly ordinal: number;
  readonly approverKind: ApproverKind;
  readonly approverMembershipId: string;
  readonly status: WorkflowStepStatus;
  /** The group this approver was snapshotted from, when they came from one. */
  readonly sourceGroupId?: string;
  /** Copied from the template, so a running approval keeps the rule it started under. */
  readonly branchRule?: BranchRule;
  readonly quorum?: number;
  readonly condition?: readonly BranchCondition[];
  readonly version: number;
}

export interface StartInstanceRequest {
  readonly instanceId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly requestedByMembershipId: string;
  readonly correlationId: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly at: Date;
  /**
   * One identifier per **planned** step, in plan order. Kept out of the domain's own generation.
   *
   * A group of four expands to four steps, so the count is no longer the number of templates. The
   * caller sizes this with `plannedStepCount`, and a mismatch is refused rather than padded.
   */
  readonly stepIds: readonly string[];
  /** The membership of every group the version names, as the caller read it. Snapshotted here. */
  readonly groups?: readonly GroupSnapshot[];
}

export interface StartedInstance {
  readonly instance: WorkflowInstanceState;
  readonly steps: readonly WorkflowStepState[];
}

/**
 * Starting an instance from a published version.
 *
 * Refused on a draft or archived version: a draft is not a process anybody agreed to, and an
 * archived one is a process the tenant has stopped choosing. Refused with no steps, which a
 * published version cannot have — asserted here anyway, because this function is what an adapter
 * calls and a defect that reached it would otherwise create an instance with nothing to approve and
 * no way ever to complete.
 */
export const startInstance = (
  version: WorkflowVersionState,
  templates: readonly WorkflowStepTemplateState[],
  request: StartInstanceRequest,
): WorkflowResult<StartedInstance> => {
  const usable = startIsUsable(version, templates, request);

  if (!usable.ok) return refuse(usable.error.reason);

  const planned = planSteps(templates, request.groups ?? []);

  if (!planned.ok) return refuse(planned.error.reason, planned.error.detail);
  if (request.stepIds.length !== planned.value.length) {
    return refuse('step-identifiers-mismatched');
  }

  const configuration = new Map(templates.map((template) => [template.ordinal, template]));
  const pending: readonly WorkflowStepState[] = planned.value.map((step, index) => ({
    stepId: request.stepIds[index] ?? '',
    instanceId: request.instanceId,
    ordinal: step.ordinal,
    // Always a membership: the group, if there was one, has already been resolved into this person.
    approverKind: 'membership',
    approverMembershipId: step.approverMembershipId,
    status: 'pending',
    version: 1,
    ...definedOf({
      sourceGroupId: step.sourceGroupId,
      branchRule: configuration.get(step.ordinal)?.branchRule,
      quorum: configuration.get(step.ordinal)?.quorum,
      condition: configuration.get(step.ordinal)?.condition,
    }),
  }));
  // Which branch actually opens: the first one whose condition holds. Everything before it is
  // skipped, and a condition that cannot be evaluated refuses the start outright.
  const opening = chooseBranch(pending, 0, request.context);

  if (!opening.ok) return refuse(opening.error.reason, opening.error.detail);

  const awaiting = new Set(opening.value.running.map((step) => step.stepId));
  const skipped = new Set(opening.value.skipped.map((step) => step.stepId));
  const nothingToDecide = opening.value.running.length === 0;

  return accept({
    instance: {
      instanceId: request.instanceId,
      definitionId: version.definitionId,
      workflowVersionId: version.workflowVersionId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      requestedByMembershipId: request.requestedByMembershipId,
      // Every branch's condition refused it, so nobody has anything to decide. A tenant configured
      // that — "below this amount, nobody approves" — and it is not the product approving on their
      // behalf. It is recorded as completed at the instant it started, with every step skipped and a
      // history entry for each, so the record says plainly that nobody was asked.
      status: nothingToDecide ? 'completed' : 'running',
      startedAt: request.at,
      correlationId: request.correlationId,
      context: request.context,
      version: 1,
      ...definedOf({ completedAt: nothingToDecide ? request.at : undefined }),
    },
    steps: pending.map((step) => ({
      ...step,
      status: statusOf(step.stepId, awaiting, skipped),
    })),
  });
};

/** Everything that must be true before a start is even planned. Separated to keep `startInstance`
 * about building an approval rather than about validating one. */
const startIsUsable = (
  version: WorkflowVersionState,
  templates: readonly WorkflowStepTemplateState[],
  request: StartInstanceRequest,
): WorkflowResult<true> => {
  if (version.status !== 'published') return refuse('version-not-published');
  if (templates.length === 0) return refuse('version-has-no-steps');
  if (!isSubjectType(request.subjectType)) return refuse('subject-type-invalid');
  if (request.stepIds.some((stepId) => stepId.trim().length === 0)) {
    return refuse('step-identifiers-mismatched');
  }
  return accept(true);
};

const statusOf = (
  stepId: string,
  awaiting: ReadonlySet<string>,
  skipped: ReadonlySet<string>,
): WorkflowStepStatus => {
  if (awaiting.has(stepId)) return 'awaiting';
  if (skipped.has(stepId)) return 'skipped';
  return 'pending';
};

/**
 * The steps a decision is being asked for right now — the open branch.
 *
 * Plural since 16B. `awaitingStep` is kept beside it and returns the first, because two callers
 * genuinely want one: the queue view of an approval with a single-approver chain, and the seam that
 * asks "is anything outstanding". Both are honest about a branch of several — the first of them is
 * still one of them — and neither uses it to decide anything.
 */
export const awaitingSteps = (steps: readonly WorkflowStepState[]): readonly WorkflowStepState[] =>
  steps.filter((step) => step.status === 'awaiting');

/** The first step of the open branch, if any. See `awaitingSteps`. */
export const awaitingStep = (steps: readonly WorkflowStepState[]): WorkflowStepState | undefined =>
  awaitingSteps(steps)[0];

/** The step that follows an ordinal, by order rather than by array position. */
export const stepAfter = (
  steps: readonly WorkflowStepState[],
  ordinal: number,
): WorkflowStepState | undefined =>
  [...steps]
    .sort((left, right) => left.ordinal - right.ordinal)
    .find((step) => step.ordinal > ordinal);

/**
 * Every step that has not reached an ending, moved to `skipped`.
 *
 * Used when an instance is rejected or cancelled. They are moved rather than left `pending`, because
 * a step still reading "pending" on a finished instance is a queue entry waiting to be misread as
 * work somebody owes — and the queue is the screen this whole phase is for.
 */
export const skipRemaining = (steps: readonly WorkflowStepState[]): readonly WorkflowStepState[] =>
  steps
    .filter((step) => step.status === 'pending' || step.status === 'awaiting')
    .map((step) => ({ ...step, status: 'skipped' }));

export interface CancelInstanceRequest {
  readonly by: string;
  readonly reason: string;
  readonly at: Date;
}

export interface CancelledInstance {
  readonly instance: WorkflowInstanceState;
  readonly skipped: readonly WorkflowStepState[];
}

/**
 * Cancelling a running instance.
 *
 * A named human act with its own permission, and terminal: a cancelled instance is not resumed, for
 * the same reason a rejected one is not resubmitted. Asking again is a new instance.
 *
 * A reason is required, as Career requires one to take somebody off a succession bench: this is the
 * act somebody asks about later, and "why did this approval stop" has an answer the organization
 * should have written down at the time.
 *
 * Cancellation is **not** a rejection. The business module learns that nobody decided, rather than
 * that somebody refused.
 */
export const cancelInstance = (
  state: WorkflowInstanceState,
  steps: readonly WorkflowStepState[],
  request: CancelInstanceRequest,
): WorkflowResult<CancelledInstance> => {
  if (state.status !== 'running') return refuse('instance-not-running');
  if (request.reason.trim().length === 0) return refuse('cancellation-reason-required');

  return accept({
    instance: {
      ...state,
      status: 'cancelled',
      completedAt: request.at,
      cancelledBy: request.by,
      cancellationReason: request.reason,
    },
    skipped: skipRemaining(steps),
  });
};
