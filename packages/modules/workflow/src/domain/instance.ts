import {
  isSubjectType,
  type ApproverKind,
  type WorkflowInstanceStatus,
  type WorkflowStepStatus,
} from './workflow-vocabulary.js';
import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';
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
 * **Exactly one step of a running instance is `awaiting`.** That invariant is what makes sequential
 * approval a property of the data rather than of whatever code happens to walk it, and it is why
 * there is no `parallel` anywhere in this module (D-6).
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

export interface WorkflowStepState {
  readonly stepId: string;
  readonly instanceId: string;
  readonly ordinal: number;
  readonly approverKind: ApproverKind;
  readonly approverMembershipId: string;
  readonly status: WorkflowStepStatus;
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
  /** One identifier per template, in the caller's order. Kept out of the domain's own generation. */
  readonly stepIds: readonly string[];
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
  if (version.status !== 'published') return refuse('version-not-published');
  if (templates.length === 0) return refuse('version-has-no-steps');
  if (!isSubjectType(request.subjectType)) return refuse('subject-type-invalid');
  if (request.stepIds.length !== templates.length) return refuse('step-identifiers-mismatched');
  if (request.stepIds.some((stepId) => stepId.trim().length === 0)) {
    return refuse('step-identifiers-mismatched');
  }

  const ordered = [...templates].sort((left, right) => left.ordinal - right.ordinal);

  return accept({
    instance: {
      instanceId: request.instanceId,
      definitionId: version.definitionId,
      workflowVersionId: version.workflowVersionId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      requestedByMembershipId: request.requestedByMembershipId,
      status: 'running',
      startedAt: request.at,
      correlationId: request.correlationId,
      context: request.context,
      version: 1,
    },
    steps: ordered.map((template, index) => ({
      stepId: request.stepIds[index] ?? '',
      instanceId: request.instanceId,
      ordinal: template.ordinal,
      approverKind: template.approverKind,
      approverMembershipId: template.approverMembershipId,
      // The first step is the one a decision is asked for; the rest have not been reached.
      status: index === 0 ? 'awaiting' : 'pending',
      version: 1,
    })),
  });
};

/** The one step of a running instance a decision is being asked for, if there is one. */
export const awaitingStep = (steps: readonly WorkflowStepState[]): WorkflowStepState | undefined =>
  steps.find((step) => step.status === 'awaiting');

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
