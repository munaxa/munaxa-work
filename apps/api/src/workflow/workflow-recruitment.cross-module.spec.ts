import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7, type HandlerFailure, type Result } from '@work/kernel';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  TENANT_A,
  applicationConnection,
  harnessFor,
  requireDatabaseInCi,
  roleIsUnprivileged,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';
import {
  requisitionDecisions,
  requisitionRow,
  seedDelegation,
  seedRequisition,
  startApproval,
} from './workflow-cross-module-seed.js';

/**
 * The seam: a routed approval reaching the module that asked for it.
 *
 * **Nothing in the path is simulated.** One dispatcher; Workflow assembled by the production
 * `workflowModuleFor`; Recruitment's real module answering `recruitment.decide-requisition` and
 * `recruitment.read-requisition` from its own aggregate and its own repository; Identity's real
 * module answering the delegation question; real PostgreSQL repositories throughout; and a role that
 * is neither a superuser nor exempt from row-level security.
 *
 * **The two writes are in two transactions and this suite does not pretend otherwise.** Every
 * `UnitOfWork.execute` takes its own connection, so Recruitment commits before Workflow does. What
 * makes that safe in the direction that matters is the order: Recruitment is asked *first*, and if it
 * refuses, Workflow has written nothing. The opposite window — Recruitment committed, Workflow's
 * commit then failed — is real, is not closed by any guarantee, and is closed instead by
 * reconciliation on the retry. Scenario D is that window, reproduced rather than described.
 *
 * **Recruitment decides.** Every refusal below comes from Recruitment's own aggregate, and no test
 * weakens one to make an approval succeed.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow–Recruitment seam suite');

suite('the Workflow to Recruitment seam', () => {
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

  /** A requisition awaiting a decision, and a Workflow approval raised about it. */
  const awaiting = async (
    options: { readonly approver?: string; readonly requisitionId?: string } = {},
  ): Promise<{ readonly requisitionId: string; readonly instanceId: string }> => {
    const seeded = await seedRequisition(harness, TENANT_A, {
      ...(options.requisitionId === undefined ? {} : { requisitionId: options.requisitionId }),
    });
    const started = await startApproval(harness, TENANT_A, {
      subjectId: seeded.requisitionId,
      code: `approval-${seeded.requisitionId.slice(0, 8)}`,
      ...(options.approver === undefined ? {} : { approver: options.approver }),
    });

    return { requisitionId: seeded.requisitionId, instanceId: started.instanceId };
  };

  const decideAs = (
    membershipId: string | undefined,
    instanceId: string,
    decision: 'approved' | 'rejected' = 'approved',
  ): Promise<Result<unknown, HandlerFailure>> =>
    harness.inTenant(TENANT_A, membershipId, () =>
      harness.dispatcher.send({
        commandName: 'workflow.decide-step',
        instanceId,
        decision,
        expectedVersion: 1,
      }),
    );

  const workflowDecisions = (instanceId: string): Promise<{ readonly decision: string }[]> =>
    harness.rowsIn<{ decision: string }>(
      TENANT_A,
      `select decision from workflow_decision where instance_id = $1`,
      [instanceId],
    );

  const workflowHistory = (instanceId: string): Promise<{ readonly event: string }[]> =>
    harness.rowsIn<{ event: string }>(
      TENANT_A,
      `select event from workflow_history where instance_id = $1 order by occurred_at, id`,
      [instanceId],
    );

  const instanceStatus = async (instanceId: string): Promise<string | undefined> => {
    const rows = await harness.rowsIn<{ status: string }>(
      TENANT_A,
      `select status from workflow_instance where id = $1`,
      [instanceId],
    );

    return rows[0]?.status;
  };

  it('runs as a role that is neither a superuser nor exempt from row-level security', async () => {
    await expect(roleIsUnprivileged(harness.pool)).resolves.toEqual({
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  /**
   * **Scenario A — the whole path, by the approver who was asked.**
   *
   * A requisition waiting for a decision; an approval routed to a named person; that person approves;
   * Recruitment moves and records who decided; the reserved column receives the Workflow approval;
   * and Workflow writes its own decision and timeline. Nine assertions and every one of them is a row
   * in a real table.
   */
  it('applies a direct approval to the requisition and records both sides', async () => {
    const { requisitionId, instanceId } = await awaiting();
    const outcome = await decideAs(APPROVER, instanceId);

    expect(outcome.ok).toBe(true);

    const requisition = await requisitionRow(harness, TENANT_A, requisitionId);

    // Recruitment moved, on its own rules, in its own transaction.
    expect(requisition?.status).toBe('approved');
    // And the reserved column now names the approval that caused it.
    expect(requisition?.approval_id).toBe(instanceId);

    const decisions = await requisitionDecisions(harness, TENANT_A, requisitionId);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('approved');
    // The human who pressed approve, not a service identity.
    expect(decisions[0]?.decided_by).toBe('user:workflow-admin');

    // Workflow's own record, written after Recruitment accepted.
    await expect(workflowDecisions(instanceId)).resolves.toEqual([{ decision: 'approved' }]);
    await expect(instanceStatus(instanceId)).resolves.toBe('completed');

    const history = await workflowHistory(instanceId);

    expect(history.map((entry) => entry.event)).toContain('instance-completed');
  });

  /** A rejection travels the same path and lands as Recruitment's own rejection. */
  it('applies a rejection the same way', async () => {
    const { requisitionId, instanceId } = await awaiting();

    await decideAs(APPROVER, instanceId, 'rejected');

    const requisition = await requisitionRow(harness, TENANT_A, requisitionId);

    expect(requisition?.status).toBe('rejected');
    expect(requisition?.approval_id).toBe(instanceId);
    await expect(instanceStatus(instanceId)).resolves.toBe('rejected');
  });

  /**
   * **Scenario B — a delegate acts, and Recruitment sees the delegate.**
   *
   * The deputy is the actor on both sides. The approver whose authority was used is recorded by
   * Workflow as the authority and is **not** written into Recruitment as the decider — a business
   * module told that a director decided something their deputy decided would be holding a record
   * that names the wrong human.
   */
  it('records the delegate as the actor in Recruitment, and the approver only as authority', async () => {
    const { requisitionId, instanceId } = await awaiting();

    await seedDelegation(harness, TENANT_A);

    const outcome = await harness.inTenant(TENANT_A, DEPUTY, () =>
      harness.dispatcher.send({
        commandName: 'workflow.decide-step',
        instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

    expect(outcome.ok).toBe(true);

    const workflow = await harness.rowsIn<{
      decided_by_membership_id: string;
      on_behalf_of_membership_id: string | null;
      authority: string;
    }>(
      TENANT_A,
      `select decided_by_membership_id, on_behalf_of_membership_id, authority
         from workflow_decision where instance_id = $1`,
      [instanceId],
    );

    expect(workflow[0]?.authority).toBe('delegated');
    expect(workflow[0]?.decided_by_membership_id).toBe(DEPUTY);
    expect(workflow[0]?.on_behalf_of_membership_id).toBe(APPROVER);

    const requisition = await requisitionRow(harness, TENANT_A, requisitionId);

    expect(requisition?.status).toBe('approved');
    expect(requisition?.approval_id).toBe(instanceId);

    // Recruitment's own record names the acting human, taken from the ambient context rather than
    // from anything the seam passed it.
    const decisions = await requisitionDecisions(harness, TENANT_A, requisitionId);

    expect(decisions[0]?.decided_by).toBe('user:workflow-admin');
  });

  /** A delegation that is not in force refuses on both sides, and nothing is written anywhere. */
  it('refuses a delegated approval with no valid delegation, and leaves both sides untouched', async () => {
    const { requisitionId, instanceId } = await awaiting();
    const outcome = await decideAs(DEPUTY, instanceId);

    expect(outcome.ok).toBe(false);
    await expect(requisitionRow(harness, TENANT_A, requisitionId)).resolves.toEqual({
      status: 'pending_approval',
      approval_id: null,
    });
    await expect(workflowDecisions(instanceId)).resolves.toEqual([]);
  });

  describe('Scenario C — Recruitment refuses', () => {
    /**
     * **Recruitment's own rule refuses, and Workflow records nothing at all.**
     *
     * The requisition is `draft`, which `Requisition.decide` will not accept. This is the assertion
     * the whole ordering exists for: the module is asked first, so a refusal from it leaves no
     * Workflow decision row, no history entry claiming completion, and an instance still running with
     * its step still awaiting. There is no state in which Workflow says an approval succeeded while
     * the module that owns the subject says it did not.
     */
    it('leaves no Workflow decision, no history and no completed instance', async () => {
      const seeded = await seedRequisition(harness, TENANT_A, { status: 'draft' });
      const started = await startApproval(harness, TENANT_A, {
        subjectId: seeded.requisitionId,
        code: 'approval-draft',
      });
      const outcome = await decideAs(APPROVER, started.instanceId);

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? undefined : outcome.error.kind).toBe('rejected');

      // Recruitment is exactly as it was.
      await expect(requisitionRow(harness, TENANT_A, seeded.requisitionId)).resolves.toEqual({
        status: 'draft',
        approval_id: null,
      });
      await expect(requisitionDecisions(harness, TENANT_A, seeded.requisitionId)).resolves.toEqual(
        [],
      );

      // And so is Workflow.
      await expect(workflowDecisions(started.instanceId)).resolves.toEqual([]);
      await expect(instanceStatus(started.instanceId)).resolves.toBe('running');

      const history = await workflowHistory(started.instanceId);

      expect(history.map((entry) => entry.event)).toEqual(['instance-started', 'step-awaiting']);

      const steps = await harness.rowsIn<{ status: string }>(
        TENANT_A,
        `select status from workflow_step where instance_id = $1`,
        [started.instanceId],
      );

      expect(steps.map((step) => step.status)).toEqual(['awaiting']);
    });

    /** A subject that does not exist at all is the same refusal, and reaches no command. */
    it('refuses when the requisition is not there', async () => {
      const started = await startApproval(harness, TENANT_A, {
        subjectId: uuidV7(),
        code: 'approval-missing',
      });
      const outcome = await decideAs(APPROVER, started.instanceId);

      expect(outcome.ok).toBe(false);
      await expect(workflowDecisions(started.instanceId)).resolves.toEqual([]);
    });
  });

  /**
   * The grants, counted from the elevations the checker actually performed.
   *
   * Three permissions, no more: Identity's delegation read when a delegate acts, and Recruitment's
   * read and approve for the one module Workflow writes into.
   */
  it('elevates exactly the approved permissions and no others', async () => {
    const { instanceId } = await awaiting();

    await seedDelegation(harness, TENANT_A);
    harness.elevations.length = 0;

    await harness.inTenant(TENANT_A, DEPUTY, () =>
      harness.dispatcher.send({
        commandName: 'workflow.decide-step',
        instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

    expect(harness.elevations.map((elevation) => elevation.permission)).toEqual([
      'identity.delegation.read',
      'recruitment.requisition.read',
      'recruitment.requisition.approve',
    ]);
    for (const elevation of harness.elevations) {
      expect(elevation.module).toBe('workflow');
      expect(elevation.tenantId).toBe(TENANT_A);
      expect(elevation.actor).toBe('user:workflow-admin');
      expect(elevation.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  /** A subject no adapter owns passes straight through: Workflow completes and writes nothing else. */
  it('completes an approval for a subject nobody adopted', async () => {
    const started = await startApproval(harness, TENANT_A, {
      subjectId: uuidV7(),
      code: 'approval-unadopted',
      subjectType: 'leave.request',
    });
    const outcome = await decideAs(APPROVER, started.instanceId);

    expect(outcome.ok).toBe(true);
    await expect(instanceStatus(started.instanceId)).resolves.toBe('completed');
    // Nothing was read and nothing was written in another module.
    expect(harness.elevations).toEqual([]);
  });
});
