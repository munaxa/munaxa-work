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
import { get, post, publishedWorkflow } from './workflow-api-scenario.js';

/**
 * What the edge refuses, before a handler is ever reached.
 *
 * The global `ValidationPipe` runs with `forbidNonWhitelisted`, so a request is refused for being
 * malformed — a 400 naming the field — rather than declined by the domain as a 422, and an
 * undeclared property is rejected rather than quietly dropped. In this module that last rule is not
 * a matter of tidiness: it is what stops a client from smuggling an approver, a delegate or an
 * "on behalf of" into a decision, because a body that could name its own approver could name
 * somebody else's.
 *
 * **No date is parsed anywhere here**, so there is no calendar to get wrong: Workflow holds only
 * instants, they leave as ISO strings, and no route accepts one.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API validation suite');

suite('what the Workflow API refuses at the edge', () => {
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
  const definition = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    code: `refused-${String((sequence += 1))}`,
    name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
    subjectType: UNADOPTED,
    ...overrides,
  });

  /**
   * An undeclared property is refused rather than dropped.
   *
   * In this module that is the difference between a rejected request and a client smuggling an
   * approver into a decision: `forbidNonWhitelisted` is what makes "no shape carries an identity"
   * a 400 rather than a convention.
   */
  it('refuses an unknown property on every body it accepts', async () => {
    const attempts = [
      await post(application, '/definitions', definition({ retiredAt: '2026-01-01' })),
      await post(application, '/instances', {
        definitionId: uuidV7(),
        subjectType: UNADOPTED,
        subjectId: 'subject',
        requestedByMembershipId: APPROVER,
      }),
      await post(application, `/approvals/${uuidV7()}/decision`, {
        decision: 'approved',
        expectedVersion: 1,
        onBehalfOfMembershipId: APPROVER,
      }),
      await post(application, `/approvals/${uuidV7()}/decision`, {
        decision: 'approved',
        expectedVersion: 1,
        decidedByMembershipId: APPROVER,
      }),
    ];

    for (const attempt of attempts) expect(attempt.status).toBe(400);
  });

  it('refuses a malformed identifier in the path', async () => {
    const attempts = [
      await get(application, '/definitions/not-a-uuid'),
      await get(application, '/instances/not-a-uuid'),
      await get(application, '/instances/not-a-uuid/history'),
      await get(application, '/approvals/not-a-uuid/status'),
      await post(application, '/approvals/not-a-uuid/decision', {
        decision: 'approved',
        expectedVersion: 1,
      }),
    ];

    for (const attempt of attempts) expect(attempt.status).toBe(400);
  });

  it('refuses a decision that is not one of the two', async () => {
    const outcome = await post(application, `/approvals/${uuidV7()}/decision`, {
      decision: 'maybe',
      expectedVersion: 1,
    });

    expect(outcome.status).toBe(400);
  });

  it('refuses a code, a subject type and a name the domain would not accept', async () => {
    const attempts = [
      await post(application, '/definitions', definition({ code: 'Requisition Approval' })),
      await post(application, '/definitions', definition({ subjectType: 'requisition' })),
      await post(application, '/definitions', definition({ name: { en: 'Only English' } })),
      await post(application, '/definitions', definition({ name: { en: '', ar: 'اعتماد' } })),
    ];

    for (const attempt of attempts) expect(attempt.status).toBe(400);
  });

  it('refuses a missing required value', async () => {
    const attempts = [
      await post(application, '/definitions', { code: 'no-name', subjectType: UNADOPTED }),
      await post(application, `/approvals/${uuidV7()}/decision`, { decision: 'approved' }),
      await post(application, `/instances/${uuidV7()}/cancellation`, { expectedVersion: 1 }),
      await post(application, '/instances', { definitionId: uuidV7(), subjectType: UNADOPTED }),
    ];

    for (const attempt of attempts) expect(attempt.status).toBe(400);
  });

  /** `NaN`, a decimal and a negative are all refused where a whole number belongs. */
  it('refuses a version or an ordinal that is not a whole number', async () => {
    const published = await publishedWorkflow(application, {
      approver: APPROVER,
      subjectType: UNADOPTED,
    });
    const attempts = [
      await post(application, `/definitions/${published.definitionId}/retirement`, {
        expectedVersion: Number.NaN,
      }),
      await post(application, `/definitions/${published.definitionId}/retirement`, {
        expectedVersion: 1.5,
      }),
      await post(application, `/definitions/${published.definitionId}/retirement`, {
        expectedVersion: -1,
      }),
      await post(application, `/versions/${published.workflowVersionId}/steps`, {
        ordinal: 0,
        name: { en: 'Zero', ar: 'صفر' },
        approverMembershipId: APPROVER,
      }),
    ];

    for (const attempt of attempts) expect(attempt.status).toBe(400);
  });

  /** An approver is a membership identifier, so a name where one belongs is refused. */
  it('refuses an approver that is not an identifier', async () => {
    const published = await publishedWorkflow(application, {
      approver: APPROVER,
      subjectType: UNADOPTED,
    });
    const outcome = await post(application, `/versions/${published.workflowVersionId}/steps`, {
      ordinal: 2,
      name: { en: 'Named', ar: 'مسمى' },
      approverMembershipId: 'the finance director',
    });

    expect(outcome.status).toBe(400);
  });
});
