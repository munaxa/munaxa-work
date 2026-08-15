import type {
  ApprovalStatusView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowDefinitionDetailView,
  WorkflowDefinitionView,
  WorkflowHistoryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceView,
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

const AT = '2026-02-28T23:30:00.000Z';
const LATER = '2026-02-28T23:45:00.000Z';

export const DEFINITION_ID = '01930000-0000-7000-8000-0000000000d1';
export const VERSION_ID = '01930000-0000-7000-8000-0000000000a1';
export const INSTANCE_ID = '01930000-0000-7000-8000-0000000000c1';
export const APPROVER = '01930000-0000-7000-8000-0000000000e1';
export const DEPUTY = '01930000-0000-7000-8000-0000000000e2';
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
    {
      stepId: '01930000-0000-7000-8000-000000000092',
      instanceId: INSTANCE_ID,
      ordinal: 2,
      approverKind: 'membership',
      approverMembershipId: DEPUTY,
      status: 'awaiting',
      version: 1,
    },
  ],
  decisions: [aDirectDecision()],
  awaiting: {
    stepId: '01930000-0000-7000-8000-000000000092',
    instanceId: INSTANCE_ID,
    ordinal: 2,
    approverKind: 'membership',
    approverMembershipId: DEPUTY,
    status: 'awaiting',
    version: 1,
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
];
