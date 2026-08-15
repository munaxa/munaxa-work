import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HandlerFailure, Query, Result } from '@work/kernel';

import {
  APPROVER,
  B_APPROVER,
  B_DEPUTY,
  CONNECTION,
  DEPUTY,
  TENANT_A,
  TENANT_B,
  applicationConnection,
  harnessFor,
  requireDatabaseInCi,
  type WorkflowCrossModuleHarness,
  UNADOPTED,
} from './workflow-cross-module-harness.js';
import { seedDelegation, startApproval } from './workflow-cross-module-seed.js';

/**
 * Two tenants, and a dependency that is not there.
 *
 * The suite beside this one proves that a delegated approval works end to end. This one proves the
 * two ways it must **not** work: across a tenant boundary, and on a guess when Identity cannot be
 * asked. Both run against the same production composition, on the same unprivileged PostgreSQL role,
 * with Identity's real module answering — or, in the last section, deliberately absent from the
 * dispatcher, which is what a deployment sees when the module that answers is down.
 *
 * A membership belongs to exactly one tenant (`tenant_membership` is keyed on tenant and workforce
 * user), so "the same deputy in both tenants" cannot exist. That makes the crossing test sharper
 * rather than weaker: Workflow stores an approver as an **opaque value with no foreign key** to
 * Identity (ADR-0042), so an approval in tenant A can name tenant B's approver — and tenant B's
 * deputy, who genuinely holds a delegation from that approver in tenant B, can then try to use it in
 * tenant A. If Identity's answer ever crossed a tenant, that is the request that would succeed.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow cross-module tenancy suite');

/** A query a suite sends, typed so the compiler still insists on the field that names it. */
type SentQuery = Query & Record<string, unknown>;

