import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PendingApprovalView, WorkflowInstanceDetailView } from '@work/workflow';

import {
  APPROVER,
  B_REQUESTER,
  CONNECTION,
  MANAGER,
  MANAGER_EMPLOYMENT,
  REQUESTER,
  REQUESTER_EMPLOYMENT,
  UNADOPTED,
  TENANT_A,
  TENANT_B,
  applicationConnection,
  ask,
  attempt,
  harnessFor,
  requireDatabaseInCi,
  roleIsUnprivileged,
  seedReportingLine,
  send,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';

/**
 * The manager chain end to end: three modules, three real tables, one dispatcher, no fakes.
 *
 * **Nothing on the path is a stub.** Identity answers `identity.primary-employment-for-membership`
 * and `identity.active-memberships-for-employment` from `employment_link` and `tenant_membership`;
 * Employment answers `employment.read-employment` from `employment_reporting_line`, resolving the
 * primary line in force on the date through its own timeline; Workflow is composed by
 * `workflowModuleFor`, the production function, so the port under test is the one that ships. The
 * only doubles are Employment's own person and organization ports, neither of which this path
 * touches.
 *
 * **The role is unprivileged**, asserted before any isolation result is believed. Every query in
 * this file crosses two module boundaries under row-level security that can actually refuse.
 *
 * **The subject type is the unadopted one**, deliberately. Routing to a manager and delivering a
 * terminal decision to an adopting module are two different seams, and the second has its own
 * suites; using a requisition here would make every decision in this file depend on Recruitment
 * having a matching row, which is not what any of it is about.
 *
 * What the adapter's own spec cannot show and this one does: that the three published contracts
 * genuinely compose — that Identity's `employmentId` is the one Employment recognizes, that
 * Employment's `managerEmploymentId` is the one Identity can resolve back to a person, and that the
 * approval which comes out names that person.
 */

requireDatabaseInCi('the Workflow manager cross-module suite');

const suite = CONNECTION === undefined ? describe.skip : describe;

suite('routing an approval to the requester’s manager', () => {
  let harness: WorkflowCrossModuleHarness;

  beforeAll(async () => {
    harness = harnessFor({ connectionString: await applicationConnection() });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  /**
   * The role every assertion below runs through, checked before any of them is believed.
   *
   * A superuser bypasses every row-level security policy there is, so a suite connected as one would
   * report that isolation holds without ever having given a policy the chance to refuse.
   */
  it('runs as a role that is neither a superuser nor exempt from row-level security', async () => {
    await expect(roleIsUnprivileged(harness.pool)).resolves.toStrictEqual({
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  /** A published process whose only step asks the requester's manager. */
  const managerProcess = async (tenantId = TENANT_A): Promise<string> => {
    const definition = await harness.inTenant(tenantId, APPROVER, () =>
      send<{ definitionId: string }>(harness, {
        commandName: 'workflow.create-definition',
        code: `manager-${tenantId.slice(-4)}`,
        name: { en: 'Manager approval', ar: 'اعتماد المدير' },
        subjectType: UNADOPTED,
      }),
    );
    const version = await harness.inTenant(tenantId, APPROVER, () =>
      send<{ workflowVersionId: string }>(harness, {
        commandName: 'workflow.draft-version',
        definitionId: definition.definitionId,
      }),
    );

    await harness.inTenant(tenantId, APPROVER, async () => {
      await send(harness, {
        commandName: 'workflow.add-step',
        workflowVersionId: version.workflowVersionId,
        ordinal: 1,
        name: { en: 'Manager', ar: 'المدير' },
        approverKind: 'manager',
      });
      await send(harness, {
        commandName: 'workflow.publish-version',
        workflowVersionId: version.workflowVersionId,
        expectedVersion: 1,
      });
    });

    return definition.definitionId;
  };

  const start = (definitionId: string, subjectId: string, tenantId = TENANT_A, as = REQUESTER) =>
    harness.inTenant(tenantId, as, () =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId,
        subjectType: UNADOPTED,
        subjectId,
      }),
    );

  const detailOf = (instanceId: string, tenantId = TENANT_A) =>
    harness.inTenant(tenantId, APPROVER, () =>
      ask<WorkflowInstanceDetailView>(harness, {
        queryName: 'workflow.read-instance',
        instanceId,
      }),
    );

  describe('a chain that resolves', () => {
    beforeEach(async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [MANAGER],
        },
      });
    });

    it('asks the manager, as an ordinary membership step', async () => {
      const definitionId = await managerProcess();
      const started = await start(definitionId, 'requisition-1');

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const detail = await detailOf((started.value as { instanceId: string }).instanceId);
      const [step] = detail.steps;

      expect(step?.approverMembershipId).toBe(MANAGER);
      expect(step?.approverKind).toBe('membership');
      expect(step?.status).toBe('awaiting');
    });

    it('puts the approval on the manager’s own queue and lets them decide it', async () => {
      const definitionId = await managerProcess();
      const started = await start(definitionId, 'requisition-2');

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const instanceId = (started.value as { instanceId: string }).instanceId;
      const queue = await harness.inTenant(TENANT_A, MANAGER, () =>
        ask<{ readonly items: readonly PendingApprovalView[]; readonly total: number }>(harness, {
          queryName: 'workflow.pending-approvals',
        }),
      );
      const decided = await harness.inTenant(TENANT_A, MANAGER, () =>
        attempt(harness, {
          commandName: 'workflow.decide-step',
          instanceId,
          decision: 'approved',
          expectedVersion: 1,
        }),
      );

      expect(queue.total).toBe(1);
      expect(decided.ok).toBe(true);
      expect((await detailOf(instanceId)).instance.status).toBe('completed');
    });

    /**
     * The snapshot, across all three modules.
     *
     * The reporting line is moved to somebody else **after** the approval started — the
     * reorganization D-16C-08 is about — and the running step still names the person it was started
     * with. Not because Workflow defends it, but because the answer was copied onto the row and
     * there is nothing on that row to follow a second time.
     */
    it('keeps the manager it started with when the reporting line moves afterwards', async () => {
      const definitionId = await managerProcess();
      const started = await start(definitionId, 'requisition-3');

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const instanceId = (started.value as { instanceId: string }).instanceId;

      // The whole line is replaced: this employment now reports to the approver instead.
      await harness.owner.query('delete from employment_reporting_line where tenant_id = $1', [
        TENANT_A,
      ]);
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [APPROVER],
        },
      });

      expect((await detailOf(instanceId)).steps[0]?.approverMembershipId).toBe(MANAGER);
    });

    /** And a membership change afterwards does not reach a running approval either. */
    it('keeps the manager it started with when their membership ends afterwards', async () => {
      const definitionId = await managerProcess();
      const started = await start(definitionId, 'requisition-4');

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      await harness.owner.query(`update tenant_membership set status = 'ended' where id = $1`, [
        MANAGER,
      ]);

      const instanceId = (started.value as { instanceId: string }).instanceId;

      expect((await detailOf(instanceId)).steps[0]?.approverMembershipId).toBe(MANAGER);
    });

    it('resolves nothing again once the approval is running', async () => {
      const definitionId = await managerProcess();
      const started = await start(definitionId, 'requisition-5');

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const before = harness.elevations.length;

      await detailOf((started.value as { instanceId: string }).instanceId);

      // Reading an approval consults neither Identity nor Employment: no grant was entered at all.
      expect(harness.elevations.length).toBe(before);
    });

    /** Tenant B's identifiers are the same shape and resolve to nothing here. */
    it('does not resolve a manager across a tenant boundary', async () => {
      const definitionId = await managerProcess(TENANT_B);
      const refused = await start(definitionId, 'requisition-6', TENANT_B, B_REQUESTER);

      expect(refused.ok).toBe(false);
    });
  });
});
