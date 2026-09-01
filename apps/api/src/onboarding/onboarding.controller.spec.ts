import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  OnboardingDispatcher,
  OnboardingExportController,
  OnboardingLifecycleController,
  OnboardingPermissions,
  OnboardingsController,
  PlanVersionsController,
  PlansController,
  ReconciliationController,
  TasksController,
  inMemoryOnboardingStores,
  onboardingModule,
} from '@work/onboarding';
import { FakeEmployment, FakePeople } from '@work/onboarding/testing';
import { InMemoryUnitOfWork } from '@work/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * API tests for the Onboarding endpoints.
 *
 * They exercise the real composition — the real dispatcher, the real pipeline, the real global
 * filter and validation pipe — because routing, prefixes and global filters are exactly where a test
 * that configured things slightly differently from production proves nothing about it.
 *
 * The route ordering assertion is not decoration. `GET /onboarding/reconciliation` and
 * `GET /onboarding/export` are each one segment after `/onboarding`, and the plan-version controller
 * claims that bare prefix — so a controller declared in the wrong order makes one of them resolve to
 * the other, and no unit test would notice.
 *
 * The tenant context is established by a stand-in rather than by the real middleware:
 * `tenant.middleware.spec.ts` is where that is tested, and repeating it here would make these tests
 * fail for reasons unrelated to the endpoints.
 */

const TENANT = uuidV7();

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

const ALL = Object.values(OnboardingPermissions);

interface Wired {
  readonly application: INestApplication;
  readonly people: FakePeople;
  readonly employment: FakeEmployment;
}

