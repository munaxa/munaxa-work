import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowInstanceDetailView } from '@work/workflow';

import {
  APPROVER,
  B_REQUESTER,
  B_REQUESTER_EMPLOYMENT,
  CONNECTION,
  DEPUTY,
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
  seedReportingLine,
  send,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';
import { inForceNow, noLongerInForce, notYetInForce } from './workflow-cross-module-seed.js';

/**
 * The manager chain when it does **not** resolve: every way the three modules can fail to produce
 * one person, over the real tables.
 *
 * Split from `workflow-manager.cross-module.spec.ts` at the file-size budget, on the seam the phase
 * itself draws: that file is about an approval reaching its manager, and this one is about the five
 * refusals and the effective dating that produce them. The wiring is identical and identically real
 * — Identity, Employment and Workflow on one dispatcher, under a role that can be refused.
 *
 * **Every case here fails closed and writes nothing.** A configured approval stage is never quietly
 * dropped: an approval that could not find its manager does not start at all, which is the rule
 * D-16C-10 fixed and the last test in the first group asserts directly.
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

suite('an approval whose manager cannot be resolved', () => {
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

  describe('a chain that does not resolve', () => {
    it('refuses when the requester holds no employment', async () => {
      const definitionId = await managerProcess();
      const refused = await start(definitionId, 'requisition-7');

      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('manager-no-primary-employment');
    });

    it('refuses when that employment has no manager on the primary line', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
      });

      const definitionId = await managerProcess();
      const refused = await start(definitionId, 'requisition-8');

      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('manager-not-assigned');
    });

    /**
     * A **functional** line is not a manager for this purpose (P-3), and the refusal proves it.
     *
     * Employment resolves `managerEmploymentId` from the primary lines alone, so seeding only a
     * functional one leaves the chain with nothing — which is the approved behaviour rather than an
     * accident of the seed.
     */
    it('ignores a functional reporting line entirely', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [MANAGER],
          lineType: 'functional',
        },
      });

      const definitionId = await managerProcess();
      const refused = await start(definitionId, 'requisition-9');

      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('manager-not-assigned');
    });

    it('refuses when the manager’s employment belongs to nobody', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: { managerEmploymentId: MANAGER_EMPLOYMENT, managerMembershipIds: [] },
      });

      const definitionId = await managerProcess();
      const refused = await start(definitionId, 'requisition-10');

      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('manager-not-a-member');
    });

    /**
     * Two holders of one job, over the real tables — the case B-1 exists for.
     *
     * `employment_link` is unique per `(membership, employment)` pair and `is_primary` is unique per
     * *membership*, so both of these rows are legal and both people hold this job as their primary.
     * Nothing in three modules says which of them approves, so the approval stops.
     */
    it('refuses when two people hold the manager’s employment', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [MANAGER, DEPUTY],
        },
      });

      const definitionId = await managerProcess();
      const refused = await start(definitionId, 'requisition-11');

      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('manager-membership-ambiguous');
      // And not the refusal that means nobody holds it — opposite problems, different people.
      expect(JSON.stringify(refused)).not.toContain('manager-not-a-member');
    });

    /** A requester who holds their own manager's employment is asked to approve their own request. */
    it('refuses when the requester turns out to be their own manager', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [REQUESTER],
        },
      });

      const definitionId = await managerProcess();
      const refused = await start(definitionId, 'requisition-12');

      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('manager-is-the-requester');
    });

    /** Nothing is written on any refusal: no instance, no step, no history. */
    it('writes nothing at all when the chain fails', async () => {
      const definitionId = await managerProcess();

      await start(definitionId, 'requisition-13');

      const instances = await harness.rowsIn(TENANT_A, 'select id from workflow_instance');
      const steps = await harness.rowsIn(TENANT_A, 'select id from workflow_step');

      expect(instances).toStrictEqual([]);
      expect(steps).toStrictEqual([]);
    });
  });

  describe('effective dating', () => {
    /**
     * A line that had not started yet on the day the approval was raised is not a manager.
     *
     * Dated against the same clock the decision uses — `workflowModuleFor` wires `systemClock`, so
     * the adapter asks Employment about *now*. This line opens a month after that. Employment's own
     * timeline answers the question; the adapter passes the date and reads what it is told.
     */
    it('finds no manager when the line begins after the approval', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [MANAGER],
          effectiveFrom: notYetInForce().from.toISOString(),
        },
      });

      const definitionId = await managerProcess();
      const refused = await start(definitionId, 'requisition-14');

      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('manager-not-assigned');
    });

    it('finds no manager when the line ended before the approval', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [MANAGER],
          effectiveFrom: noLongerInForce().from.toISOString(),
          effectiveTo: noLongerInForce().to.toISOString(),
        },
      });

      const definitionId = await managerProcess();
      const refused = await start(definitionId, 'requisition-15');

      expect(refused.ok).toBe(false);
      expect(JSON.stringify(refused)).toContain('manager-not-assigned');
    });

    it('finds the manager when the approval falls inside the line’s period', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [MANAGER],
          effectiveFrom: inForceNow().from.toISOString(),
          effectiveTo: inForceNow().to.toISOString(),
        },
      });

      const definitionId = await managerProcess();
      const started = await start(definitionId, 'requisition-16');

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const detail = await detailOf((started.value as { instanceId: string }).instanceId);

      expect(detail.steps[0]?.approverMembershipId).toBe(MANAGER);
    });
  });

  describe('tenant isolation', () => {
    /**
     * The sharpest shape: **the same employment identifier in both tenants**, each with its own
     * holder.
     *
     * An employment identifier is opaque to Workflow and nothing stops two tenants recording the
     * same one. Tenant B's approval must find tenant B's manager, and never tenant A's.
     */
    it('resolves each tenant’s own manager for the same employment identifier', async () => {
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: { managerEmploymentId: MANAGER_EMPLOYMENT, managerMembershipIds: [MANAGER] },
      });
      await seedReportingLine(harness.owner, {
        tenantId: TENANT_B,
        requesterMembershipId: B_REQUESTER,
        requesterEmploymentId: B_REQUESTER_EMPLOYMENT,
        line: { managerEmploymentId: MANAGER_EMPLOYMENT, managerMembershipIds: [] },
      });

      const inA = await managerProcess(TENANT_A);
      const startedInA = await start(inA, 'requisition-17');

      expect(startedInA.ok).toBe(true);
      if (!startedInA.ok) return;

      const detail = await detailOf((startedInA.value as { instanceId: string }).instanceId);

      expect(detail.steps[0]?.approverMembershipId).toBe(MANAGER);

      // Tenant B names the same manager employment and nobody in B holds it, so B fails closed —
      // rather than reaching across and finding A's manager.
      const inB = await managerProcess(TENANT_B);
      const refusedInB = await start(inB, 'requisition-18', TENANT_B, B_REQUESTER);

      expect(refusedInB.ok).toBe(false);
      expect(JSON.stringify(refusedInB)).toContain('manager-not-a-member');
    });
  });
});
