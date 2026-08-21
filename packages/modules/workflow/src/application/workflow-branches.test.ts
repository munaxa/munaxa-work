import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowInstanceDetailView } from '../contracts/execution-views.js';
import { decideAs, publishedBranches, runningApproval, startedOn } from './workflow-scenarios.js';
import {
  APPROVER,
  DEPUTY,
  OUTSIDER,
  REQUESTER,
  SECOND_APPROVER,
  ask,
  failureOf,
  harnessFor,
  type Harness,
} from './workflow-test-harness.js';

/**
 * Parallel branches, through the real handlers.
 *
 * A **branch** is the set of steps sharing an ordinal, and all of them are asked at the same moment.
 * The domain decides every outcome here — `tallyOf` says whether a branch has ended, `chooseBranch`
 * says what opens next — and the application's whole job is to read the votes, hand them over, and
 * persist what comes back. So these assertions are about the *orchestration*: that the right votes
 * reach the tally, that everybody in a branch is put on a queue, that a person answers their own
 * step, and that what the domain returns is what ends up stored.
 *
 * **The arithmetic itself is asserted in `domain/workflow-tally.test.ts`**, against the numbers it
 * was approved with. What is checked here is that the application does not quietly compute a second
 * version of it — the boundary cases below are the ones an application-level shortcut would get
 * wrong: a tie, a non-response, and a vote from a branch that has already finished.
 */

const detailOf = (harness: Harness, instanceId: string): Promise<WorkflowInstanceDetailView> =>
  ask<WorkflowInstanceDetailView>(harness, { queryName: 'workflow.read-instance', instanceId });

const statusOf = async (harness: Harness, instanceId: string): Promise<string> =>
  (await detailOf(harness, instanceId)).instance.status;

