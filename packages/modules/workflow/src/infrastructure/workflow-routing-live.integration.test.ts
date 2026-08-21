import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowDefinitionDetailView } from '../contracts/views.js';
import type { PendingApprovalView } from '../contracts/execution-views.js';
import type { Page } from '../application/workflow-ports.js';
import {
  APPROVER,
  CONNECTION,
  REQUESTER,
  SECOND_APPROVER,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { NOW } from './workflow-states.js';
import { liveWorkflow, type LiveWorkflow } from './workflow-live.fixture.js';

/**
 * Phase 16C's two capabilities through the real handlers and the real database — the parity run.
 *
 * Checkpoint 4 asserted every one of these against in-memory maps. What a `Map` cannot show is
 * whether a target survives two `integer` columns and a `varchar(8)`, whether an instant stamped in
 * one transaction is the instant read back through another, or whether a manager resolved to a
 * membership is a row the database will actually hold under the constraint that still enumerates
 * `membership` alone.
 *
 * **PostgreSQL is the authoritative implementation, and this suite is where that is settled.** Where
 * the two stores could disagree, the assertions below are about what the database does. Neither store
 * was changed to make them agree: the in-memory stores hold whole state objects and therefore carried
 * the new fields already, and the columns were added in Checkpoint 3 to match a domain that already
 * existed.
 *
 * **Nothing here resolves a manager.** The reporting line is a double, exactly as Identity's
 * delegation register is, because it is not this module — and the persistence layer holds no import
 * that could reach either.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's live routing suite");

suite('the manager and the target, against the database they will actually meet', () => {
  let fixture: WorkflowFixture;
  let live: LiveWorkflow;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_live_routing_role');
    live = liveWorkflow(fixture);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    live.reportingLine.answers({
      outcome: 'resolved',
      employmentId: '01930000-0000-7000-8000-0000000000f1',
      managerEmploymentId: '01930000-0000-7000-8000-0000000000f2',
      managerMembershipId: SECOND_APPROVER,
    });
  });

  describe('a manager step', () => {
    it('is configured, published and started, and asks the reporting line once', async () => {
      const definitionId = await live.aProcess([{ ordinal: 1, approverKind: 'manager' }]);
      const instanceId = await live.start(definitionId, 'requisition-1');
      const detail = await live.detailOf(instanceId);
      const [step] = detail.steps;

      expect(live.reportingLine.asked).toStrictEqual([
        { membershipId: REQUESTER, asOfDate: '2026-08-14' },
      ]);
      expect(step?.approverKind).toBe('membership');
      expect(step?.approverMembershipId).toBe(SECOND_APPROVER);
      expect(step?.status).toBe('awaiting');
    });

    it('publishes a manager template carrying no approver identifier', async () => {
      const definitionId = await live.aProcess([{ ordinal: 1, approverKind: 'manager' }]);
      const read = await live.ask<WorkflowDefinitionDetailView>({
        queryName: 'workflow.read-definition',
        definitionId,
      });
      const [template] = read.publishedSteps ?? [];

      expect(template?.approverKind).toBe('manager');
      expect(template?.approverMembershipId).toBeUndefined();
      expect(template?.approverGroupId).toBeUndefined();
    });

    it('puts the resolved manager on their own queue and the manager decides it', async () => {
      const definitionId = await live.aProcess([{ ordinal: 1, approverKind: 'manager' }]);
      const instanceId = await live.start(definitionId, 'requisition-2');
      const queue = await live.ask<Page<PendingApprovalView>>(
        { queryName: 'workflow.pending-approvals' },
        SECOND_APPROVER,
      );
      const decided = await live.decide(instanceId, SECOND_APPROVER, 'approved');

      expect(queue.total).toBe(1);
      expect(decided.ok).toBe(true);
      expect((await live.detailOf(instanceId)).instance.status).toBe('completed');
    });

    /**
     * The snapshot, end to end.
     *
     * The reporting line is changed after the approval started — a reorganization — and the running
     * approval is read again. It still names the person it was started with, because the answer was
     * copied onto the row and there is nothing on that row to follow a second time.
     */
    it('keeps the manager it started with after the reporting line changes', async () => {
      const definitionId = await live.aProcess([{ ordinal: 1, approverKind: 'manager' }]);
      const instanceId = await live.start(definitionId, 'requisition-3');

      live.reportingLine.answers({
        outcome: 'resolved',
        employmentId: '01930000-0000-7000-8000-0000000000f1',
        managerEmploymentId: '01930000-0000-7000-8000-0000000000f3',
        managerMembershipId: APPROVER,
      });

      const detail = await live.detailOf(instanceId);

      expect(detail.steps[0]?.approverMembershipId).toBe(SECOND_APPROVER);
      // And a *new* approval against the same process gets the new manager, so the fixture really
      // did change and the assertion above is about the snapshot rather than about a stale double.
      const second = await live.start(definitionId, 'requisition-4');

      expect((await live.detailOf(second)).steps[0]?.approverMembershipId).toBe(APPROVER);
    });

    it('fails the whole start closed when there is no manager, writing nothing', async () => {
      live.reportingLine.answers({ outcome: 'no-manager' });

      const definitionId = await live.aProcess([
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 2, approverKind: 'manager' },
      ]);
      const refused = await live.attempt(
        {
          commandName: 'workflow.start-instance',
          definitionId,
          subjectType: 'recruitment.requisition',
          subjectId: 'requisition-5',
        },
        REQUESTER,
      );

      expect(refused.ok).toBe(false);

      // No instance, and no queue entry for the first approver — whose step was perfectly resolvable.
      const found = await live.ask<Page<unknown>>({
        queryName: 'workflow.search-instances',
        subjectId: 'requisition-5',
      });
      const queue = await live.ask<Page<PendingApprovalView>>(
        { queryName: 'workflow.pending-approvals' },
        APPROVER,
      );

      expect(found.total).toBe(0);
      expect(queue.total).toBe(0);
    });

    it('keeps a manager-resolved approval out of another tenant', async () => {
      const definitionId = await live.aProcess([{ ordinal: 1, approverKind: 'manager' }]);

      await live.start(definitionId, 'requisition-6');

      const theirs = await live.ask<Page<PendingApprovalView>>(
        { queryName: 'workflow.pending-approvals' },
        SECOND_APPROVER,
        TENANT_B,
      );

      expect(theirs).toStrictEqual({ items: [], total: 0 });
    });
  });

  describe('a service-level target', () => {
    it('survives configuration, publication and the start, unit and all', async () => {
      const definitionId = await live.aProcess([
        { ordinal: 1, approverMembershipId: APPROVER, serviceLevel: { count: 48, unit: 'hours' } },
      ]);
      const read = await live.ask<WorkflowDefinitionDetailView>({
        queryName: 'workflow.read-definition',
        definitionId,
      });
      const instanceId = await live.start(definitionId, 'requisition-7');
      const detail = await live.detailOf(instanceId);

      // Forty-eight hours, not two days — what the administrator typed, back out of the columns.
      expect(read.publishedSteps?.[0]?.serviceLevel).toStrictEqual({ count: 48, unit: 'hours' });
      expect(detail.steps[0]?.serviceLevel).toStrictEqual({
        count: 48,
        unit: 'hours',
        awaitingOn: NOW.toISOString(),
        dueOn: '2026-08-16T09:00:00.000Z',
        state: 'within',
      });
    });

    /**
     * The clock starts when *that step* becomes awaiting, and the database holds the difference.
     *
     * The second step has no instant while nobody is waiting on it, and gains one — a fortnight
     * later, here — when the first is decided. Both halves are read back through the repositories.
     */
    it('starts a later step’s clock when that step opens, not when the approval did', async () => {
      const definitionId = await live.aProcess([
        { ordinal: 1, approverMembershipId: APPROVER },
        {
          ordinal: 2,
          approverMembershipId: SECOND_APPROVER,
          serviceLevel: { count: 1, unit: 'days' },
        },
      ]);
      const instanceId = await live.start(definitionId, 'requisition-8');
      const before = await live.detailOf(instanceId);

      expect(before.steps[1]?.serviceLevel).toStrictEqual({
        count: 1,
        unit: 'days',
        state: 'none',
      });

      await live.decide(instanceId, APPROVER, 'approved');

      const after = await live.detailOf(instanceId);

      expect(after.steps[1]?.serviceLevel).toMatchObject({
        awaitingOn: NOW.toISOString(),
        dueOn: '2026-08-15T09:00:00.000Z',
        state: 'within',
      });
    });

    /** Every step of a parallel branch opens together, and the rows say so to the millisecond. */
    it('gives every step of one branch the same instant', async () => {
      const definitionId = await live.aProcess([
        {
          ordinal: 1,
          approverMembershipId: APPROVER,
          branchRule: 'unanimous',
          serviceLevel: { count: 1, unit: 'days' },
        },
        {
          ordinal: 1,
          approverMembershipId: SECOND_APPROVER,
          branchRule: 'unanimous',
          serviceLevel: { count: 1, unit: 'days' },
        },
      ]);
      const instanceId = await live.start(definitionId, 'requisition-9');
      const detail = await live.detailOf(instanceId);

      expect(detail.steps).toHaveLength(2);
      expect(detail.steps.map((step) => step.serviceLevel?.awaitingOn)).toStrictEqual([
        NOW.toISOString(),
        NOW.toISOString(),
      ]);
    });

    it('carries the target onto the queue row as well as the detail', async () => {
      const definitionId = await live.aProcess([
        { ordinal: 1, approverMembershipId: APPROVER, serviceLevel: { count: 2, unit: 'days' } },
      ]);

      await live.start(definitionId, 'requisition-10');

      const queue = await live.ask<Page<PendingApprovalView>>(
        { queryName: 'workflow.pending-approvals' },
        APPROVER,
      );

      expect(queue.items[0]?.serviceLevel).toMatchObject({
        count: 2,
        unit: 'days',
        awaitingOn: NOW.toISOString(),
        state: 'within',
      });
    });

    it('has no target and no instant on a step nobody configured one for', async () => {
      const definitionId = await live.aProcess([{ ordinal: 1, approverMembershipId: APPROVER }]);
      const instanceId = await live.start(definitionId, 'requisition-11');
      const detail = await live.detailOf(instanceId);

      expect(detail.steps[0]?.serviceLevel).toBeUndefined();
    });

    it('refuses an invalid target before any row is written', async () => {
      const definitionId = await live.aProcess([{ ordinal: 1, approverMembershipId: APPROVER }]);
      const read = await live.ask<WorkflowDefinitionDetailView>({
        queryName: 'workflow.read-definition',
        definitionId,
      });
      const refused = await live.attempt({
        commandName: 'workflow.add-step',
        workflowVersionId: read.versions[0]?.workflowVersionId,
        ordinal: 2,
        name: { en: 'Step', ar: 'خطوة' },
        approverMembershipId: APPROVER,
        serviceLevel: { count: 0, unit: 'hours' },
      });

      expect(refused.ok).toBe(false);
    });

    it('keeps a target inside its own tenant', async () => {
      const definitionId = await live.aProcess(
        [{ ordinal: 1, approverMembershipId: APPROVER, serviceLevel: { count: 2, unit: 'days' } }],
        TENANT_A,
      );

      await live.start(definitionId, 'requisition-12', undefined, TENANT_A);

      const theirs = await live.ask<Page<PendingApprovalView>>(
        { queryName: 'workflow.pending-approvals' },
        APPROVER,
        TENANT_B,
      );

      expect(theirs).toStrictEqual({ items: [], total: 0 });
    });
  });
});
