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
 * What the wire returns, and what survives the round trip unchanged.
 *
 * Two things are asserted here and they are easy to confuse. **Paging** is the edge bounding a
 * collection and the total meaning what it says. **Exactness** is a value coming back as the value
 * that went in — an ordinal past a `smallint`, an identifier that is a string and stays one, an
 * instant that is the canonical representation the application published rather than one this layer
 * re-formatted. What the edge *refuses* is the third, and has a suite of its own.
 *
 * **No date is parsed anywhere in this module**, so there is no calendar to get wrong: Workflow holds
 * only instants, they leave as ISO strings, and no route accepts one.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API contract suite');

suite('the Workflow API contract', () => {
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

  let sequence = 0;
  // A counter rather than a slice of a uuid: v7 leads with a timestamp, so twelve identifiers minted
  // in one millisecond share their first eight characters — and twelve definitions would collide on
  // the uniqueness index while the test believed it was exercising paging.
  const definition = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    code: `contract-${String((sequence += 1))}`,
    name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
    subjectType: UNADOPTED,
    ...overrides,
  });

  describe('paging', () => {
    const twelve = async (): Promise<void> => {
      for (let index = 0; index < 12; index += 1) {
        await post(application, '/definitions', definition());
      }
    };

    it('bounds a page, counts the whole collection, and walks it exactly once', async () => {
      await twelve();

      const seen: string[] = [];
      let total = 0;

      for (const page of [1, 2, 3]) {
        const response = await get(application, `/definitions?page=${String(page)}&size=5`);

        expect(response.status).toBe(200);
        total = response.body['total'] as number;
        seen.push(
          ...(response.body['items'] as readonly Record<string, unknown>[]).map((item) =>
            String(item['definitionId']),
          ),
        );
      }

      expect(total).toBe(12);
      expect(seen).toHaveLength(12);
      // Deterministic order, no overlap, nothing skipped.
      expect(new Set(seen).size).toBe(12);
    });

    it('answers an empty page beyond the last, with the total still true', async () => {
      await twelve();

      const response = await get(application, '/definitions?page=99&size=5');

      expect(response.status).toBe(200);
      expect(response.body['items']).toEqual([]);
      expect(response.body['total']).toBe(12);
    });

    /**
     * A malformed page falls back rather than reaching a repository.
     *
     * `NaN`, zero, a negative and a decimal all fail the whole-number check at the edge, so `offset
     * NaN` — a driver error — cannot happen, and neither can an unbounded read.
     */
    it('falls back on a page or size that is not a whole number', async () => {
      await twelve();

      for (const query of [
        'page=abc&size=5',
        'page=0&size=5',
        'page=-1&size=5',
        'page=1.5&size=5',
        'page=1&size=abc',
        'page=1&size=0',
        'page=1&size=-3',
      ]) {
        const response = await get(application, `/definitions?${query}`);

        expect([query, response.status]).toEqual([query, 200]);
        expect([query, response.body['total']]).toEqual([query, 12]);
      }
    });

    /** And a size beyond the maximum is clamped rather than honoured. */
    it('clamps an enormous page size', async () => {
      await twelve();

      const response = await get(application, '/definitions?page=1&size=100000');

      expect(response.status).toBe(200);
      expect((response.body['items'] as readonly unknown[]).length).toBe(12);
    });

    it('pages the queue and the timeline the same way', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const queue = await get(application, '/approvals/pending?page=1&size=1');
      const history = await get(
        application,
        `/instances/${running.instanceId}/history?page=2&size=1`,
      );

      expect(queue.body['total']).toBe(1);
      expect(history.body['total']).toBe(2);
      expect((history.body['items'] as readonly Record<string, unknown>[])[0]?.['event']).toBe(
        'step-awaiting',
      );
    });
  });

  describe('exactness', () => {
    /**
     * An ordinal far past a `smallint` survives the wire.
     *
     * AD-004 forbids a hardcoded approval limit, so the DTO bounds the ordinal below and not above
     * and the column is an `integer`. `2147483000` is inside that range, far outside a `smallint`,
     * and past the point a `real` would start rounding — so a column or a DTO silently narrowed to
     * either fails here rather than in a tenant's fifty-thousandth step.
     */
    it('round-trips a large ordinal without rounding it', async () => {
      const created = await post(application, '/definitions', definition());
      const version = await post(
        application,
        `/definitions/${String(created.body.definitionId)}/versions`,
        {},
      );
      const workflowVersionId = String(version.body.workflowVersionId);

      // On the **draft**: a published version takes no more steps, which is AD-003 rather than a
      // limitation of this test.
      for (const ordinal of [1, 2_147_483_000]) {
        const added = await post(application, `/versions/${workflowVersionId}/steps`, {
          ordinal,
          name: { en: 'Far', ar: 'بعيد' },
          approverMembershipId: APPROVER,
        });

        expect([ordinal, added.status]).toEqual([ordinal, 201]);
      }

      const stored = await fixture.rowsIn<{ ordinal: number }>(
        TENANT_A,
        `select ordinal from workflow_step_template where workflow_version_id = $1 order by ordinal`,
        [workflowVersionId],
      );

      expect(stored.map((row) => row.ordinal)).toEqual([1, 2_147_483_000]);
      expect(Number.isInteger(stored[1]?.ordinal)).toBe(true);
    });

    /** And a published version refuses a further step, which is why the draft was used above. */
    it('refuses a step on a version that has been published', async () => {
      const published = await publishedWorkflow(application, {
        approver: APPROVER,
        subjectType: UNADOPTED,
      });
      const refused = await post(application, `/versions/${published.workflowVersionId}/steps`, {
        ordinal: 2,
        name: { en: 'Late', ar: 'متأخر' },
        approverMembershipId: APPROVER,
      });

      expect(refused.status).toBe(422);
      expect(refused.body['detail']).toBe('workflow.rejection.version-not-editable');
    });

    /** An identifier is a string on the wire, in the path and in the body. Nothing converts one. */
    it('keeps every identifier a string', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const read = await get(application, `/instances/${running.instanceId}`);
      const instance = read.body['instance'] as Record<string, unknown>;

      for (const key of ['instanceId', 'definitionId', 'workflowVersionId', 'subjectId']) {
        expect([key, typeof instance[key]]).toEqual([key, 'string']);
      }
      expect(instance['instanceId']).toBe(running.instanceId);
    });

    /** An instant is the canonical ISO string the application published, not one re-formatted here. */
    it('returns an instant exactly as the application published it', async () => {
      const running = await runningApproval(application, {
        approver: APPROVER,
        subjectId: uuidV7(),
        subjectType: UNADOPTED,
      });
      const read = await get(application, `/instances/${running.instanceId}`);
      const startedOn = String((read.body['instance'] as Record<string, unknown>)['startedOn']);

      expect(startedOn).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(startedOn).toISOString()).toBe(startedOn);
    });

    /** A version number is a whole number and comes back as one. */
    it('keeps a version number whole', async () => {
      const published = await publishedWorkflow(application, {
        approver: APPROVER,
        subjectType: UNADOPTED,
      });
      const read = await get(application, `/definitions/${published.definitionId}`);
      const versions = read.body['versions'] as readonly Record<string, unknown>[];

      expect(versions[0]?.['versionNumber']).toBe(1);
      expect(Number.isInteger(versions[0]?.['version'])).toBe(true);
    });
  });

  /** Nothing internal leaves: no row, no aggregate, no SQL, no stack. */
  it('returns published views and Problem Details, and nothing else', async () => {
    const missing = await get(application, `/instances/${uuidV7()}`);

    expect(missing.status).toBe(404);
    expect(missing.body['type']).toBe('about:blank');
    expect(missing.body['detail']).toBe('No such workflow-instance.');
    expect(Object.keys(missing.body)).not.toContain('stack');

    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });
    const read = await get(application, `/instances/${running.instanceId}`);
    const instance = read.body['instance'] as Record<string, unknown>;

    // Published view field names, not column names.
    for (const column of ['tenant_id', 'created_at', 'created_by', 'deleted_at', 'started_at']) {
      expect(Object.keys(instance)).not.toContain(column);
    }
  });
});
