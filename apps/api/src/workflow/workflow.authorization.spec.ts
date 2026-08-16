import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { uuidV7 } from '@work/kernel';
import { ALL_WORKFLOW_PERMISSIONS, WorkflowPermissions } from '@work/workflow';

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
import { anApprovalGroup, BASE, runningApproval } from './workflow-api-scenario.js';
import { http } from './workflow-api.fixture.js';

/**
 * What each route opens with, and — more importantly — what it stays shut to.
 *
 * Every endpoint is asked three questions: does the permission it declares open it, does removing
 * that permission close it, and does holding **every other Workflow permission** leave it closed?
 * The third is the one that catches a handler wired to the wrong constant, because a caller holding
 * six of the seven would sail through a test that only checked the first two.
 *
 * The three separations below are deliberate design decisions rather than accidents of naming, and
 * each is asserted on its own:
 *
 * **`instance.cancel` is not `instance.start`.** Raising an approval and ending somebody else's
 * without anybody deciding it are different acts.
 *
 * **`approval.decide` is not `instance.read`.** Reading who has been asked and answering on their
 * behalf are different capabilities.
 *
 * **`approval.read-own` is not `approval.decide`.** Seeing what is waiting for you does not let you
 * answer it, and answering does not require the queue.
 *
 * **`group.manage` is not `definition.manage`.** Whoever edits an approval group changes who
 * approves every request routed through a version that names it, which is a different authority from
 * writing the process — and `group.read` is separate again, because seeing who approves capital
 * expenditure and being able to change it are different risks.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API authorization suite');

interface Route {
  readonly method: 'get' | 'post' | 'delete';
  readonly path: string;
  readonly permission: string;
  readonly body?: Record<string, unknown>;
}

suite('Workflow API authorization', () => {
  let fixture: WorkflowApiFixture;
  let seeded: { readonly definitionId: string; readonly instanceId: string };
  let workflowVersionId: string;
  let group: { readonly approvalGroupId: string; readonly approvalGroupMemberId: string };

  beforeAll(async () => {
    fixture = await openWorkflowApi();
  });

  afterAll(async () => {
    await fixture.close();
  });

  /**
   * One published workflow and one running approval, built with every permission.
   *
   * The routes below are then exercised against applications holding *one* permission each. Seeding
   * with the full set is deliberate: a 403 must come from the route under test, not from a setup
   * step the narrow application could not perform.
   */
  beforeEach(async () => {
    await fixture.truncate();

    const full = await fixture.applicationFor(
      TENANT_A,
      permitting(...ALL_WORKFLOW_PERMISSIONS),
      APPROVER,
    );
    const running = await runningApproval(full, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });

    seeded = { definitionId: running.definitionId, instanceId: running.instanceId };
    workflowVersionId = running.workflowVersionId;
    group = await anApprovalGroup(full, [APPROVER]);
  });

  /** Every route, with the one permission its handler declares. Seventeen, one per handler. */
  const routes = (): readonly Route[] => [
    { method: 'get', path: '/definitions', permission: WorkflowPermissions.definitionRead },
    {
      method: 'post',
      path: '/definitions',
      permission: WorkflowPermissions.definitionManage,
      body: {
        code: `guard-${uuidV7().slice(0, 8)}`,
        name: { en: 'Guarded', ar: 'محمي' },
        subjectType: UNADOPTED,
      },
    },
    {
      method: 'get',
      path: `/definitions/${seeded.definitionId}`,
      permission: WorkflowPermissions.definitionRead,
    },
    {
      method: 'post',
      path: `/definitions/${seeded.definitionId}/retirement`,
      permission: WorkflowPermissions.definitionManage,
      body: { expectedVersion: 1 },
    },
    {
      method: 'post',
      path: `/definitions/${seeded.definitionId}/versions`,
      permission: WorkflowPermissions.definitionManage,
      body: {},
    },
    {
      method: 'post',
      path: `/versions/${workflowVersionId}/steps`,
      permission: WorkflowPermissions.definitionManage,
      body: { ordinal: 2, name: { en: 'Second', ar: 'ثانٍ' }, approverMembershipId: APPROVER },
    },
    {
      method: 'post',
      path: `/versions/${workflowVersionId}/publication`,
      permission: WorkflowPermissions.definitionManage,
      body: { expectedVersion: 2 },
    },
    {
      method: 'post',
      path: `/versions/${workflowVersionId}/archive`,
      permission: WorkflowPermissions.definitionManage,
      body: { expectedVersion: 2 },
    },
    { method: 'get', path: '/instances', permission: WorkflowPermissions.instanceRead },
    {
      method: 'post',
      path: '/instances',
      permission: WorkflowPermissions.instanceStart,
      body: { definitionId: seeded.definitionId, subjectType: UNADOPTED, subjectId: uuidV7() },
    },
    {
      method: 'get',
      path: `/instances/${seeded.instanceId}`,
      permission: WorkflowPermissions.instanceRead,
    },
    {
      method: 'get',
      path: `/instances/${seeded.instanceId}/history`,
      permission: WorkflowPermissions.instanceRead,
    },
    {
      method: 'post',
      path: `/instances/${seeded.instanceId}/cancellation`,
      permission: WorkflowPermissions.instanceCancel,
      body: { reason: 'no longer needed', expectedVersion: 1 },
    },
    { method: 'get', path: '/approvals/pending', permission: WorkflowPermissions.approvalReadOwn },
    { method: 'get', path: '/approvals/decided', permission: WorkflowPermissions.approvalReadOwn },
    {
      method: 'get',
      path: `/approvals/${seeded.instanceId}/status`,
      permission: WorkflowPermissions.instanceRead,
    },
    {
      method: 'post',
      path: `/approvals/${seeded.instanceId}/decision`,
      permission: WorkflowPermissions.approvalDecide,
      body: { decision: 'approved', expectedVersion: 1 },
    },
    { method: 'get', path: '/approval-groups', permission: WorkflowPermissions.groupRead },
    {
      method: 'post',
      path: '/approval-groups',
      permission: WorkflowPermissions.groupManage,
      body: {
        code: `guarded-${uuidV7().slice(0, 8)}`,
        name: { en: 'Guarded list', ar: 'قائمة محمية' },
      },
    },
    {
      method: 'get',
      path: `/approval-groups/${group.approvalGroupId}`,
      permission: WorkflowPermissions.groupRead,
    },
    {
      method: 'post',
      path: `/approval-groups/${group.approvalGroupId}/members`,
      permission: WorkflowPermissions.groupManage,
      body: { membershipId: uuidV7() },
    },
    {
      method: 'delete',
      path: `/approval-groups/members/${group.approvalGroupMemberId}`,
      permission: WorkflowPermissions.groupManage,
    },
  ];

  const call = async (
    application: INestApplication,
    route: Route,
  ): Promise<{ readonly status: number }> => {
    const agent = http(application);
    const response = await (route.method === 'get'
      ? agent.get(`${BASE}${route.path}`).send()
      : route.method === 'delete'
        ? agent.delete(`${BASE}${route.path}`).send()
        : agent.post(`${BASE}${route.path}`).send(route.body ?? {}));

    return { status: response.status };
  };

  it('covers every one of the twenty-two handlers exactly once', () => {
    const declared = routes();

    expect(declared).toHaveLength(22);
    expect(new Set(declared.map((route) => `${route.method} ${route.path}`)).size).toBe(22);
    for (const route of declared) {
      expect(ALL_WORKFLOW_PERMISSIONS).toContain(route.permission);
    }
  });

  it('opens each route with the permission its handler declares', async () => {
    for (const route of routes()) {
      const application = await fixture.applicationFor(
        TENANT_A,
        permitting(route.permission),
        APPROVER,
      );
      const { status } = await call(application, route);

      expect([
        route.path,
        status < 400 || status === 404 || status === 409 || status === 422,
      ]).toEqual([route.path, true]);
    }
  });

  /**
   * **Every other Workflow permission, and still 403.**
   *
   * The strongest of the three questions: a caller holding six of the seven is refused, so a handler
   * wired to a neighbouring constant fails here rather than shipping.
   */
  it('refuses each route to a caller holding every other Workflow permission', async () => {
    for (const route of routes()) {
      const others = ALL_WORKFLOW_PERMISSIONS.filter(
        (permission) => permission !== route.permission,
      );
      const application = await fixture.applicationFor(TENANT_A, permitting(...others), APPROVER);
      const { status } = await call(application, route);

      expect([route.path, status]).toEqual([route.path, 403]);
    }
  });

  it('refuses each route to a caller holding nothing at all', async () => {
    for (const route of routes()) {
      const application = await fixture.applicationFor(TENANT_A, permitting(), APPROVER);
      const { status } = await call(application, route);

      expect([route.path, status]).toEqual([route.path, 403]);
    }
  });

  describe('the separations that matter', () => {
    it('does not let the person who raises an approval cancel one', async () => {
      const application = await fixture.applicationFor(
        TENANT_A,
        permitting(WorkflowPermissions.instanceStart, WorkflowPermissions.instanceRead),
        APPROVER,
      );
      const response = await http(application)
        .post(`${BASE}/instances/${seeded.instanceId}/cancellation`)
        .send({ reason: 'withdrawn', expectedVersion: 1 });

      expect(response.status).toBe(403);
    });

    it('does not let a reader of approvals decide one', async () => {
      const application = await fixture.applicationFor(
        TENANT_A,
        permitting(WorkflowPermissions.instanceRead),
        APPROVER,
      );
      const response = await http(application)
        .post(`${BASE}/approvals/${seeded.instanceId}/decision`)
        .send({ decision: 'approved', expectedVersion: 1 });

      expect(response.status).toBe(403);
    });

    it('does not let somebody who can see their queue decide from it', async () => {
      const application = await fixture.applicationFor(
        TENANT_A,
        permitting(WorkflowPermissions.approvalReadOwn),
        APPROVER,
      );
      const queue = await http(application).get(`${BASE}/approvals/pending`).send();
      const decision = await http(application)
        .post(`${BASE}/approvals/${seeded.instanceId}/decision`)
        .send({ decision: 'approved', expectedVersion: 1 });

      expect(queue.status).toBe(200);
      expect(decision.status).toBe(403);
    });

    /** And deciding does not require the queue: the two are independent, not a ladder. */
    it('lets somebody decide without being able to read their queue', async () => {
      const application = await fixture.applicationFor(
        TENANT_A,
        permitting(WorkflowPermissions.approvalDecide),
        APPROVER,
      );
      const queue = await http(application).get(`${BASE}/approvals/pending`).send();
      const decision = await http(application)
        .post(`${BASE}/approvals/${seeded.instanceId}/decision`)
        .send({ decision: 'approved', expectedVersion: 1 });

      expect(queue.status).toBe(403);
      expect(decision.status).toBe(201);
    });
  });

  /**
   * **Shape is checked at the edge; permission is checked in the pipeline.**
   *
   * A malformed body earns a 400 before the handler's permission is consulted, because the global
   * `ValidationPipe` runs on the controller argument and the permission check lives in the CQRS
   * pipeline behind it. That order is the repository's, not this module's, and it discloses nothing:
   * a 400 says only that the caller's own bytes were wrong.
   *
   * What *is* checked first is the tenant guard — an unauthenticated request never reaches either.
   */
  it('answers a malformed body before consulting the handler’s permission', async () => {
    const application = await fixture.applicationFor(TENANT_A, permitting(), APPROVER);
    const response = await http(application)
      .post(`${BASE}/approvals/${seeded.instanceId}/decision`)
      .send({ decision: 'not-a-decision', expectedVersion: 'not-a-number' });

    expect(response.status).toBe(400);
  });

  /** A well-formed body from a caller with nothing, however, is 403 and never 400. */
  it('answers a well-formed body from an unpermitted caller with 403', async () => {
    const application = await fixture.applicationFor(TENANT_A, permitting(), APPROVER);
    const response = await http(application)
      .post(`${BASE}/approvals/${seeded.instanceId}/decision`)
      .send({ decision: 'approved', expectedVersion: 1 });

    expect(response.status).toBe(403);
    expect((response.body as { detail?: string }).detail).toBe(
      'Requires workflow.approval.decide.',
    );
  });

  /** And an unauthenticated request is refused before anything else looks at it. */
  it('refuses an unauthenticated request without reaching validation', async () => {
    const application = await fixture.applicationFor(
      TENANT_A,
      permitting(...ALL_WORKFLOW_PERMISSIONS),
      APPROVER,
    );
    const response = await http(application)
      .post(`${BASE}/approvals/${seeded.instanceId}/decision`)
      .set('x-test-actor', 'none')
      .send({ decision: 'not-a-decision' });

    expect(response.status).toBe(401);
  });
});
