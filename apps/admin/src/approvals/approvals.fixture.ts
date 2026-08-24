import type {
  ApprovalStatusView,
  BranchTallyView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowHistoryView,
  WorkflowInstanceDetailView,
  WorkflowStepView,
} from '@work/workflow/contracts';

import type { ApprovalsForDisplay, Queue } from './api';

/**
 * One person's approval work, as Workflow would answer it.
 *
 * Every value is shaped by the module's published contract, so a change to one this screen has not
 * followed fails to compile rather than rendering something wrong. Nothing is invented: no field
 * appears that a contract does not carry.
 *
 * The totals are deliberately **larger than the item counts**. A queue that reported its own page
 * length would tell somebody with three hundred approvals that they have two, and a fixture whose
 * total happened to equal its length could not catch it.
 */

const INSTANCE = '01900000-0000-7000-8000-00000000i001';
const DIRECTOR = '01900000-0000-7000-8000-00000000m001';
const DEPUTY = '01900000-0000-7000-8000-00000000m002';

export const aPendingApproval = (): PendingApprovalView => ({
  stepId: '01900000-0000-7000-8000-00000000s001',
  instanceId: INSTANCE,
  ordinal: 2,
  subjectType: 'recruitment.requisition',
  subjectId: '01900000-0000-7000-8000-00000000r001',
  definitionCode: 'REQUISITION-APPROVAL',
  startedOn: '2026-08-20T09:00:00.000Z',
  serviceLevel: {
    count: 48,
    unit: 'hours',
    awaitingOn: '2026-08-20T09:00:00.000Z',
    dueOn: '2026-08-22T09:00:00.000Z',
    state: 'overdue',
    overdueByMinutes: 2880,
  },
  version: 1,
});

export const aWithinApproval = (): PendingApprovalView => ({
  ...aPendingApproval(),
  stepId: '01900000-0000-7000-8000-00000000s002',
  ordinal: 1,
  definitionCode: 'OFFER-APPROVAL',
  serviceLevel: {
    count: 24,
    unit: 'hours',
    awaitingOn: '2026-08-23T09:00:00.000Z',
    dueOn: '2026-08-24T09:00:00.000Z',
    state: 'within',
  },
});

/** A decision the caller made under their own authority. */
export const aDirectDecision = (): WorkflowDecisionView => ({
  decisionId: '01900000-0000-7000-8000-00000000d001',
  stepId: '01900000-0000-7000-8000-00000000s003',
  decision: 'approved',
  decidedByMembershipId: DIRECTOR,
  authority: 'assigned',
  decidedOn: '2026-08-19T11:30:00.000Z',
  comment: 'Budget confirmed.',
});

/** A decision the caller made using somebody else's authority. Two memberships, never one. */
export const aDelegatedDecision = (): WorkflowDecisionView => ({
  decisionId: '01900000-0000-7000-8000-00000000d002',
  stepId: '01900000-0000-7000-8000-00000000s004',
  decision: 'rejected',
  decidedByMembershipId: DEPUTY,
  authority: 'delegated',
  onBehalfOfMembershipId: DIRECTOR,
  decidedOn: '2026-08-18T08:05:00.000Z',
});

const aStep = (): WorkflowStepView => ({
  stepId: '01900000-0000-7000-8000-00000000s001',
  instanceId: INSTANCE,
  ordinal: 2,
  approverKind: 'manager',
  approverMembershipId: DIRECTOR,
  status: 'awaiting',
  escalated: false,
  serviceLevel: {
    count: 48,
    unit: 'hours',
    awaitingOn: '2026-08-20T09:00:00.000Z',
    dueOn: '2026-08-22T09:00:00.000Z',
    state: 'overdue',
    overdueByMinutes: 2880,
  },
  version: 1,
});

const aTally = (): BranchTallyView => ({
  ordinal: 2,
  rule: 'majority',
  assigned: 3,
  approvals: 1,
  rejections: 0,
  responses: 1,
  outstanding: 2,
  threshold: 2,
  quorum: 0,
  quorumMet: true,
  outcome: 'awaiting',
});

export const anInstanceDetail = (): WorkflowInstanceDetailView => ({
  instance: {
    instanceId: INSTANCE,
    definitionId: '01900000-0000-7000-8000-00000000f001',
    workflowVersionId: '01900000-0000-7000-8000-00000000v001',
    subjectType: 'recruitment.requisition',
    subjectId: '01900000-0000-7000-8000-00000000r001',
    requestedByMembershipId: DEPUTY,
    status: 'running',
    startedOn: '2026-08-20T09:00:00.000Z',
    version: 3,
  },
  steps: [aStep()],
  decisions: [aDirectDecision(), aDelegatedDecision()],
  awaitingSteps: [aStep()],
  awaiting: aStep(),
  tallies: [aTally()],
});

export const aHistoryEntry = (): WorkflowHistoryView => ({
  historyId: '01900000-0000-7000-8000-00000000h001',
  instanceId: INSTANCE,
  event: 'step-awaiting',
  occurredOn: '2026-08-20T09:00:00.000Z',
  stepId: '01900000-0000-7000-8000-00000000s001',
  ordinal: 2,
  actorMembershipId: DIRECTOR,
});

export const anApprovalStatus = (): ApprovalStatusView => ({
  approvalId: INSTANCE,
  state: 'pending',
  steps: [
    { approver: DIRECTOR, decision: 'approved', decidedOn: '2026-08-19T11:30:00.000Z' },
    { approver: DEPUTY },
  ],
});

const queue = <TItem>(items: readonly TItem[], total: number): Queue<TItem> => ({ items, total });

/** Both queues answered, with server totals larger than the pages they describe. */
export const aFullQueue = (): ApprovalsForDisplay => ({
  pending: queue([aPendingApproval(), aWithinApproval()], 317),
  decided: queue([aDirectDecision(), aDelegatedDecision()], 42),
});

/** Both refused — the ordinary state of a deployment with no Platform authentication adapter. */
export const aRefusedQueue = (): ApprovalsForDisplay => ({
  pending: undefined,
  decided: undefined,
});

/** Both answered, and both genuinely clear. Not the same thing as the above. */
export const aClearQueue = (): ApprovalsForDisplay => ({
  pending: queue([], 0),
  decided: queue([], 0),
});

/** One refused and one answered: two independent permissions, two independent answers. */
export const aPartialQueue = (): ApprovalsForDisplay => ({
  pending: undefined,
  decided: queue([aDirectDecision()], 1),
});
