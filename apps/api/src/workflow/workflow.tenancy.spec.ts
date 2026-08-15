import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  B_APPROVER,
  CONNECTION,
  DEPUTY,
  OUTSIDER,
  TENANT_A,
  TENANT_B,
  UNADOPTED,
  openWorkflowApi,
  permitting,
  requireDatabaseInCi,
  type WorkflowApiFixture,
} from './workflow-api.fixture.js';
import { get, post, runningApproval } from './workflow-api-scenario.js';

/**
 * Who the caller is, and which tenant they are in — the two questions this module must never get
 * from the client.
 *
 * **The queue is the sharpest of them.** "The approvals waiting for me" is answerable here only
 * because a request resolves a membership, and an endpoint that accepted one would let anybody
 * holding `approval.read-own` read anybody's queue. So the tests below try, in every shape the wire
 * allows, to make the queue belong to somebody else — a query parameter, a body field, a second
 * membership — and each attempt either changes nothing or is refused outright.
 *
 * **The tenants hold equivalent things on purpose.** Both have a definition, an approval and a
 * subject; a suite whose tenants held different values would pass whether or not the boundary
 * worked, because every read would be scoped by the value rather than by the tenant.
 *
 * The role these run as owns nothing, is not a superuser and holds no `BYPASSRLS`, which is asserted
 * before any isolation result is believed.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API tenancy suite');

const WORKFLOW_TABLES = [
  'workflow_definition',
  'workflow_version',
  'workflow_step_template',
  'workflow_instance',
  'workflow_step',
  'workflow_decision',
  'workflow_history',
];

suite('Workflow API tenancy and identity', () => {
  let fixture: WorkflowApiFixture;
  let inA: INestApplication;
  let inB: INestApplication;

  beforeAll(async () => {
    fixture = await openWorkflowApi();
    inA = await fixture.applicationFor(TENANT_A, permitting(...ALL_WORKFLOW_PERMISSIONS), APPROVER);
    inB = await fixture.applicationFor(
      TENANT_B,
      permitting(...ALL_WORKFLOW_PERMISSIONS),
      B_APPROVER,
    );
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /**
   * The role can actually be refused.
   *
   * The database belongs to a superuser, and a superuser bypasses every policy there is. Asserted
   * first, because everything below is otherwise a report about a check that never ran.
   */
  it('runs as a role that is neither a superuser nor exempt from row-level security', async () => {
    const rows = await fixture.rowsIn<{ rolsuper: boolean; rolbypassrls: boolean }>(
      TENANT_A,
      `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );

    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('keeps row-level security enabled and forced on all seven tables', async () => {
    const rows = await fixture.inspect<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
         where relname = any($1::text[]) order by relname`,
      [WORKFLOW_TABLES],
    );

    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect([row.relname, row.relrowsecurity, row.relforcerowsecurity]).toEqual([
        row.relname,
        true,
        true,
      ]);
    }
  });

  describe('an approval queue belongs to the membership on the request', () => {
    it('serves each member their own steps and nobody else’s', async () => {
      await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      const mine = await get(inA, '/approvals/pending');
      const theirs = await get(inA, '/approvals/pending', { member: DEPUTY });

      expect(mine.body['total']).toBe(1);
      expect(theirs.body['total']).toBe(0);
    });

    /**
     * **A membership on the query string changes nothing.**
     *
     * `forbidNonWhitelisted` does not apply to a query bag the controller reads as a record, so the
     * parameter is accepted by Express and simply never reaches the handler — the queue is built
     * from the request's own membership either way. Asserted rather than assumed, because "the
     * handler ignores it" is exactly the kind of claim that stops being true quietly.
     */
    it('ignores a membership identifier a caller puts on the query string', async () => {
      await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      for (const parameter of [
        `membershipId=${APPROVER}`,
        `approverMembershipId=${APPROVER}`,
        `workforceUserId=${APPROVER}`,
        `platformUserId=${APPROVER}`,
        'me=true',
      ]) {
        const response = await get(inA, `/approvals/pending?${parameter}`, { member: DEPUTY });

        expect([parameter, response.status]).toEqual([parameter, 200]);
        // Still the deputy's queue — which is empty — rather than the approver's.
        expect([parameter, response.body['total']]).toEqual([parameter, 0]);
      }
    });

    /** A request that resolved no membership gets an empty queue, never everybody's. */
    it('answers a request with no membership emptily', async () => {
      await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      const pending = await get(inA, '/approvals/pending', { member: 'none' });
      const decided = await get(inA, '/approvals/decided', { member: 'none' });

      expect(pending.status).toBe(200);
      expect(pending.body['total']).toBe(0);
      expect(decided.body['total']).toBe(0);
    });

    /** And a decision from a request with no membership is refused rather than attributed. */
    it('refuses a decision from a request with no membership', async () => {
      const running = await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const refused = await post(
        inA,
        `/approvals/${running.instanceId}/decision`,
        { decision: 'approved', expectedVersion: 1 },
        { member: 'none' },
      );

      expect(refused.status).toBe(422);
      expect(refused.body['detail']).toBe('workflow.rejection.membership-unresolved');
    });

    /** Somebody the step was never assigned to is refused, whatever they hold. */
    it('refuses a decision by a membership the step was not assigned to', async () => {
      const running = await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const refused = await post(
        inA,
        `/approvals/${running.instanceId}/decision`,
        { decision: 'approved', expectedVersion: 1 },
        { member: OUTSIDER },
      );

      expect(refused.status).toBe(422);
    });
  });

  describe('two tenants', () => {
    it('does not let one tenant read another’s approval, definition or timeline', async () => {
      const running = await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const attempts = [
        await get(inB, `/instances/${running.instanceId}`),
        await get(inB, `/instances/${running.instanceId}/history`),
        await get(inB, `/approvals/${running.instanceId}/status`),
        await get(inB, `/definitions/${running.definitionId}`),
      ];

      for (const attempt of attempts) expect(attempt.status).toBe(404);
    });

    it('does not let one tenant’s totals include another’s rows', async () => {
      await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      await runningApproval(inB, {
        approver: B_APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });

      const definitions = await get(inB, '/definitions');
      const instances = await get(inB, '/instances');
      const queue = await get(inB, '/approvals/pending');

      expect(definitions.body['total']).toBe(1);
      expect(instances.body['total']).toBe(1);
      expect(queue.body['total']).toBe(1);
    });

    it('does not let one tenant decide or cancel another’s approval', async () => {
      const running = await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const decided = await post(inB, `/approvals/${running.instanceId}/decision`, {
        decision: 'approved',
        expectedVersion: 1,
      });
      const cancelled = await post(inB, `/instances/${running.instanceId}/cancellation`, {
        reason: 'not ours',
        expectedVersion: 1,
      });

      expect(decided.status).toBe(404);
      expect(cancelled.status).toBe(404);

      // Untouched, and still waiting on the approver it was assigned to.
      const still = await get(inA, `/instances/${running.instanceId}`);

      expect((still.body['instance'] as Record<string, unknown>)['status']).toBe('running');
    });

    /**
     * **The same subject identifier in both tenants is two different approvals.**
     *
     * An approval identifier does not cross a boundary, and neither does the subject it is about:
     * each tenant's read finds its own and nothing else.
     */
    it('keeps approvals about the same subject apart', async () => {
      const subjectId = uuidV7();
      const first = await runningApproval(inA, {
        approver: APPROVER,
        subjectId,
        subjectType: UNADOPTED,
      });
      const second = await runningApproval(inB, {
        approver: B_APPROVER,
        subjectId,
        subjectType: UNADOPTED,
      });

      expect(first.instanceId).not.toBe(second.instanceId);

      const inFirst = await get(inA, `/instances?subjectId=${subjectId}`);
      const inSecond = await get(inB, `/instances?subjectId=${subjectId}`);

      expect(inFirst.body['total']).toBe(1);
      expect(inSecond.body['total']).toBe(1);
      expect((inFirst.body['items'] as readonly Record<string, unknown>[])[0]?.['instanceId']).toBe(
        first.instanceId,
      );
    });

    /** A membership from the other tenant decides nothing here. */
    it('refuses a membership from the other tenant', async () => {
      const running = await runningApproval(inA, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const refused = await post(
        inA,
        `/approvals/${running.instanceId}/decision`,
        { decision: 'approved', expectedVersion: 1 },
        { member: B_APPROVER },
      );

      expect(refused.status).toBe(422);
    });
  });
});