describe('a branch of several approvers', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  const branchOfThree = async (
    rule: 'unanimous' | 'majority' | 'first-response',
    subjectId: string,
    quorum?: number,
  ): Promise<string> => {
    const process = await publishedBranches(
      harness,
      [APPROVER, SECOND_APPROVER, DEPUTY].map((approver) => ({
        ordinal: 1,
        approverMembershipId: approver,
        branchRule: rule,
        ...(quorum === undefined ? {} : { quorum }),
      })),
      `branch-${subjectId}`,
    );

    return startedOn(harness, process, subjectId);
  };

  it('asks everybody in the branch at once', async () => {
    const instanceId = await branchOfThree('unanimous', 'requisition-all');
    const detail = await detailOf(harness, instanceId);

    expect(detail.awaitingSteps).toHaveLength(3);
    // The 16A field is the first of them rather than a wrong one, and it is one of three.
    expect(detail.awaiting?.stepId).toBe(detail.awaitingSteps[0]?.stepId);
    expect(detail.tallies[0]).toMatchObject({
      ordinal: 1,
      rule: 'unanimous',
      assigned: 3,
      approvals: 0,
      outstanding: 3,
      threshold: 3,
      outcome: 'awaiting',
    });
  });

  it('lets each of them answer their own step, and nobody else’s', async () => {
    const instanceId = await branchOfThree('unanimous', 'requisition-own');

    expect(failureOf(await decideAs(harness, APPROVER, instanceId, 'approved'))).toBe(undefined);
    expect(failureOf(await decideAs(harness, APPROVER, instanceId, 'approved'))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
    // The step is resolved from the membership on the request. Somebody who was not asked has
    // nothing on this branch, whatever they send.
    expect(failureOf(await decideAs(harness, OUTSIDER, instanceId, 'approved'))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
    expect(await statusOf(harness, instanceId)).toBe('running');
  });

  it('waits while anybody could still change the outcome, and counts a non-response as outstanding', async () => {
    const instanceId = await branchOfThree('unanimous', 'requisition-waiting');

    await decideAs(harness, APPROVER, instanceId, 'approved');

    const detail = await detailOf(harness, instanceId);

    // The denominator does not move. A branch of three where one person answered is not a branch of
    // one, and the two people who have not answered are counted rather than excluded.
    expect(detail.tallies[0]).toMatchObject({
      assigned: 3,
      approvals: 1,
      responses: 1,
      outstanding: 2,
      outcome: 'awaiting',
    });
    expect(detail.instance.status).toBe('running');
    expect(detail.awaitingSteps).toHaveLength(2);
  });

  it('completes on unanimity and ends on the first rejection', async () => {
    const unanimous = await branchOfThree('unanimous', 'requisition-unanimous');

    for (const approver of [APPROVER, SECOND_APPROVER, DEPUTY]) {
      await decideAs(harness, approver, unanimous, 'approved');
    }
    expect(await statusOf(harness, unanimous)).toBe('completed');

    const refused = await branchOfThree('unanimous', 'requisition-refused');

    await decideAs(harness, SECOND_APPROVER, refused, 'rejected');

    // One rejection puts the threshold out of reach, so nobody else needs to be asked.
    const detail = await detailOf(harness, refused);

    expect(detail.instance.status).toBe('rejected');
    expect(detail.steps.filter((step) => step.status === 'skipped')).toHaveLength(2);
    expect(detail.awaitingSteps).toStrictEqual([]);
  });

  it('approves a majority as soon as it is reached, and leaves nobody waiting afterwards', async () => {
    const instanceId = await branchOfThree('majority', 'requisition-majority');

    await decideAs(harness, APPROVER, instanceId, 'approved');
    expect(await statusOf(harness, instanceId)).toBe('running');

    await decideAs(harness, SECOND_APPROVER, instanceId, 'approved');

    const detail = await detailOf(harness, instanceId);

    // Two of three is the threshold, and the third person's queue entry is skipped rather than left
    // asking for a decision that cannot change anything.
    expect(detail.instance.status).toBe('completed');
    expect(detail.tallies[0]).toMatchObject({ approvals: 2, threshold: 2, outcome: 'approved' });
    expect(detail.steps.filter((step) => step.status === 'skipped')).toHaveLength(1);
  });

  it('does not approve a tie', async () => {
    const process = await publishedBranches(
      harness,
      [APPROVER, SECOND_APPROVER, DEPUTY, REQUESTER].map((approver) => ({
        ordinal: 1,
        approverMembershipId: approver,
        branchRule: 'majority' as const,
      })),
      'branch-tie',
    );
    const instanceId = await startedOn(harness, process, 'requisition-tie');

    await decideAs(harness, APPROVER, instanceId, 'approved');
    await decideAs(harness, SECOND_APPROVER, instanceId, 'approved');
    await decideAs(harness, DEPUTY, instanceId, 'rejected');
    await decideAs(harness, REQUESTER, instanceId, 'rejected');

    // Two of four is exactly half, and half is not a majority. `ceil(n / 2)` would have approved it,
    // which is the single most likely way this arithmetic could have been got wrong.
    expect(await statusOf(harness, instanceId)).toBe('rejected');
  });

  it('is decided by the first response when that is the rule', async () => {
    const instanceId = await branchOfThree('first-response', 'requisition-first');

    await decideAs(harness, DEPUTY, instanceId, 'approved');

    const detail = await detailOf(harness, instanceId);

    expect(detail.instance.status).toBe('completed');
    expect(detail.tallies[0]).toMatchObject({ rule: 'first-response', threshold: 1 });
    expect(detail.steps.filter((step) => step.status === 'skipped')).toHaveLength(2);
  });

  it('holds a branch awaiting until its quorum is met, in both directions', async () => {
    const gated = await branchOfThree('first-response', 'requisition-quorum', 2);

    await decideAs(harness, APPROVER, gated, 'approved');

    // One response, quorum of two: the rule is not consulted at all, so an approval that would
    // otherwise have ended the branch does not.
    expect(await statusOf(harness, gated)).toBe('running');
    expect((await detailOf(harness, gated)).tallies[0]).toMatchObject({
      quorum: 2,
      quorumMet: false,
      outcome: 'awaiting',
    });

    await decideAs(harness, SECOND_APPROVER, gated, 'approved');
    expect(await statusOf(harness, gated)).toBe('completed');
  });

  it('refuses a quorum larger than the branch when the version is published', async () => {
    const refused: string = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER, quorum: 2 }],
      'branch-impossible',
    ).then(
      () => 'published',
      (error: unknown) => (error instanceof Error ? error.message : 'unknown'),
    );

    // A branch of one that needs two responses could never end, and the moment to say so is while
    // somebody is still editing rather than after an approval has stalled.
    expect(refused).toContain('branch-quorum-exceeds-approvers');
  });
});

