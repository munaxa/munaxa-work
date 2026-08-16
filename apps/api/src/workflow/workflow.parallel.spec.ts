import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  REQUESTER,
  TENANT_A,
  UNADOPTED,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { aDraftVersion, anApprovalGroup, get, post } from './workflow-api-scenario.js';

/**
 * A parallel branch, end to end over HTTP.
 *
 * **Nothing below reaches a handler, a repository or the database directly.** Every step is an HTTP
 * request against the real controllers, the real validation pipe, the real guard, the real
 * application, the real PostgreSQL repositories and real row-level security. A suite that stubbed
 * any of those would be asserting that this file's own arithmetic agrees with itself.
 *
 * **The tally in the response is the application's.** The edge computes no denominator, no threshold
 * and no outcome; what these tests pin is that the numbers arrive unchanged and that a caller reads
 * only their own branch.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API parallel-branch suite');

const NAME = { en: 'Approval', ar: 'اعتماد' };

suite('a parallel branch, end to end over HTTP', () => {
  let fixture: WorkflowApiFixture;
  let application: INestApplication;
  let workflowVersionId: string;
  let definitionId: string;

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

    const draft = await aDraftVersion(application, UNADOPTED);

    definitionId = draft.definitionId;
    workflowVersionId = draft.workflowVersionId;
  });

  const addStep = (step: Record<string, unknown>): Promise<{ readonly status: number }> =>
    post(application, `/versions/${workflowVersionId}/steps`, { name: NAME, ...step });

  const startApproval = async (): Promise<string> => {
    await post(application, `/versions/${workflowVersionId}/publication`, { expectedVersion: 1 });

    const started = await post(application, '/instances', {
      definitionId,
      subjectType: UNADOPTED,
      subjectId: uuidV7(),
    });

    return String(started.body.instanceId);
  };

  const decide = (
    instanceId: string,
    member: string,
    extra: Record<string, unknown> = {},
  ): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> =>
    post(
      application,
      `/approvals/${instanceId}/decision`,
      { decision: 'approved', expectedVersion: 1, ...extra },
      { member },
    );

  it('asks two people at once, tallies their answers, and completes the approval', async () => {
    const group = await anApprovalGroup(application, [APPROVER, DEPUTY]);

    await addStep({
      ordinal: 1,
      approverGroupId: group.approvalGroupId,
      branchRule: 'unanimous',
    });
    await addStep({ ordinal: 2, approverMembershipId: REQUESTER });

    const instanceId = await startApproval();
    const opened = await get(application, `/instances/${instanceId}`);
    const detail = opened.body as {
      readonly awaitingSteps: readonly { readonly approverMembershipId: string }[];
      readonly tallies: readonly Record<string, unknown>[];
    };

    // The list expanded into two steps, both awaiting, both naming a person.
    expect(detail.awaitingSteps).toHaveLength(2);
    expect(detail.tallies[0]).toMatchObject({
      ordinal: 1,
      rule: 'unanimous',
      assigned: 2,
      approvals: 0,
      outstanding: 2,
      threshold: 2,
      quorum: 1,
      outcome: 'awaiting',
    });

    // Each member sees their own step and nobody else's.
    for (const member of [APPROVER, DEPUTY]) {
      const queue = await get(application, '/approvals/pending', { member });
      const rows = (queue.body as { readonly items: readonly unknown[] }).items;

      expect([member, rows.length]).toStrictEqual([member, 1]);
    }

    const first = await decide(instanceId, APPROVER);

    expect(first.status).toBe(201);
    expect(first.body['tally']).toMatchObject({
      approvals: 1,
      outstanding: 1,
      outcome: 'awaiting',
    });

    const second = await decide(instanceId, DEPUTY);

    expect(second.body['tally']).toMatchObject({ approvals: 2, outcome: 'approved' });
    // The branch ended, so the next one opened — one person, named individually.
    expect(second.body['awaitingStepIds']).toHaveLength(1);

    const advanced = await get(application, `/instances/${instanceId}`);
    const after = advanced.body as {
      readonly instance: { readonly status: string };
      readonly awaitingSteps: readonly { readonly approverMembershipId: string }[];
      readonly decisions: readonly unknown[];
    };

    expect(after.instance.status).toBe('running');
    expect(after.awaitingSteps.map((step) => step.approverMembershipId)).toStrictEqual([REQUESTER]);
    expect(after.decisions).toHaveLength(2);

    const last = await decide(instanceId, REQUESTER);

    expect(last.body['instanceStatus']).toBe('completed');

    const timeline = await get(application, `/instances/${instanceId}/history`);
    const events = (
      timeline.body as { readonly items: readonly { readonly event: string }[] }
    ).items.map((entry) => entry.event);

    // Two people asked at once is two `step-awaiting` entries at the start, not one — a timeline
    // that recorded one would be telling the second of them they had never been asked.
    expect(events.filter((event) => event === 'step-awaiting')).toHaveLength(3);
    expect(events.filter((event) => event === 'step-approved')).toHaveLength(3);
    expect(events).toContain('instance-completed');
  });

  it('refuses a decision from somebody the branch never asked', async () => {
    await addStep({ ordinal: 1, approverMembershipId: APPROVER });

    const refused = await decide(await startApproval(), DEPUTY);

    expect(refused.status).toBe(422);
  });

  it('refuses a decision naming a step that belongs to somebody else', async () => {
    const group = await anApprovalGroup(application, [APPROVER, DEPUTY]);

    await addStep({ ordinal: 1, approverGroupId: group.approvalGroupId });

    const instanceId = await startApproval();
    const detail = await get(application, `/instances/${instanceId}`);
    const theirs = (
      detail.body as {
        readonly awaitingSteps: readonly {
          readonly stepId: string;
          readonly approverMembershipId: string;
        }[];
      }
    ).awaitingSteps.find((step) => step.approverMembershipId === DEPUTY);
    const refused = await decide(instanceId, APPROVER, { stepId: theirs?.stepId });

    // `stepId` narrows the caller's own steps and cannot widen them: naming a colleague's earns the
    // same refusal as sending nothing would.
    expect(refused.status).toBe(422);
  });
});
