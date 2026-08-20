import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ApprovalGroupDetailView } from '../contracts/views.js';
import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  REQUESTER,
  SECOND_APPROVER,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { liveWorkflow, type LiveWorkflow } from './workflow-live.fixture.js';

/**
 * A list is mutable, and an approval already running is not.
 *
 * Both halves of that sentence are the invariant, and each is uninteresting without the other. The
 * live suite next door proves the second: a list emptied under a running approval leaves it asking
 * the three people it started with. What nothing proves is the **first** — that editing a list
 * changes anything at all — and a module that snapshotted so thoroughly that a new approval also
 * ignored the edit would pass every assertion in this repository while being useless.
 *
 * So this is the ten-step scenario end to end, through the real handlers and the real database:
 * build a list, run an approval off it, edit the list underneath, and start a second approval. The
 * first must be untouched and the second must reflect the edit, and the two are asserted against the
 * **same** group in the **same** tenant so neither can be right for the wrong reason.
 *
 * Nothing here is a double except Identity's delegation register and the module that asked.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's group-snapshot suite");

suite('a group changes; an approval already running does not', () => {
  let fixture: WorkflowFixture;
  let live: LiveWorkflow;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_snapshot_role');
    live = liveWorkflow(fixture);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** Who is on a list right now, as the API would answer it. */
  const membersOf = async (
    approvalGroupId: string,
  ): Promise<
    readonly { readonly approvalGroupMemberId: string; readonly membershipId: string }[]
  > =>
    (
      await live.ask<ApprovalGroupDetailView>({
        queryName: 'workflow.read-approval-group',
        approvalGroupId,
      })
    ).members;

  /** Who an approval is actually asking, in a comparable order. */
  const approversOf = async (instanceId: string): Promise<readonly string[]> =>
    (await live.detailOf(instanceId)).steps
      .map((step) => step.approverMembershipId)
      .sort((left, right) => left.localeCompare(right));

  it('asks the first approval its old members and the second its new ones', async () => {
    // 1–4. A list of two, a process that names it, and an approval raised from it.
    const groupId = await live.aList([APPROVER, DEPUTY]);
    const definitionId = await live.aProcess([
      { ordinal: 1, approverGroupId: groupId, branchRule: 'unanimous' },
    ]);
    const first = await live.start(definitionId, 'requisition-before');

    // 5. Both members of the list, and nobody else.
    expect(await approversOf(first)).toStrictEqual(
      [APPROVER, DEPUTY].sort((left, right) => left.localeCompare(right)),
    );

    // 6–7. The edit: one member off, a different one on. A real removal and a real insertion, each
    // in its own transaction, after the approval above already exists.
    const before = await membersOf(groupId);
    const leaving = before.find((member) => member.membershipId === APPROVER);

    await live.send({
      commandName: 'workflow.remove-group-member',
      approvalGroupMemberId: leaving?.approvalGroupMemberId ?? '',
    });
    await live.send({
      commandName: 'workflow.add-group-member',
      approvalGroupId: groupId,
      membershipId: SECOND_APPROVER,
    });

    expect((await membersOf(groupId)).map((member) => member.membershipId).sort()).toStrictEqual(
      [DEPUTY, SECOND_APPROVER].sort(),
    );

    // 8. The running approval is untouched — the same two people, and the same denominator.
    const untouched = await live.detailOf(first);

    expect(await approversOf(first)).toStrictEqual(
      [APPROVER, DEPUTY].sort((left, right) => left.localeCompare(right)),
    );
    expect(untouched.tallies[0]).toMatchObject({ assigned: 2, threshold: 2, outcome: 'awaiting' });
    // And it still remembers which list it came from, even though that list no longer says so.
    expect(untouched.steps.every((step) => step.sourceGroupId === groupId)).toBe(true);

    // 9–10. A second approval, from the same process and the same list, asks the new membership.
    const second = await live.start(definitionId, 'requisition-after');

    expect(await approversOf(second)).toStrictEqual(
      [DEPUTY, SECOND_APPROVER].sort((left, right) => left.localeCompare(right)),
    );
    // Somebody removed from the list is not asked again; somebody added is.
    expect(await approversOf(second)).not.toContain(APPROVER);
  });

  /**
   * And the person taken off the list can still answer the approval they were already asked.
   *
   * This is what makes the snapshot honest rather than merely stale. They *were* asked — the
   * timeline says so — and a module that refused their decision because a list changed afterwards
   * would have stranded an approval on somebody who no longer exists to it.
   */
  it('lets a removed member decide the approval that already asked them', async () => {
    const groupId = await live.aList([APPROVER, DEPUTY]);
    const definitionId = await live.aProcess([
      { ordinal: 1, approverGroupId: groupId, branchRule: 'unanimous' },
    ]);
    const instanceId = await live.start(definitionId, 'requisition-departing');
    const removed = (await membersOf(groupId)).find(
      (member) => member.membershipId === APPROVER,
    )?.approvalGroupMemberId;

    await live.send({
      commandName: 'workflow.remove-group-member',
      approvalGroupMemberId: removed ?? '',
    });

    expect(await live.decide(instanceId, APPROVER, 'approved')).toMatchObject({ ok: true });
    expect(await live.decide(instanceId, DEPUTY, 'approved')).toMatchObject({ ok: true });

    const finished = await live.detailOf(instanceId);

    expect(finished.instance.status).toBe('completed');
    expect(finished.tallies[0]).toMatchObject({ assigned: 2, approvals: 2, outcome: 'approved' });
  });

  /**
   * A membership that was never on the list is not asked, whatever the list becomes.
   *
   * The complement of the two tests above: an approval's approvers are the snapshot and nothing
   * else, so somebody added afterwards has no step and no standing to decide one.
   */
  it('refuses a decision from somebody added to the list after the approval started', async () => {
    const groupId = await live.aList([APPROVER, DEPUTY]);
    const definitionId = await live.aProcess([
      { ordinal: 1, approverGroupId: groupId, branchRule: 'unanimous' },
    ]);
    const instanceId = await live.start(definitionId, 'requisition-newcomer');

    await live.send({
      commandName: 'workflow.add-group-member',
      approvalGroupId: groupId,
      membershipId: REQUESTER,
    });

    const refused = await live.attempt(
      { commandName: 'workflow.decide-step', instanceId, decision: 'approved', expectedVersion: 1 },
      REQUESTER,
    );

    expect(refused).toMatchObject({ ok: false });
    expect((await live.detailOf(instanceId)).steps).toHaveLength(2);
  });
});
