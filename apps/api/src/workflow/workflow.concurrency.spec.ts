import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
  TENANT_A,
  UNADOPTED,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { get, post, publishedWorkflow, runningApproval } from './workflow-api-scenario.js';

/**
 * Two people acting at once, over real HTTP.
 *
 * Each request enters its own `UnitOfWork.execute`, which takes its own pooled connection and opens
 * its own transaction, so two requests started together are two genuinely concurrent sessions. No
 * sleeps, no disabled constraints.
 *
 * **Every outcome is named.** A stale version is a 409 from the shared Problem Details filter; a
 * lifecycle refusal is a 422 from the domain; the two are different sentences to whoever is holding
 * the screen, and a suite that turned every 422 into 409 would tell a client to re-read and resend a
 * request that will never succeed.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API concurrency suite');

suite('the Workflow API under contention', () => {
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

  /**
   * **Scenario 6 — a stale expected version.**
   *
   * The version travels in the `where` clause of the write, so a caller holding an old one matches
   * no row and `Repository.updateRow` raises `ConcurrencyException` — which the **shared** Problem
   * Details filter turns into a 409. This module adds no filter of its own; the mapping Phase 13 made
   * once is the mapping every module inherits.
   *
   * Cancellation is the operation used because the domain still *permits* it: a stale version has to
   * be the reason the write is refused, and an operation the lifecycle would refuse anyway would
   * produce a 422 before the version was ever consulted.
   */
  it('answers 409 to a mutation carrying a stale version', async () => {
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });
    const stale = await post(application, `/instances/${running.instanceId}/cancellation`, {
      reason: 'withdrawn',
      expectedVersion: 99,
    });

    expect(stale.status).toBe(409);
    expect(stale.body['detail']).toBe(
      'The record changed since it was read. Read it again and resend.',
    );
    // Nothing internal escapes with it.
    expect(Object.keys(stale.body)).not.toContain('stack');

    // And the approval is untouched: a refused write wrote nothing.
    const instance = await get(application, `/instances/${running.instanceId}`);

    expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('running');
  });

  /**
   * A second archive is a **lifecycle** refusal rather than a stale write, and the difference is the
   * whole point of not collapsing 422 into 409.
   *
   * The version is checked in the `where` clause of a write the domain has already agreed to make.
   * Archiving something already archived is a transition the domain refuses outright, so the request
   * never reaches a version check — and telling the client to re-read and resend would send them
   * round a loop that cannot terminate.
   */
  it('answers 422 to a transition the domain refuses, whatever version is sent', async () => {
    const published = await publishedWorkflow(application, {
      approver: APPROVER,
      subjectType: UNADOPTED,
    });
    const first = await post(application, `/versions/${published.workflowVersionId}/archive`, {
      expectedVersion: 2,
    });

    expect(first.status).toBe(201);

    const again = await post(application, `/versions/${published.workflowVersionId}/archive`, {
      expectedVersion: 3,
    });

    expect(again.status).toBe(422);
    expect(again.body['detail']).toBe('workflow.rejection.version-transition-refused');
  });

  /** And exactly one version bump happened, rather than two or none. */
  it('bumps the version exactly once', async () => {
    const published = await publishedWorkflow(application, {
      approver: APPROVER,
      subjectType: UNADOPTED,
    });

    await post(application, `/versions/${published.workflowVersionId}/archive`, {
      expectedVersion: 2,
    });
    await post(application, `/versions/${published.workflowVersionId}/archive`, {
      expectedVersion: 2,
    });

    const rows = await fixture.rowsIn<{ version: number; status: string }>(
      TENANT_A,
      `select version, status from workflow_version where id = $1`,
      [published.workflowVersionId],
    );

    expect(rows[0]?.version).toBe(3);
    expect(rows[0]?.status).toBe('archived');
  });

  /** Two simultaneous mutations of the same row: one commits, the other is refused and named. */
  it('lets one of two simultaneous version updates through', async () => {
    const published = await publishedWorkflow(application, {
      approver: APPROVER,
      subjectType: UNADOPTED,
    });
    const outcomes = await Promise.all([
      post(application, `/versions/${published.workflowVersionId}/archive`, { expectedVersion: 2 }),
      post(application, `/versions/${published.workflowVersionId}/archive`, { expectedVersion: 2 }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 201)).toHaveLength(1);
    // 409 if the write lost the version race, 422 if the loser re-read an already-archived version.
    // Both are named refusals; neither is a 500.
    for (const outcome of outcomes) expect([201, 409, 422]).toContain(outcome.status);
  });

  /**
   * Two simultaneous decisions on the same step.
   *
   * One commits. The other loses on a **named** invariant — Workflow's partial unique index on the
   * awaiting step, its optimistic version, or its own rule that a decided step is no longer awaiting
   * — and the approval is decided exactly once, with exactly one decision row.
   */
  it('records exactly one of two simultaneous decisions', async () => {
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });
    const outcomes = await Promise.all([
      post(application, `/approvals/${running.instanceId}/decision`, {
        decision: 'approved',
        expectedVersion: 1,
      }),
      post(application, `/approvals/${running.instanceId}/decision`, {
        decision: 'approved',
        expectedVersion: 1,
      }),
    ]);
    const accepted = outcomes.filter((outcome) => outcome.status === 201);
    const [refused] = outcomes.filter((outcome) => outcome.status !== 201);

    expect(accepted).toHaveLength(1);
    // Classified: a business refusal or a stale write, never a 500 and never an unexplained failure.
    expect([409, 422]).toContain(refused?.status);

    const decisions = await fixture.rowsIn<{ id: string }>(
      TENANT_A,
      `select id from workflow_decision where instance_id = $1`,
      [running.instanceId],
    );

    expect(decisions).toHaveLength(1);

    const instance = await get(application, `/instances/${running.instanceId}`);

    expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('completed');
  });

  /** A second decision after the first has committed is a lifecycle refusal, not a stale write. */
  it('answers 422 to a decision on an approval that has already ended', async () => {
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });

    await post(application, `/approvals/${running.instanceId}/decision`, {
      decision: 'approved',
      expectedVersion: 1,
    });

    const again = await post(application, `/approvals/${running.instanceId}/decision`, {
      decision: 'approved',
      expectedVersion: 2,
    });

    expect(again.status).toBe(422);
    expect(again.body['detail']).toBe('workflow.rejection.instance-has-no-awaiting-step');
  });

  /**
   * Two simultaneous requests for one subject leave **one** running approval.
   *
   * The convergence read cannot win this on its own — both callers look, both find nothing, and both
   * start one — so `workflow_instance_open_subject_idx` settles it. That is the invariant that
   * matters and it holds exactly.
   *
   * **The loser's status is not always a named refusal, and that is a repository-wide property
   * rather than a Workflow one.** A unique-violation raised by PostgreSQL is not a
   * `ConcurrencyException`, and the shared Problem Details filter maps only that to 409; everything
   * else it has not been taught becomes a 500. Teaching it to recognise a duplicate key would be a
   * change to shared infrastructure this checkpoint is not authorized to make, so the behaviour is
   * asserted as it is and reported rather than papered over with a status this product does not
   * actually return.
   */
  it('leaves exactly one running approval when two requests race for a subject', async () => {
    const subjectId = uuidV7();
    const published = await publishedWorkflow(application, {
      approver: APPROVER,
      subjectType: UNADOPTED,
    });
    const body = { definitionId: published.definitionId, subjectType: UNADOPTED, subjectId };
    const outcomes = await Promise.all([
      post(application, '/instances', body),
      post(application, '/instances', body),
    ]);
    const instances = await fixture.rowsIn<{ id: string }>(
      TENANT_A,
      `select id from workflow_instance where subject_id = $1 and status = 'running'`,
      [subjectId],
    );

    expect(instances).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 201).length).toBeGreaterThanOrEqual(1);
    for (const outcome of outcomes) {
      expect([201, 409, 422, 500]).toContain(outcome.status);
    }
  });

  /** Asked one at a time — the ordinary case — the second converges on the first, with a 201. */
  it('converges a sequential second request on the approval that exists', async () => {
    const subjectId = uuidV7();
    const published = await publishedWorkflow(application, {
      approver: APPROVER,
      subjectType: UNADOPTED,
    });
    const body = { definitionId: published.definitionId, subjectType: UNADOPTED, subjectId };
    const first = await post(application, '/instances', body);
    const second = await post(application, '/instances', body);

    expect(second.status).toBe(201);
    expect(second.body.instanceId).toBe(first.body.instanceId);
    expect(second.body.created).toBe(false);
  });

  /** Two simultaneous cancellations: one ends the approval, the other is told the row moved on. */
  it('cancels once when two callers cancel at the same moment', async () => {
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });
    const outcomes = await Promise.all([
      post(application, `/instances/${running.instanceId}/cancellation`, {
        reason: 'withdrawn',
        expectedVersion: 1,
      }),
      post(application, `/instances/${running.instanceId}/cancellation`, {
        reason: 'also withdrawn',
        expectedVersion: 1,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 201)).toHaveLength(1);
    for (const outcome of outcomes) expect([201, 409, 422]).toContain(outcome.status);

    const rows = await fixture.rowsIn<{ status: string; cancellation_reason: string }>(
      TENANT_A,
      `select status, cancellation_reason from workflow_instance where id = $1`,
      [running.instanceId],
    );

    expect(rows[0]?.status).toBe('cancelled');
    // Whichever request won — the winner is PostgreSQL's to choose, not this test's — the reason
    // stored is *that* caller's. What must never happen is a reason from neither, or from both.
    expect(['withdrawn', 'also withdrawn']).toContain(rows[0]?.cancellation_reason);
  });
});
