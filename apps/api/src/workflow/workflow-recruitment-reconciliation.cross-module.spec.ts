import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7, type HandlerFailure, type Result } from '@work/kernel';

import {
  APPROVER,
  CONNECTION,
  TENANT_A,
  applicationConnection,
  harnessFor,
  requireDatabaseInCi,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';
import {
  decidedAlready,
  requisitionDecisions,
  requisitionRow,
  seedRequisition,
  startApproval,
} from './workflow-cross-module-seed.js';

/**
 * An approval arriving at a requisition that has already been decided.
 *
 * Four states and four different answers, and only the first converges. The distinction cannot be
 * drawn from a status — "approved" says what happened and nothing about who caused it — which is why
 * the seam reads the reserved approval identifier and why publishing it was part of what this
 * checkpoint was authorized to change.
 *
 * The window these tests are about is real rather than hypothetical: Recruitment commits in its own
 * transaction before Workflow commits in its, so a failure between the two leaves the module decided
 * and Workflow blank. No outbox closes that window and none is being built; reconciliation on the
 * retry closes it, and the first test here is that retry.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow–Recruitment reconciliation suite');

suite('an approval arriving at a decided requisition', () => {
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

  const awaiting = async (): Promise<{
    readonly requisitionId: string;
    readonly instanceId: string;
  }> => {
    const seeded = await seedRequisition(harness, TENANT_A);
    const started = await startApproval(harness, TENANT_A, {
      subjectId: seeded.requisitionId,
      code: `approval-${seeded.requisitionId.slice(0, 8)}`,
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

  /**
   * **Scenario D — the window a failed Workflow commit leaves, and how it closes.**
   *
   * Recruitment has already committed this exact approval, and Workflow has no record of it: the
   * state left behind when the module's transaction succeeded and Workflow's then failed. The retry
   * finds the requisition carrying *this* approval identifier with *this* outcome, converges, and
   * Workflow records its decision. Recruitment moves once and only once.
   */
  it('converges when the same approval is delivered again after a Workflow-side failure', async () => {
    const { requisitionId, instanceId } = await awaiting();

    // The state a failed Workflow commit leaves: Recruitment decided by this approval, Workflow blank.
    await decidedAlready(harness, TENANT_A, requisitionId, {
      status: 'approved',
      approvalId: instanceId,
    });

    const outcome = await decideAs(APPROVER, instanceId);

    expect(outcome.ok).toBe(true);

    const requisition = await requisitionRow(harness, TENANT_A, requisitionId);

    expect(requisition?.status).toBe('approved');
    expect(requisition?.approval_id).toBe(instanceId);
    // **No second transition.** Recruitment wrote no decision row, because it was never asked to.
    await expect(requisitionDecisions(harness, TENANT_A, requisitionId)).resolves.toEqual([]);
    // Workflow, which had nothing, now has its record.
    await expect(workflowDecisions(instanceId)).resolves.toEqual([{ decision: 'approved' }]);
  });

  /** The same identifier with the opposite outcome is not convergence. It is refused. */
  it('refuses when the same approval is redelivered with the opposite decision', async () => {
    const { requisitionId, instanceId } = await awaiting();

    await decidedAlready(harness, TENANT_A, requisitionId, {
      status: 'rejected',
      approvalId: instanceId,
    });

    const outcome = await decideAs(APPROVER, instanceId, 'approved');

    expect(outcome.ok).toBe(false);
    await expect(requisitionRow(harness, TENANT_A, requisitionId)).resolves.toEqual({
      status: 'rejected',
      approval_id: instanceId,
    });
    await expect(workflowDecisions(instanceId)).resolves.toEqual([]);
  });

  /**
   * **Scenario E — a different approval already decided it.**
   *
   * Refused, and the existing identifier is never overwritten. Rewriting it would change which routed
   * chain the audit says authorized this headcount.
   */
  it('refuses when another approval already decided the requisition', async () => {
    const other = uuidV7();
    const { requisitionId, instanceId } = await awaiting();

    await decidedAlready(harness, TENANT_A, requisitionId, {
      status: 'approved',
      approvalId: other,
    });

    const outcome = await decideAs(APPROVER, instanceId);

    expect(outcome.ok).toBe(false);
    // Untouched, including the identifier that was already there.
    await expect(requisitionRow(harness, TENANT_A, requisitionId)).resolves.toEqual({
      status: 'approved',
      approval_id: other,
    });
    await expect(workflowDecisions(instanceId)).resolves.toEqual([]);
  });

  /**
   * **Scenario F — a person decided it directly, with no approval at all.**
   *
   * Refused, and told apart from Scenario E on purpose: "a routed chain got there first" and "a human
   * decided it in Recruitment" are different answers to whoever investigates, and a status alone
   * cannot distinguish them. Claiming the approval caused this decision would put an authority in the
   * audit trail that did not produce it.
   */
  it('refuses when the requisition was decided outside Workflow', async () => {
    const { requisitionId, instanceId } = await awaiting();

    await decidedAlready(harness, TENANT_A, requisitionId, { status: 'approved' });

    const outcome = await decideAs(APPROVER, instanceId);

    expect(outcome.ok).toBe(false);
    await expect(requisitionRow(harness, TENANT_A, requisitionId)).resolves.toEqual({
      status: 'approved',
      approval_id: null,
    });
    await expect(workflowDecisions(instanceId)).resolves.toEqual([]);
  });
});
