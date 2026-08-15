import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  TENANT_A,
  UNADOPTED,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { get, post, runningApproval } from './workflow-api-scenario.js';
import { seedDelegation } from './workflow-cross-module-seed.js';

/**
 * An approval being answered, over HTTP: raised, queued, decided, read back — or cancelled.
 *
 * Configuring the process it runs is the other half of the lifecycle and has a suite of its own.
 *
 * **Every layer below the request is the production one**: the real controllers, the real global
 * validation pipe and Problem Details filter, the real dispatcher, the real handlers, the real
 * PostgreSQL repositories, and — for a delegated decision — the real Identity module answering from
 * the real `delegation` table. The subject type here is one nobody adopted, so a terminal decision
 * completes inside Workflow; the Recruitment seam has suites of its own.
 *
 * These are the two scenarios the phase exists for: an approver answering the step they were asked
 * to answer, and a deputy answering one delegated to them — with the record of the second naming
 * both people and never collapsing them into one.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API lifecycle suite');

suite('the Workflow API', () => {
  let fixture: WorkflowApiFixture;
  let application: INestApplication;

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

  const decide = (
    instanceId: string,
    body: Record<string, unknown>,
    as?: { readonly member?: string },
  ): ReturnType<typeof post> =>
    post(application, `/approvals/${instanceId}/decision`, body, as ?? {});

  /**
   * **Scenario 1 — a direct approval, end to end.**
   *
   * Define, draft, add a step, publish, raise an approval, see it in the approver's queue, decide it,
   * and read the instance, the approval status and the history back. Every assertion is a row that
   * travelled the whole stack.
   */
  describe('a direct approval', () => {
    it('appears in the approver’s queue, is decided, and ends completed', async () => {
      const subjectId = uuidV7();
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId,
        subjectType: UNADOPTED,
      });
      const queue = await get(application, '/approvals/pending');

      expect(queue.status).toBe(200);
      expect(queue.body['total']).toBe(1);

      const waiting = (queue.body['items'] as readonly Record<string, unknown>[])[0];

      expect(waiting?.['instanceId']).toBe(running.instanceId);
      expect(waiting?.['ordinal']).toBe(1);

      const decided = await decide(running.instanceId, {
        decision: 'approved',
        expectedVersion: 1,
      });

      expect(decided.status).toBe(201);

      const instance = await get(application, `/instances/${running.instanceId}`);

      expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('completed');

      const status = await get(application, `/approvals/${running.instanceId}/status`);

      expect(status.body['approvalId']).toBe(running.instanceId);
      expect(status.body['state']).toBe('approved');

      const chain = status.body['steps'] as readonly Record<string, unknown>[];

      expect(chain).toHaveLength(1);
      expect(chain[0]?.['approver']).toBe(APPROVER);
      expect(chain[0]?.['decision']).toBe('approved');
      // An instant is an ISO string at the boundary, exactly as the application published it.
      expect(String(chain[0]?.['decidedOn'])).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

      const history = await get(application, `/instances/${running.instanceId}/history`);

      expect(history.body['total']).toBe(4);
      expect(
        (history.body['items'] as readonly Record<string, unknown>[]).map(
          (entry) => entry['event'],
        ),
      ).toEqual(['instance-started', 'step-awaiting', 'step-approved', 'instance-completed']);

      // And the queue is empty again: a decided step is not work anybody owes.
      const after = await get(application, '/approvals/pending');

      expect(after.body['total']).toBe(0);

      const mine = await get(application, '/approvals/decided');

      expect(mine.body['total']).toBe(1);
    });

    /** Two steps: the first decision moves the chain on rather than ending it. */
    it('advances to the next approver instead of completing', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        approvers: [APPROVER, DEPUTY],
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      await decide(running.instanceId, { decision: 'approved', expectedVersion: 1 });

      const instance = await get(application, `/instances/${running.instanceId}`);

      expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('running');

      const next = await get(application, '/approvals/pending', { member: DEPUTY });

      expect(next.body['total']).toBe(1);
    });
  });

  /**
   * **Scenario 3 — a rejection.**
   *
   * The decision is stored, the instance ends rejected, the remaining steps are abandoned rather than
   * left looking like work somebody owes, and the timeline says so. There is no tally and no partial
   * state, because there is no vocabulary in the module for either.
   */
  it('records a rejection, skips what is left, and ends the approval', async () => {
    const running = await runningApproval(application, {
      approver: APPROVER,
      approvers: [APPROVER, DEPUTY],
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });
    const rejected = await decide(running.instanceId, {
      decision: 'rejected',
      expectedVersion: 1,
      comment: 'The headcount was not budgeted',
    });

    expect(rejected.status).toBe(201);

    const instance = await get(application, `/instances/${running.instanceId}`);
    const steps = instance.body['steps'] as readonly Record<string, unknown>[];

    expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('rejected');
    expect(steps.map((step) => step['status'])).toEqual(['rejected', 'skipped']);

    const history = await get(application, `/instances/${running.instanceId}/history`);

    expect(
      (history.body['items'] as readonly Record<string, unknown>[]).map((entry) => entry['event']),
    ).toEqual([
      'instance-started',
      'step-awaiting',
      'step-rejected',
      'step-skipped',
      'instance-rejected',
    ]);

    // **The comment stays on the decision.** A timeline a queue screen renders carries no opinion
    // one person wrote about another's request.
    for (const entry of history.body['items'] as readonly Record<string, unknown>[]) {
      expect(Object.keys(entry)).not.toContain('comment');
    }

    const second = await get(application, '/approvals/pending', { member: DEPUTY });

    expect(second.body['total']).toBe(0);
  });

  /**
   * **Scenario 2 — a delegated approval.**
   *
   * The deputy decides without supplying any identifier at all: the membership comes from the
   * request, and whether a delegation is in force is Identity's answer, asked inside the handler at
   * the instant of the decision.
   */
  describe('a delegated approval', () => {
    it('lets the deputy decide, recording them as actor and the approver as authority', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      await seedDelegation({ pool: fixture.pool } as never, TENANT_A);

      const decided = await decide(
        running.instanceId,
        { decision: 'approved', expectedVersion: 1 },
        { member: DEPUTY },
      );

      expect(decided.status).toBe(201);

      const rows = await fixture.rowsIn<{
        decided_by_membership_id: string;
        on_behalf_of_membership_id: string | null;
        authority: string;
      }>(
        TENANT_A,
        `select decided_by_membership_id, on_behalf_of_membership_id, authority
           from workflow_decision where instance_id = $1`,
        [running.instanceId],
      );

      expect(rows[0]?.authority).toBe('delegated');
      expect(rows[0]?.decided_by_membership_id).toBe(DEPUTY);
      expect(rows[0]?.on_behalf_of_membership_id).toBe(APPROVER);

      // The decided queue follows the same rule: it is the delegate's decision, not the approver's.
      const deputies = await get(application, '/approvals/decided', { member: DEPUTY });
      const theirs = await get(application, '/approvals/decided', { member: APPROVER });

      expect(deputies.body['total']).toBe(1);
      expect(theirs.body['total']).toBe(0);
    });

    it('refuses a deputy with no delegation at all', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const refused = await decide(
        running.instanceId,
        { decision: 'approved', expectedVersion: 1 },
        { member: DEPUTY },
      );

      expect(refused.status).toBe(422);
      expect(refused.body['detail']).toBe('workflow.rejection.decision-not-the-assigned-approver');
    });

    it('refuses a delegation whose period has ended', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      await seedDelegation({ pool: fixture.pool } as never, TENANT_A, {
        from: new Date('2026-01-01T00:00:00.000Z'),
        to: new Date('2026-02-01T00:00:00.000Z'),
      });

      const refused = await decide(
        running.instanceId,
        { decision: 'approved', expectedVersion: 1 },
        { member: DEPUTY },
      );

      expect(refused.status).toBe(422);
    });

    it('refuses a delegation that was revoked', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      await seedDelegation({ pool: fixture.pool } as never, TENANT_A, { status: 'revoked' });

      const refused = await decide(
        running.instanceId,
        { decision: 'approved', expectedVersion: 1 },
        { member: DEPUTY },
      );

      expect(refused.status).toBe(422);
    });

    /** A delegation for another domain is not a delegation for this one. */
    it('refuses a delegation granted for a different scope', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      await seedDelegation({ pool: fixture.pool } as never, TENANT_A, {
        scope: 'leave.request.approve',
      });

      const refused = await decide(
        running.instanceId,
        { decision: 'approved', expectedVersion: 1 },
        { member: DEPUTY },
      );

      expect(refused.status).toBe(422);
    });
  });

  /** Cancelling: terminal, reasoned, and it abandons what is left rather than leaving it waiting. */
  it('cancels a running approval and skips its remaining steps', async () => {
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });
    const cancelled = await post(application, `/instances/${running.instanceId}/cancellation`, {
      reason: 'The role was filled internally',
      expectedVersion: 1,
    });

    expect(cancelled.status).toBe(201);

    const instance = await get(application, `/instances/${running.instanceId}`);

    expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('cancelled');
    expect(
      (instance.body['steps'] as readonly Record<string, unknown>[]).map((step) => step['status']),
    ).toEqual(['skipped']);

    const queue = await get(application, '/approvals/pending');

    expect(queue.body['total']).toBe(0);
  });

  /** A second request for a subject already awaiting one converges rather than duplicating. */
  it('converges a second approval for the same subject', async () => {
    const subjectId = uuidV7();
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId,
      subjectType: UNADOPTED,
    });
    const again = await post(application, '/instances', {
      definitionId: running.definitionId,
      subjectType: UNADOPTED,
      subjectId,
    });

    expect(again.status).toBe(201);
    expect(again.body.instanceId).toBe(running.instanceId);
    expect(again.body.created).toBe(false);
  });
});
