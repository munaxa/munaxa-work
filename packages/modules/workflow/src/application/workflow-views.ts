import type { ApprovalGroupMemberState, ApprovalGroupState } from '../domain/approval-group.js';
import type { BranchTally } from '../domain/branch.js';
import type { WorkflowDecisionState } from '../domain/decision.js';
import type {
  WorkflowDefinitionState,
  WorkflowStepTemplateState,
  WorkflowVersionState,
} from '../domain/definition.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import type { WorkflowInstanceState, WorkflowStepState } from '../domain/instance.js';
import type {
  ApprovalGroupMemberView,
  ApprovalGroupView,
  StepServiceLevelView,
  WorkflowDefinitionView,
  WorkflowStepTemplateView,
  WorkflowVersionView,
} from '../contracts/views.js';
import type {
  BranchTallyView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowHistoryView,
  WorkflowInstanceView,
  WorkflowStepView,
} from '../contracts/execution-views.js';
import { dueAt, overdueByMinutes, serviceLevelState } from '../domain/service-level.js';
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
 * **The mappers drop nothing and invent nothing.** No count is computed here, no status is derived
 * and no field is filled in from another row: a view that quietly derived something would be a second
 * place the rule lived, and the first place is the domain.
 *
 * **Two views are assembled from a domain function rather than copied**, and both say so where they
 * are defined: `asTallyView` carries `tallyOf`'s numbers, and `asServiceLevelView` calls
 * `service-level.ts` for the due time, the state and the overdue minutes. Neither does arithmetic of
 * its own. The distinction that matters is that the *rule* stays in one place — these two read a
 * function, and the mapper that recomputed one would be the drift this comment exists to prevent.
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
    branchRule: state.branchRule,
    quorum: state.quorum,
    condition: state.condition,
    serviceLevel: state.serviceLevel,
  }),
});

/**
 * How a step stands against its target, **as at a supplied instant**.
 *
 * The instant is a parameter and never a clock read here, which is the one rule that makes any of
 * this assertable: a mapper that reached for the current time would give two answers to one question
 * asked twice in a millisecond, and no suite could pin a boundary. Every handler that calls this
 * passes `dependencies.clock.now()`, so the reading instant is the request's own.
 *
 * **The arithmetic is the domain's, all four times.** Due, state and overdue-by come from
 * `service-level.ts`, and this function converts and assembles. Recomputing any of them here — even
 * one that agreed today — would be the second place the rule lived.
 *
 * `undefined` where the step carries no target, which is how the field comes to be absent from the
 * view rather than present and empty.
 */
const asServiceLevelView = (
  state: WorkflowStepState,
  asAt: Date,
): StepServiceLevelView | undefined => {
  const target = state.serviceLevel;

  if (target === undefined) return undefined;

  const due = dueAt(target, state.awaitingAt);

  return {
    count: target.count,
    unit: target.unit,
    state: serviceLevelState(target, state.awaitingAt, asAt),
    ...definedOf({
      awaitingOn: state.awaitingAt === undefined ? undefined : at(state.awaitingAt),
      dueOn: due === undefined ? undefined : at(due),
      overdueByMinutes: overdueByMinutes(target, state.awaitingAt, asAt),
    }),
  };
};

export const asGroupView = (state: ApprovalGroupState): ApprovalGroupView => ({
  approvalGroupId: state.approvalGroupId,
  code: state.code,
  name: state.name,
  version: state.version,
});

export const asGroupMemberView = (state: ApprovalGroupMemberState): ApprovalGroupMemberView => ({
  approvalGroupMemberId: state.approvalGroupMemberId,
  approvalGroupId: state.approvalGroupId,
  membershipId: state.membershipId,
  addedOn: at(state.addedAt),
});

/**
 * How one branch stands, from the domain's own tally.
 *
 * Field for field, with no arithmetic of its own: the ordinal is the branch it describes, and every
 * other number comes from `tallyOf`. A mapper that recomputed any of them would be the second place
 * the rule lived — and the tally is exactly the rule that decides who is approved.
 */
export const asTallyView = (ordinal: number, tally: BranchTally): BranchTallyView => ({
  ordinal,
  rule: tally.rule,
  assigned: tally.assigned,
  approvals: tally.approvals,
  rejections: tally.rejections,
  responses: tally.responses,
  outstanding: tally.outstanding,
  threshold: tally.threshold,
  quorum: tally.quorum,
  quorumMet: tally.quorumMet,
  outcome: tally.outcome,
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

/**
 * One step, as at a reading instant.
 *
 * `asAt` is required rather than optional, and it is why every call site below is written out rather
 * than passed to `.map` directly: a mapper whose reading instant could be omitted would silently
 * produce a step whose due-ness was answered from nothing, and one passed straight to `.map` would
 * receive the array index as its second argument.
 */
export const asStepView = (state: WorkflowStepState, asAt: Date): WorkflowStepView => ({
  stepId: state.stepId,
  instanceId: state.instanceId,
  ordinal: state.ordinal,
  approverKind: state.approverKind,
  approverMembershipId: state.approverMembershipId,
  status: state.status,
  // Outside `definedOf` deliberately: the field is required, so `false` must be published rather than
  // dropped. A step whose marker went missing would read as "not escalated" to a consumer that could
  // not tell the difference (D-16D-09).
  escalated: state.escalatedAt !== undefined,
  version: state.version,
  ...definedOf({
    sourceGroupId: state.sourceGroupId,
    branchRule: state.branchRule,
    quorum: state.quorum,
    condition: state.condition,
    serviceLevel: asServiceLevelView(state, asAt),
  }),
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
  asAt: Date,
): PendingApprovalView => ({
  stepId: step.stepId,
  instanceId: instance.instanceId,
  ordinal: step.ordinal,
  subjectType: instance.subjectType,
  subjectId: instance.subjectId,
  definitionCode,
  startedOn: at(instance.startedAt),
  version: step.version,
  ...definedOf({ serviceLevel: asServiceLevelView(step, asAt) }),
});
