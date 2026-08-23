import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowInstanceDetailView } from '../contracts/execution-views.js';
import { approvalGroup, decideAs, publishedBranches, startedOn } from './workflow-scenarios.js';
import {
  APPROVER,
  DEPUTY,
  NOW,
  REQUESTER,
  SECOND_APPROVER,
  ask,
  failureOf,
  harnessFor,
  type Harness,
} from './workflow-test-harness.js';

/**
 * Who may answer what, once a branch asks several people at the same moment.
 *
 * Split from `workflow-branches.test.ts` at the file-size budget, along a real seam: next door is
 * about how a branch *ends*, and this is about the access decision that precedes every vote. The
 * rule is 16A's unchanged — the step is resolved from the membership on the request — and what Phase
 * 16B adds is that there are now several open steps to resolve it against.
 */

const detailOf = (harness: Harness, instanceId: string): Promise<WorkflowInstanceDetailView> =>
  ask<WorkflowInstanceDetailView>(harness, { queryName: 'workflow.read-instance', instanceId });

describe('what a decision may not do', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('refuses a second decision on a step, and any decision once the approval has ended', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 1, approverMembershipId: SECOND_APPROVER },
      ],
      'branch-terminal',
    );
    const instanceId = await startedOn(harness, process, 'requisition-terminal');

    await decideAs(harness, APPROVER, instanceId, 'rejected');

    // The branch is over, so the colleague who never answered has nothing to answer — and the
    // refusal says the step is not awaiting rather than pretending they were never asked.
    expect(failureOf(await decideAs(harness, SECOND_APPROVER, instanceId, 'approved'))).toBe(
      'workflow.rejection.instance-has-no-awaiting-step',
    );
    // And the recorded decision is still there: ending a branch skips the people who did not answer,
    // never the person who did.
    const detail = await detailOf(harness, instanceId);

    expect(detail.decisions).toHaveLength(1);
    expect(detail.steps.find((step) => step.status === 'rejected')).toBeDefined();
  });

  it('lets a deputy answer one step, as one vote for the approver they act for', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER, branchRule: 'majority' },
        { ordinal: 1, approverMembershipId: SECOND_APPROVER, branchRule: 'majority' },
        { ordinal: 1, approverMembershipId: REQUESTER, branchRule: 'majority' },
      ],
      'branch-delegated',
    );
    const instanceId = await startedOn(harness, process, 'requisition-delegated');

    harness.delegation.grant(APPROVER, DEPUTY, {
      from: new Date(NOW.getTime() - 3_600_000),
      to: new Date(NOW.getTime() + 3_600_000),
    });

    expect(failureOf(await decideAs(harness, DEPUTY, instanceId, 'approved'))).toBe(undefined);

    const detail = await detailOf(harness, instanceId);

    // One vote, not two: the delegate acted and the approver's authority was used, which is two
    // identities on one decision rather than two decisions.
    expect(detail.tallies[0]).toMatchObject({ approvals: 1, responses: 1, assigned: 3 });
    expect(detail.decisions).toHaveLength(1);
    expect(detail.decisions[0]).toMatchObject({
      decidedByMembershipId: DEPUTY,
      authority: 'delegated',
      onBehalfOfMembershipId: APPROVER,
    });
  });

  it('asks the caller to name a step when a branch asks them twice', async () => {
    const groupId = await approvalGroup(harness, [APPROVER, SECOND_APPROVER]);
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverGroupId: groupId, branchRule: 'majority' },
        { ordinal: 1, approverMembershipId: APPROVER, branchRule: 'majority' },
      ],
      'branch-twice',
    );
    const instanceId = await startedOn(harness, process, 'requisition-twice');
    const detail = await detailOf(harness, instanceId);
    const mine = detail.awaitingSteps.filter((step) => step.approverMembershipId === APPROVER);

    expect(mine).toHaveLength(2);
    // Answering "one of them" would record a decision against a step the caller never chose, so
    // they are told to name one rather than having one picked for them.
    expect(failureOf(await decideAs(harness, APPROVER, instanceId, 'approved'))).toBe(
      'workflow.rejection.decision-step-ambiguous',
    );
    expect(
      failureOf(
        await decideAs(harness, APPROVER, instanceId, 'approved', {
          stepId: mine[0]?.stepId ?? '',
        }),
      ),
    ).toBe(undefined);
  });

  it('refuses a named step that belongs to somebody else', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 1, approverMembershipId: SECOND_APPROVER },
      ],
      'branch-not-mine',
    );
    const instanceId = await startedOn(harness, process, 'requisition-not-mine');
    const theirs = (await detailOf(harness, instanceId)).awaitingSteps.find(
      (step) => step.approverMembershipId === SECOND_APPROVER,
    );

    // `stepId` narrows the caller's own set and cannot widen it: naming a colleague's step is
    // refused exactly as sending nothing would be.
    expect(
      failureOf(
        await decideAs(harness, APPROVER, instanceId, 'approved', { stepId: theirs?.stepId ?? '' }),
      ),
    ).toBe('workflow.rejection.decision-not-the-assigned-approver');
  });
});
