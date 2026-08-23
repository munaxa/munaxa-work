import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ApprovalGroupDetailView } from '../contracts/views.js';
import type { WorkflowHistoryView } from '../contracts/execution-views.js';
import type { Page } from '../application/workflow-ports.js';
import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { NOW } from './workflow-states.js';
import { liveWorkflow, type LiveWorkflow } from './workflow-live.fixture.js';

/**
 * The whole of Phase 16B, through the real handlers and the real database.
 *
 * Every layer below the API is here and none of it is a double: the real commands and queries, the
 * real domain, the real `PostgresUnitOfWork`, and the PostgreSQL repositories the composition root
 * assembles. The only substitutes are the two things that are not this module — Identity's delegation
 * register, and the module that asked for the approval.
 *
 * **This is the suite that would have caught the Checkpoint 4 stub.** The application layer was
 * complete a checkpoint before its group store existed, and every application test passed against
 * in-memory maps. What those cannot show is whether a group survives real columns, whether a snapshot
 * taken through one transaction is the snapshot read back through another, and whether a branch of
 * three people awaiting at once is a state the database will actually hold.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's live application suite");

suite('the application, against the database it will actually meet', () => {
  let fixture: WorkflowFixture;
  let live: LiveWorkflow;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_live_role');
    live = liveWorkflow(fixture);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const { aList, aProcess, ask, attempt, decide, detailOf, send, start } = {
    aList: (members: readonly string[], tenantId?: string) => live.aList(members, tenantId),
    aProcess: (steps: Parameters<LiveWorkflow['aProcess']>[0], tenantId?: string) =>
      live.aProcess(steps, tenantId),
    ask: <TResult>(query: Record<string, unknown>, membershipId?: string, tenantId?: string) =>
      live.ask<TResult>(query, membershipId, tenantId),
    attempt: (command: Record<string, unknown>, membershipId?: string, tenantId?: string) =>
      live.attempt(command, membershipId, tenantId),
    decide: (instanceId: string, membershipId: string, decision: 'approved' | 'rejected') =>
      live.decide(instanceId, membershipId, decision),
    detailOf: (instanceId: string) => live.detailOf(instanceId),
    send: <TResult>(command: Record<string, unknown>, membershipId?: string, tenantId?: string) =>
      live.send<TResult>(command, membershipId, tenantId),
    start: (
      definitionId: string,
      subjectId: string,
      context?: Record<string, unknown>,
      tenantId?: string,
    ) => live.start(definitionId, subjectId, context, tenantId),
  };

  describe('a group, expanded into an approval and then edited underneath it', () => {
    it('carries a list through the whole of an approval, and ignores every later edit', async () => {
      const groupId = await aList([APPROVER, SECOND_APPROVER, DEPUTY]);
      const definitionId = await aProcess([
        { ordinal: 1, approverGroupId: groupId, branchRule: 'majority' },
      ]);
      const instanceId = await start(definitionId, 'requisition-live');
      const opened = await detailOf(instanceId);

      // Three steps from one template, each naming a person and remembering the list.
      expect(opened.steps).toHaveLength(3);
      expect(opened.awaitingSteps).toHaveLength(3);
      expect(opened.steps.every((step) => step.sourceGroupId === groupId)).toBe(true);
      expect(opened.steps.every((step) => step.approverKind === 'membership')).toBe(true);
      expect(opened.tallies[0]).toMatchObject({ assigned: 3, threshold: 2, outcome: 'awaiting' });

      // The list is emptied *after* the approval started — a different transaction, a real delete.
      const list = await ask<ApprovalGroupDetailView>({
        queryName: 'workflow.read-approval-group',
        approvalGroupId: groupId,
      });

      for (const member of list.members) {
        await send({
          commandName: 'workflow.remove-group-member',
          approvalGroupMemberId: member.approvalGroupMemberId,
        });
      }

      const untouched = await detailOf(instanceId);

      expect(untouched.steps).toHaveLength(3);
      expect(untouched.tallies[0]?.assigned).toBe(3);

      // Two of the three snapshotted approvers still decide it, and the majority is of three.
      expect(await decide(instanceId, APPROVER, 'approved')).toMatchObject({ ok: true });
      expect(await decide(instanceId, SECOND_APPROVER, 'approved')).toMatchObject({ ok: true });

      const finished = await detailOf(instanceId);

      expect(finished.instance.status).toBe('completed');
      expect(finished.tallies[0]).toMatchObject({ approvals: 2, outcome: 'approved' });
      expect(finished.steps.filter((step) => step.status === 'skipped')).toHaveLength(1);
      expect(finished.decisions).toHaveLength(2);
    });

    it('refuses to start from a list nobody is on', async () => {
      const groupId = await aList([]);
      const definitionId = await aProcess([{ ordinal: 1, approverGroupId: groupId }]);
      const refused = await attempt(
        {
          commandName: 'workflow.start-instance',
          definitionId,
          subjectType: SUBJECT_TYPE,
          subjectId: 'requisition-empty-live',
        },
        REQUESTER,
      );

      expect(refused).toMatchObject({
        ok: false,
        error: { reason: 'workflow.rejection.branch-group-empty' },
      });

      // Nothing was written: a start that half-succeeded would leave an approval nobody raised.
      const instances = await ask<Page<unknown>>({
        queryName: 'workflow.search-instances',
        subjectId: 'requisition-empty-live',
      });

      expect(instances.total).toBe(0);
    });

    it('refuses to start when the list the version names has been deleted', async () => {
      const groupId = await aList([APPROVER]);
      const definitionId = await aProcess([{ ordinal: 1, approverGroupId: groupId }]);

      // The group's own row goes, through raw SQL: no command removes a group, and the point is
      // what the *start* does when the list is not there rather than how it came not to be.
      await fixture.asTenant(TENANT_A, (client) =>
        client.query(`update workflow_approval_group set deleted_at = now() where id = $1`, [
          groupId,
        ]),
      );

      const refused = await attempt(
        {
          commandName: 'workflow.start-instance',
          definitionId,
          subjectType: SUBJECT_TYPE,
          subjectId: 'requisition-gone-live',
        },
        REQUESTER,
      );

      /**
       * **Refused, and the refusal is the point rather than which of the two it is.**
       *
       * A start reads the members of every list a version names; the list is gone, so it reads
       * none, and the domain refuses a branch nobody is on. It says `branch-group-empty` rather than
       * `branch-group-unresolved` because the application resolves a group *through its members* —
       * an honest limit rather than a wrong answer, and both refusals stop the same approval for the
       * same reason. Telling them apart would need a second read of the groups themselves, which is
       * a port the application does not have.
       *
       * What this test actually pins is the repository: **a store must not hand back the children of
       * a row it hides.** Without the join in `membersOfAll`, the member rows outlive the list and an
       * approval starts from a group that no longer exists, asking the people who used to be on it.
       */
      expect(refused).toMatchObject({
        ok: false,
        error: { reason: 'workflow.rejection.branch-group-empty' },
      });
    });
  });

  describe('a branch, decided by several people', () => {
    it('records one decision per step, opens the next branch and writes the timeline', async () => {
      const definitionId = await aProcess([
        { ordinal: 1, approverMembershipId: APPROVER, branchRule: 'unanimous' },
        { ordinal: 1, approverMembershipId: SECOND_APPROVER, branchRule: 'unanimous' },
        { ordinal: 2, approverMembershipId: DEPUTY },
      ]);
      const instanceId = await start(definitionId, 'requisition-branch-live');

      expect((await detailOf(instanceId)).awaitingSteps).toHaveLength(2);
      await decide(instanceId, APPROVER, 'approved');

      const half = await detailOf(instanceId);

      // One answered, one outstanding, and the denominator did not move.
      expect(half.tallies[0]).toMatchObject({ assigned: 2, approvals: 1, outcome: 'awaiting' });
      expect(half.awaitingSteps).toHaveLength(1);

      await decide(instanceId, SECOND_APPROVER, 'approved');

      const advanced = await detailOf(instanceId);

      expect(advanced.tallies[0]?.outcome).toBe('approved');
      expect(advanced.awaitingSteps.map((step) => step.approverMembershipId)).toStrictEqual([
        DEPUTY,
      ]);

      await decide(instanceId, DEPUTY, 'approved');

      const finished = await detailOf(instanceId);
      const timeline = await ask<Page<WorkflowHistoryView>>({
        queryName: 'workflow.read-history',
        instanceId,
      });
      const events = timeline.items.map((entry) => entry.event);

      expect(finished.instance.status).toBe('completed');
      expect(finished.decisions).toHaveLength(3);
      // Two people asked at once means two `step-awaiting` entries at the start, not one — and the
      // timeline is what tells the second of them they were asked.
      expect(events.filter((event) => event === 'step-awaiting')).toHaveLength(3);
      expect(events.filter((event) => event === 'step-approved')).toHaveLength(3);
      expect(events).toContain('instance-completed');
    });

    it('refuses a second decision on a step somebody already answered', async () => {
      const definitionId = await aProcess([
        { ordinal: 1, approverMembershipId: APPROVER, branchRule: 'unanimous' },
        { ordinal: 1, approverMembershipId: SECOND_APPROVER, branchRule: 'unanimous' },
      ]);
      const instanceId = await start(definitionId, 'requisition-twice-live');

      await decide(instanceId, APPROVER, 'approved');

      // The step left `awaiting` when it was decided, so the same person has nothing to answer —
      // and `workflow_decision_step_idx` stands behind that as the second line.
      expect(await decide(instanceId, APPROVER, 'approved')).toMatchObject({
        ok: false,
        error: { reason: 'workflow.rejection.decision-not-the-assigned-approver' },
      });
      expect((await detailOf(instanceId)).decisions).toHaveLength(1);
    });

    it('takes a delegated decision as one vote for the approver it acts for', async () => {
      const definitionId = await aProcess([
        { ordinal: 1, approverMembershipId: APPROVER, branchRule: 'majority' },
        { ordinal: 1, approverMembershipId: SECOND_APPROVER, branchRule: 'majority' },
        { ordinal: 1, approverMembershipId: REQUESTER, branchRule: 'majority' },
      ]);
      const instanceId = await start(definitionId, 'requisition-delegated-live');

      live.delegation.grant(APPROVER, DEPUTY, {
        from: new Date(NOW.getTime() - 3_600_000),
        to: new Date(NOW.getTime() + 3_600_000),
      });

      expect(await decide(instanceId, DEPUTY, 'approved')).toMatchObject({ ok: true });

      const detail = await detailOf(instanceId);

      // Two memberships on one decision row, and one vote of three.
      expect(detail.tallies[0]).toMatchObject({ assigned: 3, approvals: 1, responses: 1 });
      expect(detail.decisions[0]).toMatchObject({
        decidedByMembershipId: DEPUTY,
        authority: 'delegated',
        onBehalfOfMembershipId: APPROVER,
      });
    });
  });

  describe('a condition, read from the instance’s own context', () => {
    it('skips a branch whose condition does not hold and completes the approval', async () => {
      const definitionId = await aProcess([
        { ordinal: 1, approverMembershipId: APPROVER },
        {
          ordinal: 2,
          approverMembershipId: SECOND_APPROVER,
          condition: [{ key: 'amount', operator: 'greater-than', value: 50_000 }],
        },
      ]);
      const instanceId = await start(definitionId, 'requisition-small-live', { amount: 10_000 });

      await decide(instanceId, APPROVER, 'approved');

      const detail = await detailOf(instanceId);

      expect(detail.instance.status).toBe('completed');
      expect(
        detail.steps.find((step) => step.approverMembershipId === SECOND_APPROVER),
      ).toMatchObject({ status: 'skipped' });
      // The condition is on the step, read back out of `jsonb` exactly as it was configured.
      expect(detail.steps[1]?.condition).toStrictEqual([
        { key: 'amount', operator: 'greater-than', value: 50_000 },
      ]);
    });

    it('refuses a decision when the branch that would follow cannot be evaluated', async () => {
      const definitionId = await aProcess([
        { ordinal: 1, approverMembershipId: APPROVER },
        {
          ordinal: 2,
          approverMembershipId: SECOND_APPROVER,
          condition: [{ key: 'absent', operator: 'equals', value: 'x' }],
        },
      ]);
      const instanceId = await start(definitionId, 'requisition-unevaluable-live', { amount: 1 });
      const refused = await decide(instanceId, APPROVER, 'approved');
      const detail = await detailOf(instanceId);

      expect(refused).toMatchObject({
        ok: false,
        error: { reason: 'workflow.rejection.condition-key-missing' },
      });
      // Fail closed, and the transaction rolled back: no decision, no history, and the approver is
      // still being asked. A refusal that had written half of itself would be worse than the defect.
      expect(detail.decisions).toStrictEqual([]);
      expect(detail.awaitingSteps.map((step) => step.approverMembershipId)).toStrictEqual([
        APPROVER,
      ]);
    });
  });

  describe('two tenants, the same names', () => {
    it('keeps identical group codes, subjects and approvals apart', async () => {
      const mine = await aList([APPROVER], TENANT_A);
      const theirs = await aList([APPROVER], TENANT_B);
      const here = await aProcess([{ ordinal: 1, approverGroupId: mine }], TENANT_A);
      const there = await aProcess([{ ordinal: 1, approverGroupId: theirs }], TENANT_B);
      const ours = await start(here, 'requisition-shared', undefined, TENANT_A);

      await start(there, 'requisition-shared', undefined, TENANT_B);

      // The same subject identifier in both tenants, and neither approval is the other's.
      const seen = await live.as(TENANT_B, APPROVER, () =>
        live.dispatcher.ask({ queryName: 'workflow.read-instance', instanceId: ours } as never),
      );

      expect(seen).toMatchObject({ ok: false, error: { kind: 'not_found' } });

      const groups = await ask<Page<unknown>>(
        { queryName: 'workflow.search-approval-groups' },
        APPROVER,
        TENANT_B,
      );

      expect(groups.total).toBe(1);
    });
  });
});