const applicationWith = async (checker: PermissionChecker): Promise<Wired> => {
  const dispatcher = new Dispatcher(checker);
  const people = new FakePeople();
  const employment = new FakeEmployment();
  const module = onboardingModule(
    {
      unitOfWork: new InMemoryUnitOfWork(TENANT),
      stores: inMemoryOnboardingStores(),
      employment,
      people,
      clock: { now: () => new Date('2026-08-10T09:00:00Z') },
    },
    // The same deferred seam the composition root uses, so reconciliation goes through the real
    // dispatcher here too rather than a shortcut only the tests have.
    { send: (command) => dispatcher.send(command) },
  );

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }

  const testing = await Test.createTestingModule({
    // The same order the Nest module declares, because that order is what makes
    // `GET /onboarding/reconciliation` resolve to reconciliation rather than to a plan version.
    controllers: [
      OnboardingExportController,
      ReconciliationController,
      PlansController,
      OnboardingLifecycleController,
      OnboardingsController,
      TasksController,
      PlanVersionsController,
    ],
    providers: [
      { provide: OnboardingDispatcher, useValue: new OnboardingDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();

  const application = testing.createNestApplication();

  application.use((_request: unknown, _response: unknown, next: () => void) => {
    runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:test' }, next);
  });
  configureApplication(application, environment);
  await application.init();
  return { application, people, employment };
};

describe('the Onboarding endpoints', () => {
  let wired: Wired | undefined;

  afterEach(async () => {
    await wired?.application.close();
    wired = undefined;
  });

  const server = (): Server => wired?.application.getHttpServer() as Server;

  const openApplication = async (granted: readonly string[] = ALL): Promise<Wired> => {
    wired = await applicationWith(permitting(...granted));
    return wired;
  };

  const anEmployment = (): string =>
    wired?.employment.add({ personId: wired.people.add() }).employmentId ?? '';

  /** A plan with one required task, published through the endpoints a customer would use. */
  const aPublishedPlan = async (): Promise<string> => {
    const plan = await request(server())
      .post('/api/v1/onboarding/plans')
      .send({ code: 'joiner', name: { en: 'Joiner', ar: 'منضم' } })
      .expect(201);
    const planId = (plan.body as { planId: string }).planId;
    const version = await request(server())
      .post(`/api/v1/onboarding/plans/${planId}/versions`)
      .send({})
      .expect(201);
    const planVersionId = (version.body as { planVersionId: string }).planVersionId;

    await request(server())
      .post(`/api/v1/onboarding/plan-versions/${planVersionId}/templates`)
      .send({
        code: 'sign-contract',
        sequence: 1,
        title: { en: 'Sign the contract', ar: 'توقيع العقد' },
        kind: 'checklist',
        ownerKind: 'employee',
        dueAnchor: 'employment_start',
        dueOffsetDays: -3,
      })
      .expect(201);
    await request(server())
      .post(`/api/v1/onboarding/plan-versions/${planVersionId}/publication`)
      .send({ expectedVersion: 1 })
      .expect(201);
    return planId;
  };

  /**
   * The property the whole module rests on, at the edge a client actually retries against.
   *
   * A retried `POST` is a success naming the same onboarding — not a 409 the client has to
   * interpret, and not a second instance.
   */
  it('returns the same onboarding when the start request is retried', async () => {
    await openApplication();

    const planId = await aPublishedPlan();
    const employmentId = anEmployment();
    const first = await request(server())
      .post('/api/v1/onboarding/onboardings')
      .send({ employmentId, planId })
      .expect(201);
    const second = await request(server())
      .post('/api/v1/onboarding/onboardings')
      .send({ employmentId, planId })
      .expect(201);
    const before = first.body as { onboardingId: string; alreadyExisted: boolean };
    const after = second.body as { onboardingId: string; alreadyExisted: boolean };

    expect(before.alreadyExisted).toBe(false);
    expect(after.alreadyExisted).toBe(true);
    expect(after.onboardingId).toBe(before.onboardingId);
  });

  /**
   * Route ordering, asserted rather than assumed.
   *
   * If `PlanVersionsController` were declared first it would claim `/onboarding/:planId/...` shapes
   * and this would come back as something else entirely.
   */
  it('resolves reconciliation and the export ahead of the plan-version routes', async () => {
    await openApplication();

    const employmentId = anEmployment();
    const awaiting = await request(server()).get('/api/v1/onboarding/reconciliation').expect(200);
    const exported = await request(server()).get('/api/v1/onboarding/export').expect(200);

    expect(
      (awaiting.body as { employments: { employmentId: string }[] }).employments.map(
        (one) => one.employmentId,
      ),
    ).toContain(employmentId);
    expect((exported.body as { onboardings: unknown[] }).onboardings).toEqual([]);
  });

  it('refuses a body carrying a field the shape does not declare', async () => {
    await openApplication();

    await request(server())
      .post('/api/v1/onboarding/onboardings')
      .send({ employmentId: anEmployment(), startedBy: 'user:someone-else' })
      .expect(400);
  });

  /** A refused business rule is 422, not 400: resending the same bytes will always fail. */
  it('answers 422 when the domain refuses, and 400 when the request is malformed', async () => {
    await openApplication();

    const refused = await request(server())
      .post('/api/v1/onboarding/plans')
      .send({ code: 'joiner', name: { en: 'Joiner only' } })
      .expect(422);

    expect((refused.body as { detail?: string }).detail).toContain('text_requires_both_languages');

    await request(server())
      .post('/api/v1/onboarding/plans')
      .send({ code: 'not a code', name: { en: 'Joiner', ar: 'منضم' } })
      .expect(400);
  });

  /** Publishing is its own permission, and the edge is where a customer meets that fact. */
  it('answers 403 when the caller may draft a version but not publish it', async () => {
    await openApplication([
      OnboardingPermissions.planManage,
      OnboardingPermissions.planRead,
      OnboardingPermissions.read,
    ]);

    const plan = await request(server())
      .post('/api/v1/onboarding/plans')
      .send({ code: 'joiner', name: { en: 'Joiner', ar: 'منضم' } })
      .expect(201);
    const version = await request(server())
      .post(`/api/v1/onboarding/plans/${(plan.body as { planId: string }).planId}/versions`)
      .send({})
      .expect(201);

    await request(server())
      .post(
        `/api/v1/onboarding/plan-versions/${(version.body as { planVersionId: string }).planVersionId}/publication`,
      )
      .send({ expectedVersion: 1 })
      .expect(403);
  });

  /** An onboarding in no tenant is nobody's. A record that is not there is 404, never 403. */
  it('answers 404 for an onboarding that does not exist', async () => {
    await openApplication();

    await request(server()).get(`/api/v1/onboarding/onboardings/${uuidV7()}`).expect(404);
  });

  /**
   * Reconciliation through the edge: it detects the employment nothing started an onboarding for,
   * starts one, and a second call starts none.
   */
  it('reconciles employments with no onboarding, and never twice', async () => {
    await openApplication();

    const planId = await aPublishedPlan();

    anEmployment();

    const first = await request(server())
      .post('/api/v1/onboarding/reconciliation')
      .send({ planId })
      .expect(201);
    const second = await request(server())
      .post('/api/v1/onboarding/reconciliation')
      .send({ planId })
      .expect(201);

    expect((first.body as { started: number }).started).toBe(1);
    expect((second.body as { started: number }).started).toBe(0);
  });
});
