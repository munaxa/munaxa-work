import type {
  ApprovalStatusView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowDefinitionDetailView,
  WorkflowDefinitionView,
  WorkflowHistoryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceView,
  WorkflowStepView,
} from '@work/workflow/contracts';

/**
 * The published views this screen renders, as the API would send them.
 *
 * **Typed as the module's contracts**, so a field that disappears from a view stops compiling here
 * rather than rendering as `undefined` in a cell nobody notices. Nothing below is a row, a domain
 * state or a Prisma type.
 *
 * Three values are chosen to fail rather than to pass:
 *
 * - The instants are **`2026-02-28T23:30:00.000Z`** and its neighbours — half an hour before
 *   midnight UTC on the last day of a February. Rendered in the server's own zone rather than pinned
 *   to UTC, that moment reads as the 28th at 15:30 in Los Angeles and as the **1st of March** in
 *   Riyadh, so a screen that dropped the pin would attribute a decision to a different day.
 * - The totals are **four thousand** against a page of one, so a screen that printed `items.length`
 *   as the total could not pass by coincidence.
 * - The delegated decision names **two different memberships**, so a screen that collapsed the actor
 *   and the authority would print one where two belong.
 */

export const AT = '2026-02-28T23:30:00.000Z';
export const LATER = '2026-02-28T23:45:00.000Z';

export const DEFINITION_ID = '01930000-0000-7000-8000-0000000000d1';
export const VERSION_ID = '01930000-0000-7000-8000-0000000000a1';
export const INSTANCE_ID = '01930000-0000-7000-8000-0000000000c1';
export const APPROVER = '01930000-0000-7000-8000-0000000000e1';
export const DEPUTY = '01930000-0000-7000-8000-0000000000e2';
/** The membership a manager step resolved to when its approval started. */
export const MANAGER = '01930000-0000-7000-8000-0000000000e4';
/**
 * The membership an administrator added to a stuck branch in Phase 16D, and the one who added them.
 *
 * The added approver arrives as an **ordinary membership step** — `WorkflowStepView` publishes no
 * escalation marker, so nothing in the steps table sets this row apart from `DEPUTY` beside it. That
 * is the contract as it stands, and the fixture is faithful to it rather than to what a screen might
 * want: the only published trace of the escalation is the timeline entry below.
 */
export const ESCALATED = '01930000-0000-7000-8000-0000000000e5';
export const ADMINISTRATOR = '01930000-0000-7000-8000-0000000000e6';

/**
 * Two due instants the **server** computed. Nothing in these fixtures derives one from a target.
 *
 * Deliberately not on the 1st of March and not at 15:30. Those are the two renderings a *dropped*
 * UTC pin produces for `AT` — east and west of UTC respectively — and the instant regression suite
 * searches the whole page for them. A fixture that happened to contain one would disarm the sharpest
 * assertion on this screen while looking like ordinary data.
 */
export const WITHIN_DUE = '2026-03-05T09:15:00.000Z';
export const OVERDUE_DUE = '2026-03-04T09:15:00.000Z';
export const SUBJECT_ID = '01930000-0000-7000-8000-0000000000f1';

export const aDefinition = (): WorkflowDefinitionView => ({
  definitionId: DEFINITION_ID,
  code: 'requisition-approval',
  name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
  description: { en: 'Two directors, in order', ar: 'مديران، بالترتيب' },
  subjectType: 'recruitment.requisition',
  status: 'active',
  version: 3,
});

export const aRetiredDefinition = (): WorkflowDefinitionView => ({
  ...aDefinition(),
  definitionId: '01930000-0000-7000-8000-0000000000d2',
  code: 'old-approval',
  status: 'retired',
  retiredOn: AT,
});