describe('one branch after another', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('opens every step of the next branch when this one ends', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 2, approverMembershipId: SECOND_APPROVER },
        { ordinal: 2, approverMembershipId: DEPUTY },
      ],
      'branch-sequence',
    );
    const instanceId = await startedOn(harness, process, 'requisition-sequence');

    expect((await detailOf(harness, instanceId)).awaitingSteps).toHaveLength(1);

    await decideAs(harness, APPROVER, instanceId, 'approved');

    const detail = await detailOf(harness, instanceId);

    // A branch of two puts two people on a queue, and the timeline says so once per person.
    expect(detail.awaitingSteps.map((step) => step.approverMembershipId).sort()).toStrictEqual(
      [SECOND_APPROVER, DEPUTY].sort(),
    );
    expect(detail.tallies).toHaveLength(2);
    expect(detail.tallies[0]?.outcome).toBe('approved');
    expect(detail.tallies[1]?.outcome).toBe('awaiting');
  });

  /**
   * **A vote from a finished branch must not be counted into the next one.**
   *
   * The second branch here needs a majority of three. If the two approvals from the first branch
   * leaked into its tally, its first response would approve it — an approval reached by counting
   * people who were answering a different question.
   */
  it('tallies each branch from its own votes and nobody else’s', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 1, approverMembershipId: SECOND_APPROVER },
        ...[APPROVER, SECOND_APPROVER, DEPUTY].map((approver) => ({
          ordinal: 2,
          approverMembershipId: approver,
          branchRule: 'majority' as const,
        })),
      ],
      'branch-isolated',
    );
    const instanceId = await startedOn(harness, process, 'requisition-isolated');

    await decideAs(harness, APPROVER, instanceId, 'approved');
    await decideAs(harness, SECOND_APPROVER, instanceId, 'approved');
    await decideAs(harness, DEPUTY, instanceId, 'approved');

    const detail = await detailOf(harness, instanceId);

    expect(detail.instance.status).toBe('running');
    expect(detail.tallies[1]).toMatchObject({ assigned: 3, approvals: 1, outcome: 'awaiting' });
  });

  it('keeps a sequential chain behaving exactly as it did before this phase', async () => {
    const approval = await runningApproval(harness, [APPROVER, SECOND_APPROVER], 'requisition-16a');

    await decideAs(harness, APPROVER, approval.instanceId, 'approved');

    const middle = await detailOf(harness, approval.instanceId);

    // Distinct ordinals produce branches of one, and a branch of one under the default rule is 16A's
    // step: one approver who must approve, asked in order.
    expect(middle.awaitingSteps).toHaveLength(1);
    expect(middle.tallies.map((tally) => tally.assigned)).toStrictEqual([1, 1]);
    expect(middle.tallies[0]).toMatchObject({ rule: 'unanimous', quorum: 1, outcome: 'approved' });

    await decideAs(harness, SECOND_APPROVER, approval.instanceId, 'approved');
    expect(await statusOf(harness, approval.instanceId)).toBe('completed');
  });
});
