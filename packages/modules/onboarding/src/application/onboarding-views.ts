import type { OnboardingInstanceState } from '../domain/onboarding-state.js';
import type { PlanState } from '../domain/plan.js';
import type { PlanVersionState, TaskTemplateState } from '../domain/plan-version.js';
import type { TaskState } from '../domain/task-definition.js';
import type { TaskEventState } from '../domain/task-event.js';
import type {
  OnboardingProgressView,
  OnboardingView,
  PlanVersionView,
  PlanView,
  TaskEventView,
  TaskTemplateView,
  TaskView,
} from '../contracts/views.js';
import type { TaskTally } from './onboarding-ports.js';

/**
 * Domain state to published view.
 *
 * In the application layer rather than the domain, because a view answers a consumer's question and
 * the domain has no consumers. Two rules hold throughout: an absent value is **omitted** rather than
 * published as null, and nothing is computed here that the domain does not already assert — the one
 * derived field, `readyToComplete`, is the same comparison the completion command makes, so a screen
 * and the command cannot disagree about whether the button should work.
 */

export const planView = (state: PlanState): PlanView => ({
  planId: state.id,
  code: state.code,
  name: state.name,
  ...(state.description === undefined ? {} : { description: state.description }),
  status: state.status,
  metadata: state.metadata,
  version: state.version,
});

export const planVersionView = (state: PlanVersionState): PlanVersionView => ({
  planVersionId: state.id,
  planId: state.planId,
  versionNumber: state.versionNumber,
  status: state.status,
  ...(state.publishedAt === undefined ? {} : { publishedAt: state.publishedAt }),
  ...(state.publishedBy === undefined ? {} : { publishedBy: state.publishedBy }),
  version: state.version,
});

export const taskTemplateView = (state: TaskTemplateState): TaskTemplateView => ({
  templateId: state.id,
  planVersionId: state.planVersionId,
  code: state.code,
  sequence: state.sequence,
  title: state.title,
  ...(state.description === undefined ? {} : { description: state.description }),
  kind: state.kind,
  ownerKind: state.ownerKind,
  ...(state.ownerRef === undefined ? {} : { ownerRef: state.ownerRef }),
  ...(state.ownerRole === undefined ? {} : { ownerRole: state.ownerRole }),
  required: state.required,
  dueAnchor: state.dueAnchor,
  dueOffsetDays: state.dueOffsetDays,
  ...(state.dependsOnTemplateCode === undefined
    ? {}
    : { dependsOnTemplateCode: state.dependsOnTemplateCode }),
  ...(state.documentTypeCode === undefined ? {} : { documentTypeCode: state.documentTypeCode }),
  version: state.version,
});

export const onboardingView = (state: OnboardingInstanceState): OnboardingView => ({
  onboardingId: state.id,
  employmentId: state.employmentId,
  personId: state.personId,
  ...(state.applicationId === undefined ? {} : { applicationId: state.applicationId }),
  ...(state.planId === undefined ? {} : { planId: state.planId }),
  ...(state.planVersionId === undefined ? {} : { planVersionId: state.planVersionId }),
  state: state.state,
  plannedStartOn: state.plannedStartOn,
  ...(state.employmentStartOn === undefined ? {} : { employmentStartOn: state.employmentStartOn }),
  ...conclusionOf(state),
  metadata: state.metadata,
  version: state.version,
});

/** How it ended, if it has. Hoisted so the view stays inside its complexity budget. */
const conclusionOf = (state: OnboardingInstanceState): Partial<OnboardingView> => ({
  ...(state.completedOn === undefined ? {} : { completedOn: state.completedOn }),
  ...(state.completedBy === undefined ? {} : { completedBy: state.completedBy }),
  ...(state.cancellationReasonCode === undefined
    ? {}
    : { cancellationReasonCode: state.cancellationReasonCode }),
});

export const taskView = (state: TaskState): TaskView => ({
  taskId: state.id,
  onboardingId: state.onboardingId,
  ...(state.templateCode === undefined ? {} : { templateCode: state.templateCode }),
  sequence: state.sequence,
  title: state.title,
  ...(state.description === undefined ? {} : { description: state.description }),
  kind: state.kind,
  ownerKind: state.ownerKind,
  ...(state.ownerRef === undefined ? {} : { ownerRef: state.ownerRef }),
  ...(state.ownerRole === undefined ? {} : { ownerRole: state.ownerRole }),
  required: state.required,
  status: state.status,
  ...(state.dueOn === undefined ? {} : { dueOn: state.dueOn }),
  ...(state.dependsOnTaskId === undefined ? {} : { dependsOnTaskId: state.dependsOnTaskId }),
  ...documentOf(state),
  ...completionOf(state),
  version: state.version,
});

/** What was provided, as a reference. Never bytes, and never a name. */
const documentOf = (state: TaskState): Partial<TaskView> => ({
  ...(state.documentReference === undefined ? {} : { documentReference: state.documentReference }),
  ...(state.documentTypeCode === undefined ? {} : { documentTypeCode: state.documentTypeCode }),
});

const completionOf = (state: TaskState): Partial<TaskView> => ({
  ...(state.completedAt === undefined ? {} : { completedAt: state.completedAt }),
  ...(state.completedBy === undefined ? {} : { completedBy: state.completedBy }),
  ...(state.completionNote === undefined ? {} : { completionNote: state.completionNote }),
  ...(state.waiverReasonCode === undefined ? {} : { waiverReasonCode: state.waiverReasonCode }),
});

export const taskEventView = (state: TaskEventState): TaskEventView => ({
  eventId: state.id,
  taskId: state.taskId,
  onboardingId: state.onboardingId,
  kind: state.kind,
  ...(state.fromStatus === undefined ? {} : { fromStatus: state.fromStatus }),
  ...(state.toStatus === undefined ? {} : { toStatus: state.toStatus }),
  ...(state.detail === undefined ? {} : { detail: state.detail }),
  occurredAt: state.occurredAt,
  recordedBy: state.recordedBy,
});

/**
 * Progress, from the tally the database computed.
 *
 * `readyToComplete` is the same comparison `Onboarding.complete` makes. Writing it twice would be
 * two answers to "can this be finished", and the screen would eventually offer a button the command
 * refuses.
 */
export const progressView = (onboardingId: string, tally: TaskTally): OnboardingProgressView => ({
  onboardingId,
  requiredTotal: tally.requiredTotal,
  requiredSatisfied: tally.requiredSatisfied,
  requiredOverdue: tally.requiredOverdue,
  optionalTotal: tally.optionalTotal,
  optionalSatisfied: tally.optionalSatisfied,
  outstandingByOwnerKind: tally.byOwnerKindOutstanding,
  readyToComplete: tally.requiredSatisfied >= tally.requiredTotal,
});

/** Oldest first, which is how a history is read. */
export const byOccurredAt = <TState extends { readonly occurredAt: Date }>(
  left: TState,
  right: TState,
): number => left.occurredAt.getTime() - right.occurredAt.getTime();
