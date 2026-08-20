import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
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
import {
  MANAGER,
  MANAGER_EMPLOYMENT,
  REQUESTER_EMPLOYMENT,
  seedReportingLine,
} from './workflow-cross-module-world.js';
import { NAME, aDraftVersion, get, must, post } from './workflow-api-scenario.js';

/**
 * Phase 16C over HTTP: configuring a manager step and a service-level target, and reading back what
 * a running approval made of them.
 *
 * **Every layer below the request is the production one.** The real controllers, the real global
 * validation pipe and Problem Details filter, the real dispatcher, the real handlers, the real
 * PostgreSQL repositories — and, for the manager, the real `WorkflowReportingLine` adapter reaching
 * the real Identity and Employment modules over the same dispatcher. Nothing on the path is a stub.
 *
 * **The controller does none of this.** It does not resolve a manager, does not compute a due time,
 * and could not: resolution happens once, three layers away, when the instance starts, and due-ness
 * is derived by the application from stored inputs and its own clock. What the API adds is a wire
 * shape and a validation boundary, which is what the two groups below are about.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API routing suite');

suite('the Workflow API, routing and service levels', () => {
  let fixture: WorkflowApiFixture;
  let application: INestApplication;
  let asRequester: INestApplication;
  let asManager: INestApplication;
  let asDeputy: INestApplication;

  /**
   * One application per membership, because a membership is bound to the application rather than
   * sent on a request — which is the whole point. There is no header, body field or query parameter
   * through which a caller could act as somebody else, so acting as somebody else means a different
   * authenticated application.
   */
  beforeAll(async () => {
    fixture = await openWorkflowApi();

    const everything = permitting(...ALL_WORKFLOW_PERMISSIONS);

    application = await fixture.applicationFor(TENANT_A, everything, APPROVER);
    asRequester = await fixture.applicationFor(TENANT_A, everything, REQUESTER);
    asManager = await fixture.applicationFor(TENANT_A, everything, MANAGER);
    asDeputy = await fixture.applicationFor(TENANT_A, everything, DEPUTY);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** A published process whose only step is configured however the case needs. */
  const publishedStep = async (step: Record<string, unknown>): Promise<string> => {
    const drafted = await aDraftVersion(application, UNADOPTED);

    must(
      await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
        ordinal: 1,
        name: NAME,
        ...step,
      }),
      'adding a step',
    );
    must(
      await post(application, `/versions/${drafted.workflowVersionId}/publication`, {
        expectedVersion: 1,
      }),
      'publishing',
    );

    return drafted.definitionId;
  };

  const start = (definitionId: string, subjectId: string) =>
    post(asRequester, '/instances', { definitionId, subjectType: UNADOPTED, subjectId });

  describe('configuring a manager step', () => {
    it('publishes a template that names nobody, and says so', async () => {
      const definitionId = await publishedStep({ routeToRequestersManager: true });
      const read = must(await get(application, `/definitions/${definitionId}`), 'reading it');
      const steps = (read as { publishedSteps: readonly Record<string, unknown>[] }).publishedSteps;

      expect(steps[0]?.['approverKind']).toBe('manager');
      expect(steps[0]?.['approverMembershipId']).toBeUndefined();
      expect(steps[0]?.['approverGroupId']).toBeUndefined();
    });

    /**
     * `false` is an omission, not a third state.
     *
     * A client that sends the flag off has configured nothing, and the step then names neither a
     * person nor a group — which is the domain's `step-approver-required`, a 422, rather than a
     * manager step nobody asked for.
     */
    it('treats the flag set to false exactly as its absence', async () => {
      const drafted = await aDraftVersion(application, UNADOPTED);
      const refused = await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
        ordinal: 1,
        name: NAME,
        routeToRequestersManager: false,
      });

      expect(refused.status).toBe(422);
    });

    /**
     * A manager and a person together is the domain's refusal, not a 400: both are well formed, and
     * which one the caller meant is a question about the process they are configuring.
     */
    it('refuses a manager step that also names a membership', async () => {
      const drafted = await aDraftVersion(application, UNADOPTED);
      const refused = await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
        ordinal: 1,
        name: NAME,
        routeToRequestersManager: true,
        approverMembershipId: APPROVER,
      });

      expect(refused.status).toBe(422);
    });

    /**
     * A manager and a **real** group together is the same refusal.
     *
     * The group is created first on purpose: a step naming a group that does not exist is a 404
     * from the existence check, which would make this assertion pass for the wrong reason and say
     * nothing about approver coherence.
     */
    it('refuses a manager step that also names a group', async () => {
      const group = must(
        await post(application, '/approval-groups', {
          code: `coherence-${String(Date.now() % 100000)}`,
          name: NAME,
        }),
        'creating a group',
      );
      const drafted = await aDraftVersion(application, UNADOPTED);
      const refused = await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
        ordinal: 1,
        name: NAME,
        routeToRequestersManager: true,
        approverGroupId: String(group.approvalGroupId),
      });

      expect(refused.status).toBe(422);
    });

    /**
     * The kind itself is still unsendable, and now it matters more than it did in 16B.
     *
     * `forbidNonWhitelisted` refuses `approverKind` outright, so a client cannot declare `manager`
     * with an identifier beside it, and `role` and `external` have no field to arrive in at all.
     */
    it.each([
      ['approverKind', 'manager'],
      ['approverKind', 'role'],
      ['managerEmploymentId', MANAGER_EMPLOYMENT],
      ['managerMembershipId', MANAGER],
      ['workforceUserId', MANAGER],
      ['platformUserId', 'platform:somebody'],
      ['roleId', 'director'],
    ])('refuses %s on the wire, before anything reads it', async (field, value) => {
      const drafted = await aDraftVersion(application, UNADOPTED);
      const refused = await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
        ordinal: 1,
        name: NAME,
        approverMembershipId: APPROVER,
        [field]: value,
      });

      expect(refused.status).toBe(400);
    });
  });

  describe('a manager step, once an approval is running', () => {
    beforeEach(async () => {
      await seedReportingLine(fixture.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: { managerEmploymentId: MANAGER_EMPLOYMENT, managerMembershipIds: [MANAGER] },
      });
    });

    it('exposes the resolved manager as an ordinary membership approver', async () => {
      const definitionId = await publishedStep({ routeToRequestersManager: true });
      const started = must(await start(definitionId, 'subject-1'), 'starting');
      const detail = must(
        await get(application, `/instances/${String(started.instanceId)}`),
        'reading it',
      );
      const steps = (detail as { steps: readonly Record<string, unknown>[] }).steps;

      expect(steps[0]?.['approverMembershipId']).toBe(MANAGER);
      expect(steps[0]?.['approverKind']).toBe('membership');
      expect(steps[0]?.['status']).toBe('awaiting');
    });

    /**
     * **Nothing about how the manager was found reaches the wire.**
     *
     * No employment identifier, no reporting line, no `asOf`, no chain. A running step names a
     * person, and a client reading one cannot tell whether a tenant typed that person's identifier
     * or an organization chart produced it — which is exactly the property the snapshot buys.
     */
    it('exposes no employment identifier and no reporting-line detail', async () => {
      const definitionId = await publishedStep({ routeToRequestersManager: true });
      const started = must(await start(definitionId, 'subject-2'), 'starting');
      const detail = must(
        await get(application, `/instances/${String(started.instanceId)}`),
        'reading it',
      );
      const body = JSON.stringify(detail);

      for (const leaked of [MANAGER_EMPLOYMENT, REQUESTER_EMPLOYMENT, 'employment', 'reporting']) {
        expect([leaked, body.includes(leaked)]).toStrictEqual([leaked, false]);
      }
    });

    it('puts it on the manager’s own queue and on nobody else’s', async () => {
      const definitionId = await publishedStep({ routeToRequestersManager: true });

      must(await start(definitionId, 'subject-3'), 'starting');

      const theirs = must(await get(asManager, '/approvals/pending'), 'the manager’s queue');
      const somebodyElse = must(await get(asDeputy, '/approvals/pending'), 'another queue');

      expect((theirs as { total: number }).total).toBe(1);
      expect((somebodyElse as { total: number }).total).toBe(0);
    });

    /** A reorganization afterwards does not reach a running approval; a new one gets the new manager. */
    it('keeps the manager it started with, and gives a later approval the new one', async () => {
      const definitionId = await publishedStep({ routeToRequestersManager: true });
      const started = must(await start(definitionId, 'subject-4'), 'starting');

      // The line moves *and* the outgoing manager's link to that employment goes with it. Leaving
      // it would make the job held by two people, which is a different case with its own test.
      await fixture.owner.query('delete from employment_reporting_line where tenant_id = $1', [
        TENANT_A,
      ]);
      await fixture.owner.query(
        'delete from employment_link where tenant_id = $1 and membership_id = $2',
        [TENANT_A, MANAGER],
      );
      await seedReportingLine(fixture.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: { managerEmploymentId: MANAGER_EMPLOYMENT, managerMembershipIds: [DEPUTY] },
      });

      const detail = must(
        await get(application, `/instances/${String(started.instanceId)}`),
        'reading it',
      );

      expect(
        (detail as { steps: readonly Record<string, unknown>[] }).steps[0]?.[
          'approverMembershipId'
        ],
      ).toBe(MANAGER);

      const later = must(await start(definitionId, 'subject-5'), 'starting a second');
      const second = must(
        await get(application, `/instances/${String(later.instanceId)}`),
        'reading the second',
      );

      expect(
        (second as { steps: readonly Record<string, unknown>[] }).steps[0]?.[
          'approverMembershipId'
        ],
      ).toBe(DEPUTY);
    });
  });

  /**
   * Two people hold the manager's employment, so the approval does not start (B-1).
   *
   * The refusal is a 422 — the request is well formed and the organization is ambiguous — and the
   * whole start is refused, so nothing exists afterwards for anybody to find.
   */
  describe('when the manager is ambiguous', () => {
    it('refuses the start and writes nothing at all', async () => {
      await seedReportingLine(fixture.owner, {
        tenantId: TENANT_A,
        requesterMembershipId: REQUESTER,
        requesterEmploymentId: REQUESTER_EMPLOYMENT,
        line: {
          managerEmploymentId: MANAGER_EMPLOYMENT,
          managerMembershipIds: [MANAGER, DEPUTY],
        },
      });

      const definitionId = await publishedStep({ routeToRequestersManager: true });
      const refused = await start(definitionId, 'subject-6');

      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body)).toContain('manager-membership-ambiguous');

      const found = must(await get(application, '/instances?subjectId=subject-6'), 'searching');

      expect((found as { total: number }).total).toBe(0);

      const rows = await fixture.rowsIn(TENANT_A, 'select id from workflow_step');
      const timeline = await fixture.rowsIn(TENANT_A, 'select id from workflow_history');

      expect(rows).toStrictEqual([]);
      expect(timeline).toStrictEqual([]);

      const queue = must(await get(asManager, '/approvals/pending'), 'the queue');

      expect((queue as { total: number }).total).toBe(0);
    });
  });
});
