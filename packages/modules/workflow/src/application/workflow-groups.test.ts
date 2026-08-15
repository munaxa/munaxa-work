import { beforeEach, describe, expect, it } from 'vitest';

import type { ApprovalGroupDetailView, WorkflowInstanceDetailView } from '../contracts/views.js';
import { approvalGroup, decideAs, publishedBranches, startedOn } from './workflow-scenarios.js';
import {
  APPROVER,
  DEPUTY,
  OTHER_TENANT,
  OUTSIDER,
  SECOND_APPROVER,
  ask,
  attempt,
  attemptAsk,
  failureOf,
  harnessFor,
  send,
  type Harness,
} from './workflow-test-harness.js';
import type { Page } from './workflow-ports.js';

/**
 * Approval groups, through the real commands and the real queries.
 *
 * A group is **a list somebody wrote down**, and every assertion here is about keeping it that: a
 * code unique to its tenant, a membership that appears once, a membership free to appear on several
 * lists, and no lifecycle to police. Nothing in this file resolves a membership through Identity,
 * because nothing in the module does — an approver is a membership named individually, and looking
 * one up would be the first half of the directory this product has committed not to build.
 *
 * **The snapshot is the assertion that matters most.** A group edited after an approval started must
 * change nothing about it: not who is asked, not the denominator its tally is computed against, not
 * its outcome. That is AD-003 applied to the one thing that could otherwise move underneath a live
 * approval, and it is proved here by editing a group between the start and the decisions.
 */

const detailOf = (harness: Harness, instanceId: string): Promise<WorkflowInstanceDetailView> =>
  ask<WorkflowInstanceDetailView>(harness, { queryName: 'workflow.read-instance', instanceId });

const groupOf = (harness: Harness, approvalGroupId: string): Promise<ApprovalGroupDetailView> =>
  ask<ApprovalGroupDetailView>(harness, {
    queryName: 'workflow.read-approval-group',
    approvalGroupId,
  });

