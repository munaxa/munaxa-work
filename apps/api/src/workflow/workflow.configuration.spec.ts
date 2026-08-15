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
 * Configuring a process, over HTTP: a definition, a draft version, its steps, and publication.
 *
 * This is the half of the lifecycle an administrator does before anybody is ever asked to decide
 * anything, and it is separated from the deciding half because the two answer different questions.
 * Here the subject is the *shape* of an approval — what it is about, who is asked, in what order,
 * and when that shape becomes usable; there, the subject is a person answering one.
 *
 * **Every layer below the request is the production one**: the real controllers, the real global
 * validation pipe and Problem Details filter, the real dispatcher, the real handlers and the real
 * PostgreSQL repositories.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow API configuration suite');

suite('the Workflow API, configuring a process', () => {
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

  it('creates a definition, drafts a version, adds a step and publishes it', async () => {
    const published = await publishedWorkflow(application, { approver: APPROVER });
    const read = await get(application, `/definitions/${published.definitionId}`);

    expect(read.status).toBe(200);

    const definition = read.body['definition'] as Record<string, unknown>;

    expect(definition['status']).toBe('active');
    expect(definition['subjectType']).toBe('recruitment.requisition');
    // The identifier is a string on the wire and stays one. Nothing rounds an identifier.
    expect(typeof definition['definitionId']).toBe('string');
    expect(definition['definitionId']).toBe(published.definitionId);

    const versions = read.body['versions'] as readonly Record<string, unknown>[];

    expect(versions).toHaveLength(1);
    expect(versions[0]?.['status']).toBe('published');
    // Derived, never supplied: no route accepts a version number.
    expect(versions[0]?.['versionNumber']).toBe(1);
  });

  /** A version with no steps publishes nothing: a process with nothing to approve is not one. */
  it('refuses to publish a version with no steps', async () => {
    const definition = await post(application, '/definitions', {
      code: 'empty-approval',
      name: { en: 'Empty', ar: 'فارغ' },
      subjectType: 'recruitment.requisition',
    });
    const version = await post(
      application,
      `/definitions/${String(definition.body.definitionId)}/versions`,
      {},
    );
    const published = await post(
      application,
      `/versions/${String(version.body.workflowVersionId)}/publication`,
      { expectedVersion: 1 },
    );

    expect(published.status).toBe(422);
    expect(published.body['detail']).toBe('workflow.rejection.version-has-no-steps');
  });

  /** Retirement is terminal and stops nothing already running. */
  it('retires a definition without touching an approval already under way', async () => {
    const running = await runningApproval(application, {
      approver: APPROVER,
      subjectId: uuidV7(),
      subjectType: UNADOPTED,
    });
    const retired = await post(application, `/definitions/${running.definitionId}/retirement`, {
      expectedVersion: 1,
    });

    expect(retired.status).toBe(201);

    const instance = await get(application, `/instances/${running.instanceId}`);

    expect((instance.body['instance'] as Record<string, unknown>)['status']).toBe('running');
  });
});