suite('workflow across tenants', () => {
  let harness: WorkflowCrossModuleHarness;

  beforeAll(async () => {
    harness = harnessFor({ connectionString: await applicationConnection() });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
    harness.elevations.length = 0;
  });

  const approvalIn = (
    tenantId: string,
    subjectId = 'requisition-1',
  ): Promise<{ instanceId: string }> =>
    startApproval(harness, tenantId, {
      subjectId,
      code: `approval-${subjectId}`,
      subjectType: UNADOPTED,
    });

  const decideAs = (
    tenantId: string,
    membershipId: string | undefined,
    instanceId: string,
  ): Promise<Result<unknown, HandlerFailure>> =>
    harness.inTenant(tenantId, membershipId, () =>
      harness.dispatcher.send({
        commandName: 'workflow.decide-step',
        instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

  const askIn = <TResult>(
    tenantId: string,
    membershipId: string,
    query: SentQuery,
  ): Promise<Result<TResult, HandlerFailure>> =>
    harness.inTenant(tenantId, membershipId, () => harness.dispatcher.ask<TResult>(query));

  const decisionsIn = (tenantId: string, instanceId: string): Promise<Record<string, unknown>[]> =>
    harness.rowsIn(
      tenantId,
      `select decision, decided_by_membership_id, authority, on_behalf_of_membership_id
         from workflow_decision where instance_id = $1`,
      [instanceId],
    );

  describe('tenant isolation', () => {
    /**
     * **A delegation in one tenant is not a delegation in another.**
     *
     * The same two memberships, the same scope, the same period — and the tenant is the only
     * difference. Identity's own policy and its own predicate both refuse it, and Workflow never sees
     * the row.
     */
    it('does not let one tenant’s delegation authorize a decision in another', async () => {
      // An approval in tenant A whose approver is a **tenant B membership**. Workflow stores an
      // approver as an opaque value with no foreign key to Identity (ADR-0042), so this is a state
      // the product can genuinely reach — and it is the sharpest possible test of the boundary.
      const inA = await startApproval(harness, TENANT_A, {
        approver: B_APPROVER,
        subjectId: 'requisition-a',
        code: 'approval-requisition-a',
        subjectType: UNADOPTED,
      });
      const inB = await startApproval(harness, TENANT_B, {
        approver: B_APPROVER,
        subjectId: 'requisition-b',
        code: 'approval-requisition-b',
        subjectType: UNADOPTED,
      });

      // The delegation is real, current, correctly scoped — and it exists only in tenant B.
      await seedDelegation(harness, TENANT_B, { delegator: B_APPROVER, delegate: B_DEPUTY });

      const crossed = await decideAs(TENANT_A, B_DEPUTY, inA.instanceId);

      expect(crossed.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, inA.instanceId)).resolves.toEqual([]);

      // And the same deputy, in the tenant the delegation actually belongs to, may decide — which is
      // what makes the refusal above a boundary rather than a broken fixture.
      const proper = await decideAs(TENANT_B, B_DEPUTY, inB.instanceId);

      expect(proper.ok).toBe(true);
    });

    it('keeps each tenant’s approvals and decisions to itself', async () => {
      const inA = await approvalIn(TENANT_A, 'requisition-a');
      const inB = await startApproval(harness, TENANT_B, {
        approver: B_APPROVER,
        subjectId: 'requisition-b',
        code: 'approval-requisition-b',
        subjectType: UNADOPTED,
      });

      await decideAs(TENANT_A, APPROVER, inA.instanceId);

      const seenFromB = await harness.rowsIn<{ total: string }>(
        TENANT_B,
        `select count(*)::text as total from workflow_decision`,
      );
      const otherInstance = await harness.rowsIn<{ id: string }>(
        TENANT_B,
        `select id from workflow_instance where id = $1`,
        [inA.instanceId],
      );

      expect(seenFromB[0]?.total).toBe('0');
      expect(otherInstance).toEqual([]);
      expect(inB.instanceId).not.toBe(inA.instanceId);
    });

    /** A total is a disclosure too: the administrator's list counts one tenant's approvals. */
    it('counts only the acting tenant’s approvals in a search total', async () => {
      await approvalIn(TENANT_A, 'requisition-a');
      await startApproval(harness, TENANT_B, {
        approver: B_APPROVER,
        subjectId: 'requisition-b',
        code: 'approval-requisition-b',
        subjectType: UNADOPTED,
      });

      const page = await askIn<{ total: number }>(TENANT_A, APPROVER, {
        queryName: 'workflow.search-instances',
        page: 1,
        size: 50,
      });

      expect(page.ok && page.value.total).toBe(1);
    });

    /** And the queue, which is the read an approver's screen makes. */
    it('serves an approver only the steps of the tenant they are acting in', async () => {
      await approvalIn(TENANT_A, 'requisition-a');
      await startApproval(harness, TENANT_B, {
        approver: B_APPROVER,
        subjectId: 'requisition-b',
        code: 'approval-requisition-b',
        subjectType: UNADOPTED,
      });

      const queue = await askIn<{ total: number }>(TENANT_B, B_APPROVER, {
        queryName: 'workflow.pending-approvals',
        page: 1,
        size: 50,
      });

      expect(queue.ok && queue.value.total).toBe(1);
    });
  });

  /**
   * **When Identity is not there at all.**
   *
   * The same production composition, with the module that answers `identity.active-delegations-for`
   * missing from the dispatcher — a deployment where the dependency is down, in the shape the
   * dispatcher actually produces it. The decision is refused and **nothing is written**.
   *
   * The refusal is loud rather than quiet, and deliberately so: turning an unreachable Identity into
   * an empty list would tell a deputy who genuinely holds a delegation that the step was not
   * assigned to them, with nothing anywhere recording that a dependency was unavailable. What must
   * never happen — and does not — is the other direction: an approval recorded because Identity
   * could not be asked.
   */
  describe('when Identity is unavailable', () => {
    let deaf: WorkflowCrossModuleHarness;

    beforeAll(async () => {
      deaf = harnessFor({
        connectionString: await applicationConnection(),
        withoutIdentity: true,
      });
    });

    afterAll(async () => {
      await deaf.close();
    });

    it('refuses the delegated decision and records nothing', async () => {
      await deaf.truncate();

      const started = await startApproval(deaf, TENANT_A, {
        subjectId: 'requisition-deaf',
        code: 'approval-requisition-deaf',
        subjectType: UNADOPTED,
      });

      await seedDelegation(deaf, TENANT_A);

      const outcome = await deaf
        .inTenant(TENANT_A, DEPUTY, () =>
          deaf.dispatcher.send({
            commandName: 'workflow.decide-step',
            instanceId: started.instanceId,
            decision: 'approved',
            expectedVersion: 1,
          }),
        )
        .then((result) => ({ raised: false, result }))
        .catch(() => ({ raised: true, result: undefined }));

      // Raised, not quietly refused: an unavailable dependency is a fault, and the deputy who
      // genuinely holds a delegation is not told their step belongs to somebody else.
      expect(outcome.raised).toBe(true);

      const decisions = await deaf.rowsIn<{ id: string }>(
        TENANT_A,
        `select id from workflow_decision where instance_id = $1`,
        [started.instanceId],
      );
      const steps = await deaf.rowsIn<{ status: string }>(
        TENANT_A,
        `select status from workflow_step where instance_id = $1`,
        [started.instanceId],
      );

      expect(decisions).toEqual([]);
      // The step is still waiting for a decision: the transaction rolled back whole.
      expect(steps.map((step) => step.status)).toEqual(['awaiting']);
    });

    /** And the assigned approver is unaffected: their decision never asks Identity anything. */
    it('still lets the assigned approver decide their own step', async () => {
      await deaf.truncate();

      const started = await startApproval(deaf, TENANT_A, {
        subjectId: 'requisition-own',
        code: 'approval-requisition-own',
        subjectType: UNADOPTED,
      });
      const outcome = await deaf.inTenant(TENANT_A, APPROVER, () =>
        deaf.dispatcher.send({
          commandName: 'workflow.decide-step',
          instanceId: started.instanceId,
          decision: 'approved',
          expectedVersion: 1,
        }),
      );

      expect(outcome.ok).toBe(true);
    });
  });
});