describe('the lists a tenant keeps', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('names a list, fills it, and reads it back in a deterministic order', async () => {
    const groupId = await approvalGroup(harness, [SECOND_APPROVER, APPROVER, DEPUTY]);
    const detail = await groupOf(harness, groupId);

    expect(detail.group.code).toBe('capital-approvers');
    // Ordered by membership identifier rather than by when somebody was added, so two reads agree
    // and two instances started from one group produce their steps in the same sequence.
    expect(detail.members.map((member) => member.membershipId)).toStrictEqual(
      [APPROVER, SECOND_APPROVER, DEPUTY].sort((left, right) => left.localeCompare(right)),
    );
  });

  it('starts empty, because a list is named before it is filled', async () => {
    const groupId = await approvalGroup(harness, []);

    expect((await groupOf(harness, groupId)).members).toStrictEqual([]);
  });

  it('refuses a duplicate code and a code that is not a code', async () => {
    await approvalGroup(harness, [APPROVER], 'finance-directors');

    const duplicate = await attempt(harness, {
      commandName: 'workflow.create-approval-group',
      code: 'finance-directors',
      name: { en: 'x', ar: 'x' },
    });
    const malformed = await attempt(harness, {
      commandName: 'workflow.create-approval-group',
      code: 'Finance Directors',
      name: { en: 'x', ar: 'x' },
    });

    expect(failureOf(duplicate)).toBe('workflow_approval_group_code_taken');
    expect(failureOf(malformed)).toBe('workflow.rejection.group-code-invalid');
  });

  it('refuses the same membership twice on one list and permits it on another', async () => {
    const first = await approvalGroup(harness, [APPROVER], 'capital-approvers');
    const second = await approvalGroup(harness, [], 'hiring-panel');
    const again = await attempt(harness, {
      commandName: 'workflow.add-group-member',
      approvalGroupId: first,
      membershipId: APPROVER,
    });
    const elsewhere = await attempt(harness, {
      commandName: 'workflow.add-group-member',
      approvalGroupId: second,
      membershipId: APPROVER,
    });

    expect(failureOf(again)).toBe('workflow_approval_group_member_taken');
    // Uniqueness is on the *pair*. A person who approves capital expenditure and also sits on the
    // hiring panel is two rows, and a globally unique membership would be a directory's rule.
    expect(failureOf(elsewhere)).toBe(undefined);
  });

  it('takes somebody off a list, which is the one thing this module removes', async () => {
    const groupId = await approvalGroup(harness, [APPROVER, SECOND_APPROVER]);
    const before = await groupOf(harness, groupId);
    const member = before.members.find((row) => row.membershipId === APPROVER);

    await send(harness, {
      commandName: 'workflow.remove-group-member',
      approvalGroupMemberId: member?.approvalGroupMemberId,
    });

    expect((await groupOf(harness, groupId)).members.map((row) => row.membershipId)).toStrictEqual([
      SECOND_APPROVER,
    ]);
  });

  it('answers not found for a group and a member that are not there', async () => {
    expect(
      failureOf(
        await attemptAsk(harness, {
          queryName: 'workflow.read-approval-group',
          approvalGroupId: 'nope',
        }),
      ),
    ).toBe('not_found:workflow-approval-group');
    expect(
      failureOf(
        await attempt(harness, {
          commandName: 'workflow.remove-group-member',
          approvalGroupMemberId: 'nope',
        }),
      ),
    ).toBe('not_found:workflow-approval-group-member');
    expect(
      failureOf(
        await attempt(harness, {
          commandName: 'workflow.add-group-member',
          approvalGroupId: 'nope',
          membershipId: APPROVER,
        }),
      ),
    ).toBe('not_found:workflow-approval-group');
  });

  it('lists groups bounded, with a total counted over the whole set', async () => {
    for (const code of ['a-list', 'b-list', 'c-list']) {
      await approvalGroup(harness, [APPROVER], code);
    }

    const page = await ask<Page<{ readonly code: string }>>(harness, {
      queryName: 'workflow.search-approval-groups',
      page: 1,
      size: 2,
    });

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });

  it('keeps two tenants’ identical codes apart', async () => {
    const other = harnessFor({ tenantId: OTHER_TENANT });

    await approvalGroup(harness, [APPROVER], 'shared-code');
    await other.as(APPROVER, () =>
      send(other, {
        commandName: 'workflow.create-approval-group',
        code: 'shared-code',
        name: { en: 'x', ar: 'x' },
      }),
    );

    // Two harnesses, two stores, and nothing shared. Real cross-tenant isolation is row-level
    // security's and is asserted against PostgreSQL, where it actually lives — what this shows is
    // that the code uniqueness the application enforces is not global.
    const mine = await ask<Page<unknown>>(harness, {
      queryName: 'workflow.search-approval-groups',
    });
    const theirs = await other.as(APPROVER, () =>
      ask<Page<unknown>>(other, { queryName: 'workflow.search-approval-groups' }),
    );

    expect([mine.total, theirs.total]).toStrictEqual([1, 1]);
  });
});

