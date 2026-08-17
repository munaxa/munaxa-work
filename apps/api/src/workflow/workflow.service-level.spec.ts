import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
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
 * A service-level target over HTTP: configured, published, started, and read back.
 *
 * **The controller computes none of it.** A due time, a state and an overdue count are derived by
 * the application from two stored inputs and its own clock, and the API's whole contribution is a
 * validated wire shape on the way in and an unmodified view on the way out. There is no arithmetic
 * in a controller, no `Date.now()`, and no query parameter through which a client could choose the
 * instant its due-ness is judged against.
 *
 * **What is asserted at the edge is shape; what is asserted below it is meaning.** A fractional
 * count and an invented unit are 400s here because they are malformed rather than declined — the
 * request never reaches a handler. That a two-hour target falls due two hours after the step opens
 * is the domain's, tested there.
 *
 * Split from `workflow.routing.spec.ts` at the file-size budget, on the seam Phase 16C itself draws:
 * that file is about *who* is asked, this one about *how long* they are expected to take.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API service-level suite');

suite('the Workflow API, service-level targets', () => {
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

  const publishedStep = async (step: Record<string, unknown>): Promise<string> => {
    const drafted = await aDraftVersion(application, UNADOPTED);

    must(
      await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
        ordinal: 1,
        name: NAME,
        approverMembershipId: APPROVER,
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

  const stepOf = async (instanceId: string): Promise<Record<string, unknown>> => {
    const detail = must(await get(application, `/instances/${instanceId}`), 'reading the approval');
    const [step] = (detail as { steps: readonly Record<string, unknown>[] }).steps;

    if (step === undefined) throw new Error('The approval has no steps.');
    return step;
  };

  describe('configuring one', () => {
    it('publishes the target exactly as it was typed', async () => {
      const definitionId = await publishedStep({ serviceLevel: { count: 48, unit: 'hours' } });
      const read = must(await get(application, `/definitions/${definitionId}`), 'reading it');
      const steps = (read as { publishedSteps: readonly Record<string, unknown>[] }).publishedSteps;

      // Forty-eight hours, not two days. The same length of time is not the same sentence.
      expect(steps[0]?.['serviceLevel']).toStrictEqual({ count: 48, unit: 'hours' });
    });

    it('publishes no target where none was configured', async () => {
      const definitionId = await publishedStep({});
      const read = must(await get(application, `/definitions/${definitionId}`), 'reading it');
      const steps = (read as { publishedSteps: readonly Record<string, unknown>[] }).publishedSteps;

      expect(steps[0]?.['serviceLevel']).toBeUndefined();
    });

    /**
     * Malformed at the edge, so the request never reaches a handler.
     *
     * A fraction, a zero, a negative and an invented unit are all **400**s rather than 422s: the
     * body is wrong rather than the process being declined, and a client that sent `1.5 days` has a
     * bug rather than a question about working hours.
     */
    it.each([
      [{ count: 0, unit: 'hours' }],
      [{ count: -1, unit: 'days' }],
      [{ count: 1.5, unit: 'days' }],
      [{ count: 1, unit: 'minutes' }],
      [{ count: 2, unit: 'business-days' }],
      [{ count: 2, unit: 'weeks' }],
      [{ count: '2', unit: 'days' }],
      [{ unit: 'days' }],
      [{ count: 2 }],
    ])('refuses %o at the edge', async (serviceLevel) => {
      const drafted = await aDraftVersion(application, UNADOPTED);
      const refused = await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
        ordinal: 1,
        name: NAME,
        approverMembershipId: APPROVER,
        serviceLevel,
      });

      expect(refused.status).toBe(400);
    });

    /** And no field on the wire can carry anything derived, scheduled or expired. */
    it.each([
      ['dueAt', '2026-08-16T09:00:00.000Z'],
      ['expiresAt', '2026-08-16T09:00:00.000Z'],
      ['expired', true],
      ['breached', true],
      ['overdueByMinutes', 30],
      ['escalateAfter', 2],
      ['businessDays', true],
    ])('refuses %s outright', async (field, value) => {
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

  describe('once an approval is running', () => {
    const start = (definitionId: string, subjectId: string) =>
      post(asRequester, '/instances', { definitionId, subjectType: UNADOPTED, subjectId });

    it('reports the target, the instant it counts from, when it falls due, and its state', async () => {
      const definitionId = await publishedStep({ serviceLevel: { count: 2, unit: 'hours' } });
      const started = must(await start(definitionId, 'subject-1'), 'starting');
      const step = await stepOf(String(started.instanceId));
      const level = step['serviceLevel'] as Record<string, unknown>;

      expect(level['count']).toBe(2);
      expect(level['unit']).toBe('hours');
      expect(level['state']).toBe('within');
      // ISO instants, both of them, and the due time is exactly two hours after the awaiting one.
      const awaitingOn = Date.parse(String(level['awaitingOn']));
      const dueOn = Date.parse(String(level['dueOn']));

      expect(Number.isNaN(awaitingOn)).toBe(false);
      expect(dueOn - awaitingOn).toBe(2 * 60 * 60 * 1000);
      // Within its target, so there is nothing to report as overdue rather than a zero.
      expect(level['overdueByMinutes']).toBeUndefined();
    });

    /**
     * The clock starts when *this* step opens, not when the approval did.
     *
     * A second step nobody is waiting on yet carries its target and **no** instant, so its state is
     * `none` — which is a different sentence from "within its target" and the one a screen must show.
     */
    it('gives a step nobody is waiting on a target but no clock', async () => {
      const drafted = await aDraftVersion(application, UNADOPTED);

      for (const ordinal of [1, 2]) {
        must(
          await post(application, `/versions/${drafted.workflowVersionId}/steps`, {
            ordinal,
            name: NAME,
            approverMembershipId: APPROVER,
            serviceLevel: { count: 1, unit: 'days' },
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

      const started = must(await start(drafted.definitionId, 'subject-2'), 'starting');
      const detail = must(
        await get(application, `/instances/${String(started.instanceId)}`),
        'reading it',
      );
      const steps = (detail as { steps: readonly Record<string, unknown>[] }).steps;
      const second = steps[1]?.['serviceLevel'] as Record<string, unknown>;

      expect(second['state']).toBe('none');
      expect(second['awaitingOn']).toBeUndefined();
      expect(second['dueOn']).toBeUndefined();
    });

    it('carries the target onto the approver’s own queue row', async () => {
      const definitionId = await publishedStep({ serviceLevel: { count: 2, unit: 'days' } });

      must(await start(definitionId, 'subject-3'), 'starting');

      const queue = must(await get(application, '/approvals/pending'), 'the queue');
      const [row] = (queue as { items: readonly Record<string, unknown>[] }).items;

      expect(row?.['serviceLevel']).toMatchObject({ count: 2, unit: 'days', state: 'within' });
    });

    it('reports no target at all on a step configured without one', async () => {
      const definitionId = await publishedStep({});
      const started = must(await start(definitionId, 'subject-4'), 'starting');

      expect((await stepOf(String(started.instanceId)))['serviceLevel']).toBeUndefined();
    });

    /**
     * Reading twice gives the same answer, and no client can move the instant it is judged against.
     *
     * There is no `asOf` on this route and no query parameter that would take one — a client that
     * could choose the reading instant could report any step as within its target.
     */
    it('answers deterministically, with no client-supplied reading instant', async () => {
      const definitionId = await publishedStep({ serviceLevel: { count: 2, unit: 'hours' } });
      const started = must(await start(definitionId, 'subject-5'), 'starting');
      const first = await stepOf(String(started.instanceId));
      const second = await stepOf(String(started.instanceId));

      expect(second['serviceLevel']).toStrictEqual(first['serviceLevel']);

      // An `asOf` on the read is not honoured — the route declares no such parameter.
      const withInstant = must(
        await get(
          application,
          `/instances/${String(started.instanceId)}?asOf=2030-01-01T00:00:00.000Z`,
        ),
        'reading with an instant',
      );
      const [step] = (withInstant as { steps: readonly Record<string, unknown>[] }).steps;

      expect((step?.['serviceLevel'] as Record<string, unknown>)['state']).toBe('within');
    });

    /**
     * **Nothing derived is stored**, and the row is where that is settled.
     *
     * The response carries a due time and a state; the table carries a count, a unit and the instant
     * the step began waiting, and no column for any of the rest.
     */
    it('stores only the target and the awaiting instant, whatever the response shows', async () => {
      const definitionId = await publishedStep({ serviceLevel: { count: 2, unit: 'hours' } });

      must(await start(definitionId, 'subject-6'), 'starting');

      const rows = await fixture.rowsIn<{
        service_level_count: number;
        service_level_unit: string;
        awaiting_at: Date | null;
      }>(
        TENANT_A,
        'select service_level_count, service_level_unit, awaiting_at from workflow_step',
      );

      expect(rows[0]?.service_level_count).toBe(2);
      expect(rows[0]?.service_level_unit).toBe('hours');
      expect(rows[0]?.awaiting_at).toBeInstanceOf(Date);

      const columns = await fixture.inspect<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'workflow_step'`,
      );
      const named = columns.map((column) => column.column_name);

      for (const absent of ['due_at', 'expired', 'breached', 'overdue_at', 'elapsed_minutes']) {
        expect([absent, named.includes(absent)]).toStrictEqual([absent, false]);
      }
    });
  });
});
