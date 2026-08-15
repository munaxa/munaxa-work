import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
  SUBJECT_TYPE,
  TENANT_A,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { get, post, runningApproval } from './workflow-api-scenario.js';

/**
 * The Recruitment seam, reached only the way a person reaches it: by deciding an approval.
 *
 * **There is no route for it and there must never be.** No `workflow/recruitment`, no "apply
 * decision" endpoint, no integration hook. A terminal decision travels to the module that raised the
 * approval inside the approver's own request, through the application's own port — so the way to
 * test the seam over HTTP is to approve something, which is exactly what a director does.
 *
 * The two scenarios here are the ones the wire could otherwise misreport: Recruitment refusing the
 * business transition, and the same approval arriving twice. In both, what the API says must match
 * what actually happened on both sides.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API seam suite');

const AUDIT = `now(), 'user:test', now(), 'user:test', 1`;

suite('the Workflow API and the Recruitment seam', () => {
  let fixture: WorkflowApiFixture;
  let application: INestApplication;
  let sequence = 0;

  beforeAll(async () => {
    fixture = await openWorkflowApi();
    application = await fixture.applicationFor(
      TENANT_A,
      permitting(...ALL_WORKFLOW_PERMISSIONS),
      APPROVER,
    );
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /**
   * A requisition in a stated state, written through Recruitment's own columns and policy.
   *
   * Written rather than commanded because reaching `pending_approval` through Recruitment's commands
   * needs a position, a unit and an employment from three other modules — none of which is what this
   * seam is about. Everything the API then does to it goes through Recruitment's own published
   * contracts and its own aggregate.
   */
  const requisition = async (
    state: { readonly status?: string; readonly approvalId?: string } = {},
  ): Promise<string> => {
    sequence += 1;

    const client = await fixture.pool.connect();

    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);

      const created = await client.query<{ id: string }>(
        `insert into recruitment_requisition
           (tenant_id, requisition_number, status, position_id, unit_id, headcount_requested,
            headcount_filled, reason_code, requested_by_employment_id, approval_id, metadata,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, gen_random_uuid(), gen_random_uuid(), 1, 0, 'growth',
                 gen_random_uuid(), $4, '{}'::jsonb, ${AUDIT}) returning id`,
        [
          TENANT_A,
          `REQ-2026-${String(sequence).padStart(6, '0')}`,
          state.status ?? 'pending_approval',
          state.approvalId ?? null,
        ],
      );

      await client.query('commit');
      return created.rows[0]?.id ?? '';
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  };

  const requisitionRow = async (
    requisitionId: string,
  ): Promise<{ readonly status: string; readonly approval_id: string | null } | undefined> => {
    const rows = await fixture.rowsIn<{ status: string; approval_id: string | null }>(
      TENANT_A,
      `select status, approval_id from recruitment_requisition where id = $1`,
      [requisitionId],
    );

    return rows[0];
  };

  const decisionsFor = (requisitionId: string): Promise<{ readonly decision: string }[]> =>
    fixture.rowsIn<{ decision: string }>(
      TENANT_A,
      `select decision from recruitment_requisition_decision where requisition_id = $1`,
      [requisitionId],
    );

  /**
   * The whole path over HTTP: an approval about a real requisition, approved by the person asked.
   *
   * Workflow completes, Recruitment moves on its own rules and in its own transaction, and the column
   * Recruitment reserved for a routed approval receives the Workflow approval identifier.
   */
  it('applies a decision to the requisition the approval was about', async () => {
    const requisitionId = await requisition();
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: requisitionId,
      subjectType: SUBJECT_TYPE,
    });
    const decided = await post(application, `/approvals/${running.instanceId}/decision`, {
      decision: 'approved',
      expectedVersion: 1,
    });

    expect(decided.status).toBe(201);
    await expect(requisitionRow(requisitionId)).resolves.toEqual({
      status: 'approved',
      approval_id: running.instanceId,
    });
    await expect(decisionsFor(requisitionId)).resolves.toHaveLength(1);

    const instance = await get(application, `/instances/${running.instanceId}`);

    expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('completed');
  });

  /**
   * **Scenario 4 — Recruitment refuses.**
   *
   * The requisition is `draft`, which its own aggregate will not decide. The HTTP response must not
   * report a successful business approval, and — because Recruitment is asked *before* Workflow
   * writes anything — Workflow must have no decision, no completed instance and no timeline entry
   * claiming otherwise.
   */
  it('reports a refusal, and records nothing on either side', async () => {
    const requisitionId = await requisition({ status: 'draft' });
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: requisitionId,
      subjectType: SUBJECT_TYPE,
    });
    const refused = await post(application, `/approvals/${running.instanceId}/decision`, {
      decision: 'approved',
      expectedVersion: 1,
    });

    expect(refused.status).toBe(422);
    expect(refused.body['detail']).toBe('workflow.rejection.subject-refused-the-decision');

    // Recruitment is exactly as it was.
    await expect(requisitionRow(requisitionId)).resolves.toEqual({
      status: 'draft',
      approval_id: null,
    });
    await expect(decisionsFor(requisitionId)).resolves.toEqual([]);

    // And so is Workflow: still running, still awaiting, with nothing recorded.
    const instance = await get(application, `/instances/${running.instanceId}`);

    expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('running');
    expect(
      (instance.body['steps'] as readonly Record<string, unknown>[]).map((step) => step['status']),
    ).toEqual(['awaiting']);

    const history = await get(application, `/instances/${running.instanceId}/history`);

    expect(
      (history.body['items'] as readonly Record<string, unknown>[]).map((entry) => entry['event']),
    ).toEqual(['instance-started', 'step-awaiting']);

    // The step is still on the approver's queue, because nothing was decided.
    const queue = await get(application, '/approvals/pending');

    expect(queue.body['total']).toBe(1);
  });

  /**
   * **Scenario 5 — the same approval delivered twice.**
   *
   * The state a failed Workflow commit leaves: Recruitment already carries this approval, Workflow
   * has no record of it. The retry converges — Recruitment is not asked to move again — and Workflow
   * records its decision. The reconciliation is Checkpoint 7's and the API adds nothing to it.
   */
  it('converges when the same approval is delivered again', async () => {
    const requisitionId = await requisition();
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: requisitionId,
      subjectType: SUBJECT_TYPE,
    });

    // Recruitment decided by *this* approval; Workflow blank.
    const client = await fixture.pool.connect();

    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [TENANT_A]);
      await client.query(
        `update recruitment_requisition set status = 'approved', approval_id = $1,
           version = version + 1 where id = $2`,
        [running.instanceId, requisitionId],
      );
      await client.query('commit');
    } finally {
      client.release();
    }

    const retried = await post(application, `/approvals/${running.instanceId}/decision`, {
      decision: 'approved',
      expectedVersion: 1,
    });

    expect(retried.status).toBe(201);
    // No second transition: Recruitment wrote no decision row, because it was never asked to.
    await expect(decisionsFor(requisitionId)).resolves.toEqual([]);
    await expect(requisitionRow(requisitionId)).resolves.toEqual({
      status: 'approved',
      approval_id: running.instanceId,
    });

    const instance = await get(application, `/instances/${running.instanceId}`);

    expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('completed');
  });

  /** A different approval already decided it: refused, and the existing identifier is not rewritten. */
  it('refuses when another approval already decided the requisition', async () => {
    const other = '01930000-0000-7000-8000-0000000099aa';
    const requisitionId = await requisition({ status: 'approved', approvalId: other });
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: requisitionId,
      subjectType: SUBJECT_TYPE,
    });
    const refused = await post(application, `/approvals/${running.instanceId}/decision`, {
      decision: 'approved',
      expectedVersion: 1,
    });

    expect(refused.status).toBe(422);
    expect(refused.body['detail']).toBe('workflow.rejection.subject-decided-by-another-approval');
    await expect(requisitionRow(requisitionId)).resolves.toEqual({
      status: 'approved',
      approval_id: other,
    });
  });

  /** And a decision a person made directly in Recruitment is not claimed by an approval. */
  it('refuses when the requisition was decided outside Workflow', async () => {
    const requisitionId = await requisition({ status: 'approved' });
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: requisitionId,
      subjectType: SUBJECT_TYPE,
    });
    const refused = await post(application, `/approvals/${running.instanceId}/decision`, {
      decision: 'approved',
      expectedVersion: 1,
    });

    expect(refused.status).toBe(422);
    expect(refused.body['detail']).toBe('workflow.rejection.subject-decided-outside-workflow');
    await expect(requisitionRow(requisitionId)).resolves.toEqual({
      status: 'approved',
      approval_id: null,
    });
  });

  /** A rejection reaches Recruitment as a rejection, not as a cancellation or a silence. */
  it('applies a rejection to the requisition', async () => {
    const requisitionId = await requisition();
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: requisitionId,
      subjectType: SUBJECT_TYPE,
    });

    await post(application, `/approvals/${running.instanceId}/decision`, {
      decision: 'rejected',
      expectedVersion: 1,
      comment: 'Not budgeted',
    });

    await expect(requisitionRow(requisitionId)).resolves.toEqual({
      status: 'rejected',
      approval_id: running.instanceId,
    });
  });
});
