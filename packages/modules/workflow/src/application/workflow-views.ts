import type { WorkflowDecisionState } from '../domain/decision.js';
import type {
  WorkflowDefinitionState,
  WorkflowStepTemplateState,
  WorkflowVersionState,
} from '../domain/definition.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import type { WorkflowInstanceState, WorkflowStepState } from '../domain/instance.js';
import type {
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowDefinitionView,
  WorkflowHistoryView,
  WorkflowInstanceView,
  WorkflowStepTemplateView,
  WorkflowStepView,
  WorkflowVersionView,
} from '../contracts/views.js';
import { definedOf } from '../domain/defined.js';

/**
 * State to view, in one place.
 *
 * Every instant becomes an ISO-8601 string here and nowhere else. That is the boundary rule this
 * module keeps: a `Date` exists inside the domain and inside the repositories, and never crosses
 * into a published contract, where a consumer's own time zone would decide what it means. Workflow
 * has no civil date at all — a request, a decision and a step becoming current are moments — so the
 * string is a full instant rather than a `YYYY-MM-DD` day.
 *
 * **The mappers drop nothing and add nothing.** No count is computed here, no status is derived and
 * no field is filled in from another row: a view that quietly derived something would be a second
 * place the rule lived, and the first place is the domain.
 */

const at = (moment: Date): string => moment.toISOString();

export const asDefinitionView = (state: WorkflowDefinitionState): WorkflowDefinitionView => ({
  definitionId: state.definitionId,
  code: state.code,
  name: state.name,
  subjectType: state.subjectType,
  status: state.status,
  version: state.version,
  ...definedOf({
    description: state.description,
    retiredOn: state.retiredAt === undefined ? undefined : at(state.retiredAt),
  }),
});

export const asVersionView = (
  state: WorkflowVersionState,
  stepCount: number,
): WorkflowVersionView => ({
  workflowVersionId: state.workflowVersionId,
  definitionId: state.definitionId,
  versionNumber: state.versionNumber,
  status: state.status,
  stepCount,
  version: state.version,
  ...definedOf({
    publishedOn: state.publishedAt === undefined ? undefined : at(state.publishedAt),
  }),
});

export const asTemplateView = (state: WorkflowStepTemplateState): WorkflowStepTemplateView => ({
  stepTemplateId: state.stepTemplateId,
  ordinal: state.ordinal,
  name: state.name,
  approverKind: state.approverKind,
  ...definedOf({
    approverMembershipId: state.approverMembershipId,
    approverGroupId: state.approverGroupId,
  }),
});

export const asInstanceView = (state: WorkflowInstanceState): WorkflowInstanceView => ({
  instanceId: state.instanceId,
  definitionId: state.definitionId,
  workflowVersionId: state.workflowVersionId,
  subjectType: state.subjectType,
  subjectId: state.subjectId,
  requestedByMembershipId: state.requestedByMembershipId,
  status: state.status,
  startedOn: at(state.startedAt),
  version: state.version,
  ...definedOf({
    completedOn: state.completedAt === undefined ? undefined : at(state.completedAt),
  }),
});

export const asStepView = (state: WorkflowStepState): WorkflowStepView => ({
  stepId: state.stepId,
  instanceId: state.instanceId,
  ordinal: state.ordinal,
  approverKind: state.approverKind,
  approverMembershipId: state.approverMembershipId,
  status: state.status,
  version: state.version,
});

/**
 * A decision, with both identities kept apart.
 *
 * `decidedByMembershipId` is who acted; `onBehalfOfMembershipId` is whose authority they used, and
 * it is present only under delegation. A view that carried one field would have to choose which
 * question to answer, and the answer it dropped is the one an auditor asks.
 */
export const asDecisionView = (state: WorkflowDecisionState): WorkflowDecisionView => ({
  decisionId: state.decisionId,
  stepId: state.stepId,
  decision: state.decision,
  decidedByMembershipId: state.decidedByMembershipId,
  authority: state.authority,
  decidedOn: at(state.decidedAt),
  ...definedOf({
    onBehalfOfMembershipId: state.onBehalfOfMembershipId,
    comment: state.comment,
  }),
});

export const asHistoryView = (state: WorkflowHistoryState): WorkflowHistoryView => ({
  historyId: state.historyId,
  instanceId: state.instanceId,
  event: state.event,
  occurredOn: at(state.occurredAt),
  ...definedOf({
    stepId: state.stepId,
    ordinal: state.ordinal,
    actorMembershipId: state.actorMembershipId,
    onBehalfOfMembershipId: state.onBehalfOfMembershipId,
  }),
});

/**
 * One row of the caller's queue.
 *
 * It carries the subject and the definition's code because a queue with neither is a list of
 * identifiers nobody can act on — and it carries no approver, because the only approver a row of
 * this list can have is the caller.
 */
export const asPendingView = (
  step: WorkflowStepState,
  instance: WorkflowInstanceState,
  definitionCode: string,
): PendingApprovalView => ({
  stepId: step.stepId,
  instanceId: instance.instanceId,
  ordinal: step.ordinal,
  subjectType: instance.subjectType,
  subjectId: instance.subjectId,
  definitionCode,
  startedOn: at(instance.startedAt),
  version: step.version,
});
