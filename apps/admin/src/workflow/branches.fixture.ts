import type {
  ApprovalGroupDetailView,
  ApprovalGroupView,
  WorkflowDefinitionDetailView,
  WorkflowInstanceDetailView,
  WorkflowStepView,
} from '@work/workflow/contracts';

import {
  APPROVER,
  AT,
  DEPUTY,
  INSTANCE_ID,
  LATER,
  aDefinitionDetail,
  aDirectDecision,
  anInstance,
} from './views.fixture';

/**
 * The Phase 16B views: the lists, the branches, the tallies and the conditions.
 *
 * Separate from `views.fixture.ts` for the file budget, and the split falls where the phase does —
 * everything here is a shape that did not exist before approval groups and parallel branches did.
 *
 * **The numbers are chosen so a screen that computed them would disagree.** The branch is a
 * `majority` over a denominator of two, which needs two approvals; one approval has been made. A
 * screen printing `approvals` where `threshold` belongs shows `1`, one deriving `floor(2 / 2)` shows
 * `1`, and both are wrong against a server that says `2`.
 */

export const GROUP_ID = '01930000-0000-7000-8000-0000000000a3';
export const OTHER_GROUP_ID = '01930000-0000-7000-8000-0000000000a4';
export const THIRD = '01930000-0000-7000-8000-0000000000e3';

export const aGroup = (): ApprovalGroupView => ({
  approvalGroupId: GROUP_ID,
  code: 'capital-approvers',
  name: { en: 'Capital approvers', ar: 'معتمدو النفقات' },
  version: 2,
});

export const anotherGroup = (): ApprovalGroupView => ({
  ...aGroup(),
  approvalGroupId: OTHER_GROUP_ID,
  code: 'finance-directors',
  name: { en: 'Finance directors', ar: 'المديرون الماليون' },
  version: 1,
});

/**
 * One list with two memberships on it.
 *
 * **Two, and both in full.** These identifiers share their first eight characters, so a screen that
 * shortened them would render one list of two people as one list of the same person twice.
 */
export const aGroupDetail = (): ApprovalGroupDetailView => ({
  group: aGroup(),
  members: [
    {
      approvalGroupMemberId: '01930000-0000-7000-8000-000000000061',
      approvalGroupId: GROUP_ID,
      membershipId: APPROVER,
      addedOn: AT,
    },
    {
      approvalGroupMemberId: '01930000-0000-7000-8000-000000000062',
      approvalGroupId: GROUP_ID,
      membershipId: DEPUTY,
      addedOn: LATER,
    },
  ],
});

/**
 * A version whose first position is a branch and whose second is one named person.
 *
 * The branch names a **group**, carries a rule, a quorum and two conditions; the second step carries
 * none of the three, which is what every step configured before Phase 16B looks like. A screen that
 * filled the domain's defaults in would print `unanimous` on the second row, reporting a decision
 * the tenant never made.
 */
export const aBranchedDefinitionDetail = (): WorkflowDefinitionDetailView => ({
  ...aDefinitionDetail(),
  publishedSteps: [
    {
      stepTemplateId: '01930000-0000-7000-8000-0000000000b3',
      ordinal: 1,
      name: { en: 'Capital committee', ar: 'لجنة النفقات' },
      approverKind: 'group',
      approverGroupId: GROUP_ID,
      branchRule: 'majority',
      quorum: 2,
      condition: [
        { key: 'amount', operator: 'greater-than', value: 4000 },
        { key: 'unit', operator: 'in', value: ['finance', 'operations'] },
      ],
    },
    {
      stepTemplateId: '01930000-0000-7000-8000-0000000000b4',
      ordinal: 2,
      name: { en: 'Finance director', ar: 'المدير المالي' },
      approverKind: 'membership',
      approverMembershipId: THIRD,
    },
  ],
});

/**
 * An approval whose first branch has two people in it, both asked at once.
 *
 * The tally is the one the server would compute: two assigned, one approval, one outstanding, a
 * threshold of two under `majority` over a denominator of two, and a quorum of two not yet met. The
 * numbers are chosen so a screen deriving any of them would disagree — `floor(2 / 2) + 1` is two,
 * and a screen that instead printed the count of approvals would print one.
 */
export const aParallelInstanceDetail = (): WorkflowInstanceDetailView => ({
  instance: anInstance(),
  steps: [aBranchStep(APPROVER, 'approved'), aBranchStep(DEPUTY, 'awaiting'), aSecondBranchStep()],
  decisions: [aDirectDecision()],
  awaitingSteps: [aBranchStep(DEPUTY, 'awaiting')],
  awaiting: aBranchStep(DEPUTY, 'awaiting'),
  tallies: [
    {
      ordinal: 1,
      rule: 'majority',
      assigned: 2,
      approvals: 1,
      rejections: 0,
      responses: 1,
      outstanding: 1,
      threshold: 2,
      quorum: 2,
      quorumMet: false,
      outcome: 'awaiting',
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

/** A step somebody was given because they were on a list: `approverKind` is `membership` all the
 *  same, and `sourceGroupId` records where they came from. */
const aBranchStep = (approver: string, status: 'approved' | 'awaiting'): WorkflowStepView => ({
  stepId:
    approver === APPROVER
      ? '01930000-0000-7000-8000-000000000093'
      : '01930000-0000-7000-8000-000000000094',
  instanceId: INSTANCE_ID,
  ordinal: 1,
  approverKind: 'membership',
  approverMembershipId: approver,
  status,
  // From a group, not from an escalation. The two provenances are independent, and this fixture is
  // the one that would catch a screen collapsing them.
  escalated: false,
  sourceGroupId: GROUP_ID,
  branchRule: 'majority',
  quorum: 2,
  version: 1,
});

/** The position after the branch: one person, named individually, nothing reached yet. */
const aSecondBranchStep = (): WorkflowStepView => ({
  stepId: '01930000-0000-7000-8000-000000000095',
  instanceId: INSTANCE_ID,
  ordinal: 2,
  approverKind: 'membership',
  approverMembershipId: THIRD,
  status: 'pending',
  escalated: false,
  version: 1,
});
