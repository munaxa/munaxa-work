import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  OUTSIDER,
  REQUESTER,
  TENANT_A,
  UNADOPTED,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { NAME, aDraftVersion, get, must, post } from './workflow-api-scenario.js';

/**
 * Escalation over HTTP: one route, three fields, and everything it refuses.
 *
 * **The route is an adapter and the tests are about the boundary.** Whether a branch may be widened,
 * what it does to a tally and whether the same person is already on it are the domain's, tested
 * there and against real PostgreSQL in Checkpoint 5. What only this layer can show is the wire: that
 * the permission is exact, that the body carries three fields and nothing else, that a refusal
 * arrives as the status a client can act on, and that nothing about *how* the escalation was stored
 * comes back out.
 *
 * **`escalatedAt` is the assertion worth naming.** Checkpoint 5 made it durable and no contract
 * publishes it, so the response must not carry it — a column existing is not a reason to expose it,
 * and a screen that learned an approver was "added rather than assigned" would be reading provenance
 * nobody approved showing.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API escalation suite');

suite('escalating a branch over HTTP', () => {
  let fixture: WorkflowApiFixture;
  let application: INestApplication;
  let asRequester: INestApplication;

  beforeAll(async () => {
    fixture = await openWorkflowApi();

    const everything = permitting(...ALL_WORKFLOW_PERMISSIONS);

    application = await fixture.applicationFor(TENANT_A, everything, APPROVER);
    asRequester = await fixture.applicationFor(TENANT_A, everything, REQUESTER);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** A published branch of two, under a rule that permits escalation, with an approval running. */
  const runningBranch = async (
    branchRule: 'unanimous' | 'majority' | 'first-response',
    subjectId: string,
  ): Promise<string> => {
    const drafted = await aDraftVersion(application, UNADOPTED);

    for (const approverMembershipId of [APPROVER, DEPUTY]) {
      must(
        await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
          ordinal: 1,
          name: NAME,
          approverMembershipId,
          branchRule,
        }),
        'adding a step',
      );
    }
    must(
      await post(application, `/versions/${drafted.workflowVersionId}/publication`, {
        expectedVersion: 1,
      }),
      'publishing',
    );

    const started = must(
      await post(asRequester, '/instances', {
        definitionId: drafted.definitionId,
        subjectType: UNADOPTED,
        subjectId,
      }),
      'starting',
    );

    return String(started.instanceId);
  };

  const escalate = (instanceId: string, body: Record<string, unknown>) =>
    post(application, `/instances/${instanceId}/escalation`, body);

  describe('the route', () => {
    it('adds an approver and answers with the step it created', async () => {
      const instanceId = await runningBranch('majority', 'subject-1');
      const escalated = must(
        await escalate(instanceId, { ordinal: 1, approverMembershipId: OUTSIDER }),
        'escalating',
      );

      expect(typeof (escalated as { stepId?: unknown }).stepId).toBe('string');

      const detail = must(await get(application, `/instances/${instanceId}`), 'reading it');
      const steps = (detail as { steps: readonly Record<string, unknown>[] }).steps;

      expect(steps).toHaveLength(3);
      expect(steps.map((step) => step['approverMembershipId'])).toContain(OUTSIDER);
    });

    /**
     * **Nothing about the provenance reaches the wire.**
     *
     * The escalated step is durable and marked in the database; the response is the ordinary public
     * step. Scanning the whole body rather than one field, because the question is whether *any*
     * shape of it leaked — a timestamp under another name would pass a check on `escalatedAt` alone.
     */
    it('publishes no escalation provenance anywhere in the response', async () => {
      const instanceId = await runningBranch('majority', 'subject-2');

      must(
        await escalate(instanceId, { ordinal: 1, approverMembershipId: OUTSIDER }),
        'escalating',
      );

      const detail = must(await get(application, `/instances/${instanceId}`), 'reading it');
      const body = JSON.stringify(detail).toLowerCase();

      for (const leaked of [
        'escalated',
        'escalation',
        'sourcegroupid',
        'employment',
        'reporting',
        'manager',
      ]) {
        expect([leaked, body.includes(leaked)]).toStrictEqual([leaked, false]);
      }
    });

    /** The tally the read publishes is the domain's, and the denominator did not move. */
    it('leaves the assigned denominator where it was', async () => {
      const instanceId = await runningBranch('majority', 'subject-3');

      must(
        await escalate(instanceId, { ordinal: 1, approverMembershipId: OUTSIDER }),
        'escalating',
      );

      const detail = must(await get(application, `/instances/${instanceId}`), 'reading it');
      const [tally] = (detail as { tallies: readonly Record<string, unknown>[] }).tallies;

      expect([tally?.['assigned'], tally?.['threshold']]).toStrictEqual([2, 2]);
      expect(tally?.['outstanding']).toBe(2);
    });
  });

  describe('what the body refuses', () => {
    let instanceId: string;

    beforeEach(async () => {
      instanceId = await runningBranch('majority', 'subject-body');
    });

    it.each([
      ['a missing ordinal', { approverMembershipId: OUTSIDER }],
      ['a missing approver', { ordinal: 1 }],
      ['a fractional ordinal', { ordinal: 1.5, approverMembershipId: OUTSIDER }],
      ['a zero ordinal', { ordinal: 0, approverMembershipId: OUTSIDER }],
      ['a negative ordinal', { ordinal: -1, approverMembershipId: OUTSIDER }],
      ['a string ordinal', { ordinal: '1', approverMembershipId: OUTSIDER }],
      ['a null ordinal', { ordinal: null, approverMembershipId: OUTSIDER }],
      ['an approver that is not a uuid', { ordinal: 1, approverMembershipId: 'somebody' }],
      ['a null approver', { ordinal: 1, approverMembershipId: null }],
    ])('refuses %s', async (_what, body) => {
      expect((await escalate(instanceId, body)).status).toBe(400);
    });

    /**
     * Every field a caller might expect to send, and none of them exists.
     *
     * Three are identity and would be an escalation issued in somebody else's name; three are the
     * automatic capability this phase did not build; the rest are shapes from a different product.
     * `forbidNonWhitelisted` turns each into a **400** rather than a silently ignored field, which is
     * the difference between a client learning it sent something meaningless and a client believing
     * the product honoured it.
     */
    it.each([
      ['actorMembershipId', APPROVER],
      ['membershipId', APPROVER],
      ['workforceUserId', 'workforce-1'],
      ['onBehalfOfMembershipId', APPROVER],
      ['tenantId', TENANT_A],
      ['approverKind', 'manager'],
      ['managerEmploymentId', '01930000-0000-7000-8000-0000000000c1'],
      ['employmentId', '01930000-0000-7000-8000-0000000000c1'],
      ['approverGroupId', '01930000-0000-7000-8000-0000000000c1'],
      ['reason', 'It is late'],
      ['escalateAfter', 2],
      ['businessDays', true],
      ['dueAt', '2026-08-18T09:00:00.000Z'],
      ['expiresAt', '2026-08-18T09:00:00.000Z'],
      ['expired', true],
      ['breached', true],
      ['expectedVersion', 1],
    ])('refuses %s outright', async (field, value) => {
      const refused = await escalate(instanceId, {
        ordinal: 1,
        approverMembershipId: OUTSIDER,
        [field]: value,
      });

      expect([field, refused.status]).toStrictEqual([field, 400]);
    });
  });

  describe('what the route refuses', () => {
    it('refuses a unanimous branch as a business refusal, not a malformed request', async () => {
      const instanceId = await runningBranch('unanimous', 'subject-unanimous');
      const refused = await escalate(instanceId, { ordinal: 1, approverMembershipId: OUTSIDER });

      // 422: the request was understood and declined, which is a different thing from 400 and the
      // difference a client acts on.
      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body)).toContain('escalation-branch-is-unanimous');
    });

    it('keeps the duplicate refusal distinct from every other', async () => {
      const instanceId = await runningBranch('majority', 'subject-duplicate');

      must(await escalate(instanceId, { ordinal: 1, approverMembershipId: OUTSIDER }), 'the first');

      const again = await escalate(instanceId, { ordinal: 1, approverMembershipId: OUTSIDER });

      expect(again.status).toBe(422);
      expect(JSON.stringify(again.body)).toContain('escalation-already-escalated');
      // A duplicate is refused rather than quietly succeeding: no approved idempotency contract says
      // a repeated escalation should answer 200.
      expect(again.status).not.toBe(200);
    });

    it('answers 404 for an approval that does not exist', async () => {
      const refused = await escalate('01930000-0000-7000-8000-0000000000f9', {
        ordinal: 1,
        approverMembershipId: OUTSIDER,
      });

      expect(refused.status).toBe(404);
    });

    it('answers 400 for an instance identifier that is not a uuid', async () => {
      const refused = await post(application, '/instances/not-a-uuid/escalation', {
        ordinal: 1,
        approverMembershipId: OUTSIDER,
      });

      expect(refused.status).toBe(400);
    });

    it('refuses a branch nobody is waiting on', async () => {
      const instanceId = await runningBranch('majority', 'subject-ordinal');
      const refused = await escalate(instanceId, { ordinal: 9, approverMembershipId: OUTSIDER });

      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body)).toContain('escalation-branch-not-awaiting');
    });
  });

  /**
   * The permission, over HTTP, one grant at a time.
   *
   * The application suite proves the same separation against the dispatcher; this proves the route
   * does not open a second door. A caller holding the whole of the rest of Workflow is still
   * forbidden, which is the assertion the tenth permission exists for.
   */
  describe('the permission the route requires', () => {
    it('forbids a caller holding every other Workflow permission', async () => {
      const withoutEscalate = ALL_WORKFLOW_PERMISSIONS.filter(
        (permission) => permission !== 'workflow.approval.escalate',
      );

      expect(withoutEscalate).toHaveLength(9);

      const instanceId = await runningBranch('majority', 'subject-forbidden');
      const restricted = await fixture.applicationFor(
        TENANT_A,
        permitting(...withoutEscalate),
        APPROVER,
      );
      const refused = await post(restricted, `/instances/${instanceId}/escalation`, {
        ordinal: 1,
        approverMembershipId: OUTSIDER,
      });

      expect(refused.status).toBe(403);
    });

    it.each(
      ALL_WORKFLOW_PERMISSIONS.filter((permission) => permission !== 'workflow.approval.escalate'),
    )('is not opened by %s alone', async (permission) => {
      const instanceId = await runningBranch('majority', `subject-${permission.slice(-6)}`);
      const restricted = await fixture.applicationFor(TENANT_A, permitting(permission), APPROVER);
      const refused = await post(restricted, `/instances/${instanceId}/escalation`, {
        ordinal: 1,
        approverMembershipId: OUTSIDER,
      });

      expect([permission, refused.status]).toStrictEqual([permission, 403]);
    });

    it.each(['*', 'workflow.*', 'workflow.approval.*', 'workflow.approval'])(
      'is not opened by %s',
      async (pretender) => {
        const instanceId = await runningBranch('majority', `subject-${pretender.length}`);
        const restricted = await fixture.applicationFor(TENANT_A, permitting(pretender), APPROVER);
        const refused = await post(restricted, `/instances/${instanceId}/escalation`, {
          ordinal: 1,
          approverMembershipId: OUTSIDER,
        });

        expect([pretender, refused.status]).toStrictEqual([pretender, 403]);
      },
    );
  });
});