export const aDefinitionDetail = (): WorkflowDefinitionDetailView => ({
  definition: aDefinition(),
  versions: [
    {
      workflowVersionId: VERSION_ID,
      definitionId: DEFINITION_ID,
      versionNumber: 2,
      status: 'published',
      publishedOn: AT,
      stepCount: 2,
      version: 4,
    },
    {
      workflowVersionId: '01930000-0000-7000-8000-0000000000a2',
      definitionId: DEFINITION_ID,
      versionNumber: 1,
      status: 'archived',
      publishedOn: AT,
      stepCount: 1,
      version: 5,
    },
  ],
  publishedSteps: [
    {
      stepTemplateId: '01930000-0000-7000-8000-0000000000b1',
      ordinal: 1,
      name: { en: 'Hiring manager', ar: 'مدير التوظيف' },
      approverKind: 'membership',
      approverMembershipId: APPROVER,
    },
    {
      stepTemplateId: '01930000-0000-7000-8000-0000000000b2',
      ordinal: 2,
      name: { en: 'Finance director', ar: 'المدير المالي' },
      approverKind: 'membership',
      approverMembershipId: DEPUTY,
      // Phase 16C: a target, in the unit somebody configured it in.
      serviceLevel: { count: 2, unit: 'days' },
    },
    // A manager template names **nobody**: no membership, no group. Both cells are empty on the
    // screen, and that is the configuration rather than missing data.
    {
      stepTemplateId: '01930000-0000-7000-8000-0000000000b3',
      ordinal: 3,
      name: { en: 'Line manager', ar: 'المدير المباشر' },
      approverKind: 'manager',
      serviceLevel: { count: 48, unit: 'hours' },
    },
  ],
});

export const anInstance = (): WorkflowInstanceView => ({
  instanceId: INSTANCE_ID,
  definitionId: DEFINITION_ID,
  workflowVersionId: VERSION_ID,
  subjectType: 'recruitment.requisition',
  subjectId: SUBJECT_ID,
  requestedByMembershipId: APPROVER,
  status: 'running',
  startedOn: AT,
  version: 1,
});

export const anInstanceDetail = (): WorkflowInstanceDetailView => ({
  instance: anInstance(),
  steps: [
    {
      stepId: '01930000-0000-7000-8000-000000000091',
      instanceId: INSTANCE_ID,
      ordinal: 1,
      approverKind: 'membership',
      approverMembershipId: APPROVER,
      status: 'approved',
      version: 2,
    },
    awaitingStep(),
    anEscalatedStep(),
    aResolvedManagerStep(),
  ],
  decisions: [aDirectDecision()],
  /**
   * A sequential chain of branches of one — **and an escalation on the second of them**.
   *
   * Two steps await at ordinal 2 while its tally still reads `assigned: 1`, which is the locked
   * 16D rule (D-16D-08) as an administrator would see it: escalation adds somebody to ask, and moves
   * neither the denominator nor the threshold. A fixture whose denominator followed the row count
   * would let a screen recomputing one pass by coincidence.
   */
  awaitingSteps: [awaitingStep(), anEscalatedStep()],
  awaiting: awaitingStep(),
  tallies: [
    {
      ordinal: 1,
      rule: 'unanimous',
      assigned: 1,
      approvals: 1,
      rejections: 0,
      responses: 1,
      outstanding: 0,
      threshold: 1,
      quorum: 1,
      quorumMet: true,
      outcome: 'approved',
    },
    {
      ordinal: 2,
      rule: 'unanimous',
      assigned: 1,
      approvals: 0,
      rejections: 0,
      responses: 0,
      outstanding: 1,
      threshold: 1,
      quorum: 1,
      quorumMet: false,
      outcome: 'awaiting',
    },
  ],
});

/**
 * The manager step, once it is running: a concrete person, `membership`, and past its target.
 *
 * The resolution happened when the approval started; nothing on the screen re-derives it, and the
 * step is indistinguishable from one a tenant typed a membership into — which is the point.
 *
 * The two service-level numbers are chosen so that a screen computing either would print something
 * else. Forty-eight hours after `AT` is the 2nd of March, not the 4th, and ninety minutes is not the
 * difference between the due instant and any other instant on this page.
 */
const aResolvedManagerStep = (): WorkflowStepView => ({
  stepId: '01930000-0000-7000-8000-000000000093',
  instanceId: INSTANCE_ID,
  ordinal: 3,
  approverKind: 'membership',
  approverMembershipId: MANAGER,
  status: 'pending',
  version: 1,
  serviceLevel: {
    count: 48,
    unit: 'hours',
    awaitingOn: AT,
    dueOn: OVERDUE_DUE,
    state: 'overdue',
    overdueByMinutes: 90,
  },
});

/**
 * The approver an administrator added, exactly as the API publishes them.
 *
 * `membership`, `awaiting`, the branch's own target — the same shape as `awaitingStep()` beside it,
 * with a different person. There is deliberately no field here saying this one was escalated: the
 * view has none to set, and inventing one in a fixture would let a screen appear to render a
 * distinction the server never sends.
 */