describe('a group resolved into an approval', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('expands into one step per member, each naming a person rather than the list', async () => {
    const groupId = await approvalGroup(harness, [APPROVER, SECOND_APPROVER, DEPUTY]);
    const process = await publishedBranches(harness, [{ ordinal: 1, approverGroupId: groupId }]);
    const instanceId = await startedOn(harness, process, 'requisition-group');
    const detail = await detailOf(harness, instanceId);

    expect(detail.steps).toHaveLength(3);
    // Always a membership: the group was resolved before these rows existed, which is why a running
    // step's approver kind never says `group`.
    expect(detail.steps.every((step) => step.approverKind === 'membership')).toBe(true);
    expect(detail.steps.every((step) => step.sourceGroupId === groupId)).toBe(true);
    expect(detail.awaitingSteps).toHaveLength(3);
  });

  /**
   * **The snapshot, proved by breaking the group after the approval started.**
   *
   * Everybody is removed and a stranger is added. The approval must not notice: the same three
   * people are still asked, the denominator is still three, and the outsider has nothing to decide.
   */
  it('is untouched by every later edit to the group it came from', async () => {
    const groupId = await approvalGroup(harness, [APPROVER, SECOND_APPROVER, DEPUTY]);
    const process = await publishedBranches(harness, [
      { ordinal: 1, approverGroupId: groupId, branchRule: 'majority' },
    ]);
    const instanceId = await startedOn(harness, process, 'requisition-frozen');
    const before = await groupOf(harness, groupId);

    for (const member of before.members) {
      await send(harness, {
        commandName: 'workflow.remove-group-member',
        approvalGroupMemberId: member.approvalGroupMemberId,
      });
    }
    await send(harness, {
      commandName: 'workflow.add-group-member',
      approvalGroupId: groupId,
      membershipId: OUTSIDER,
    });

    const after = await detailOf(harness, instanceId);

    expect(after.steps.map((step) => step.approverMembershipId).sort()).toStrictEqual(
      [APPROVER, SECOND_APPROVER, DEPUTY].sort(),
    );
    expect(after.tallies[0]?.assigned).toBe(3);
    // The person added afterwards was never asked, so there is nothing for them to answer.
    expect(failureOf(await decideAs(harness, OUTSIDER, instanceId, 'approved'))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );

    await decideAs(harness, APPROVER, instanceId, 'approved');
    await decideAs(harness, SECOND_APPROVER, instanceId, 'approved');

    // Two of three is a majority of the *snapshotted* three, and the approval completes on it.
    expect((await detailOf(harness, instanceId)).instance.status).toBe('completed');
  });

  it('refuses to start when the group it names is empty, rather than approving instantly', async () => {
    const groupId = await approvalGroup(harness, []);
    const process = await publishedBranches(harness, [{ ordinal: 1, approverGroupId: groupId }]);
    const refused = await harness.as(APPROVER, () =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId: process.definitionId,
        subjectType: 'recruitment.requisition',
        subjectId: 'requisition-empty',
      }),
    );

    // An approval that started with a branch nobody was asked to decide would complete instantly
    // while looking like a process — the failure `version-has-no-steps` prevents, by another road.
    expect(failureOf(refused)).toBe('workflow.rejection.branch-group-empty');
  });

  it('refuses a step naming a group that does not exist', async () => {
    const version = await send<{ workflowVersionId: string }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: (
        await send<{ definitionId: string }>(harness, {
          commandName: 'workflow.create-definition',
          code: 'ghost-group',
          name: { en: 'x', ar: 'x' },
          subjectType: 'recruitment.requisition',
        })
      ).definitionId,
    });
    const refused = await attempt(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: version.workflowVersionId,
      ordinal: 1,
      name: { en: 'x', ar: 'x' },
      approverGroupId: 'no-such-group',
    });

    // Caught while the administrator is still editing, rather than at every approval started from a
    // version that names a list nobody can find.
    expect(failureOf(refused)).toBe('not_found:workflow-approval-group');
  });

  it('refuses a step naming both a person and a list', async () => {
    const groupId = await approvalGroup(harness, [APPROVER]);
    const process = await send<{ definitionId: string }>(harness, {
      commandName: 'workflow.create-definition',
      code: 'ambiguous',
      name: { en: 'x', ar: 'x' },
      subjectType: 'recruitment.requisition',
    });
    const version = await send<{ workflowVersionId: string }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: process.definitionId,
    });
    const refused = await attempt(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: version.workflowVersionId,
      ordinal: 1,
      name: { en: 'x', ar: 'x' },
      approverMembershipId: APPROVER,
      approverGroupId: groupId,
    });

    // Two readings, and whichever an implementation picked would decide who approves.
    expect(failureOf(refused)).toBe('workflow.rejection.step-approver-ambiguous');
  });
});