const anEscalatedStep = (): WorkflowStepView => ({
  stepId: '01930000-0000-7000-8000-000000000094',
  instanceId: INSTANCE_ID,
  ordinal: 2,
  approverKind: 'membership',
  approverMembershipId: ESCALATED,
  status: 'awaiting',
  version: 1,
  serviceLevel: {
    count: 2,
    unit: 'days',
    awaitingOn: AT,
    dueOn: WITHIN_DUE,
    state: 'within',
  },
});

const awaitingStep = (): WorkflowStepView => ({
  stepId: '01930000-0000-7000-8000-000000000092',
  instanceId: INSTANCE_ID,
  ordinal: 2,
  approverKind: 'membership',
  approverMembershipId: DEPUTY,
  status: 'awaiting',
  version: 1,
  // Within its target, so there is no overdue count to render rather than a zero.
  serviceLevel: {
    count: 2,
    unit: 'days',
    awaitingOn: AT,
    dueOn: WITHIN_DUE,
    state: 'within',
  },
});

/** A decision somebody made on their own step: an actor, and no authority beyond their own. */
export const aDirectDecision = (): WorkflowDecisionView => ({
  decisionId: '01930000-0000-7000-8000-000000000071',
  stepId: '01930000-0000-7000-8000-000000000091',
  decision: 'approved',
  decidedByMembershipId: APPROVER,
  authority: 'assigned',
  decidedOn: AT,
});

/**
 * A decision a deputy made using somebody else's authority.
 *
 * Two different memberships, and a comment — the three things a screen could get wrong at once by
 * collapsing the identities, attributing the decision to the approver, or moving the comment into
 * the timeline.
 */
export const aDelegatedDecision = (): WorkflowDecisionView => ({
  decisionId: '01930000-0000-7000-8000-000000000072',
  stepId: '01930000-0000-7000-8000-000000000092',
  decision: 'rejected',
  decidedByMembershipId: DEPUTY,
  authority: 'delegated',
  onBehalfOfMembershipId: APPROVER,
  decidedOn: LATER,
  comment: 'Not budgeted this quarter',
});

export const aPendingApproval = (): PendingApprovalView => ({
  stepId: '01930000-0000-7000-8000-000000000092',
  instanceId: INSTANCE_ID,
  ordinal: 2,
  subjectType: 'recruitment.requisition',
  subjectId: SUBJECT_ID,
  definitionCode: 'requisition-approval',
  startedOn: AT,
  version: 1,
  // The queue row carries how this step stands, from the same bounded response that returned it.
  serviceLevel: {
    count: 2,
    unit: 'days',
    awaitingOn: AT,
    dueOn: WITHIN_DUE,
    state: 'within',
  },
});

/** An approval still pending: one step answered, one not. `expired` is never produced. */
export const anApprovalStatus = (): ApprovalStatusView => ({
  approvalId: INSTANCE_ID,
  state: 'pending',
  steps: [{ approver: APPROVER, decision: 'approved', decidedOn: AT }, { approver: DEPUTY }],
});

/** The timeline, oldest first — the order the API returns and this screen preserves. */
export const aHistory = (): readonly WorkflowHistoryView[] => [
  {
    historyId: '01930000-0000-7000-8000-000000000081',
    instanceId: INSTANCE_ID,
    event: 'instance-started',
    occurredOn: AT,
    actorMembershipId: APPROVER,
  },
  {
    historyId: '01930000-0000-7000-8000-000000000082',
    instanceId: INSTANCE_ID,
    event: 'step-awaiting',
    occurredOn: AT,
    stepId: '01930000-0000-7000-8000-000000000091',
    ordinal: 1,
  },
  {
    historyId: '01930000-0000-7000-8000-000000000083',
    instanceId: INSTANCE_ID,
    event: 'step-approved',
    occurredOn: LATER,
    stepId: '01930000-0000-7000-8000-000000000091',
    ordinal: 1,
    actorMembershipId: DEPUTY,
    onBehalfOfMembershipId: APPROVER,
  },
  /**
   * Phase 16D's ninth event: an administrator added an approver to the branch at ordinal 2.
   *
   * This entry is the **whole** published record of the escalation — the step it created carries no
   * marker, so the timeline is where an administrator learns that a branch was widened, when, and by
   * whom. It names the actor and nobody's authority: an escalation is issued in the caller's own
   * name, never on behalf of the person added.
   */
  {
    historyId: '01930000-0000-7000-8000-000000000084',
    instanceId: INSTANCE_ID,
    event: 'step-escalated',
    occurredOn: LATER,
    stepId: '01930000-0000-7000-8000-000000000094',
    ordinal: 2,
    actorMembershipId: ADMINISTRATOR,
  },
];
