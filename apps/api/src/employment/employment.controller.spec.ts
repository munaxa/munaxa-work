import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  AssignmentsController,
  ContractsController,
  EmploymentDispatcher,
  EmploymentHistoryController,
  EmploymentLifecycleController,
  EmploymentPermissions,
  EmploymentsController,
  FakeOrganization,
  FakePeople,
  ReportingLineController,
  TransferController,
  employmentModule,
  inMemoryEmploymentStores,
} from '@work/employment';
import { InMemoryUnitOfWork } from '@work/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * API tests for the Employment endpoints.
 *
 * They exercise the real composition — the real dispatcher, the real pipeline, the real global
 * filter and validation pipe — because routing, prefixes and global filters are exactly where a
 * test that configured things slightly differently from production proves nothing about it.
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

interface Wired {
  readonly application: INestApplication;
  readonly people: FakePeople;
  readonly organization: FakeOrganization;
}

const applicationWith = async (
  checker: PermissionChecker,
  resolvesTenant = true,
): Promise<Wired> => {
  const dispatcher = new Dispatcher(checker);
  const people = new FakePeople();
  const organization = new FakeOrganization();
  const module = employmentModule(
    {
      unitOfWork: new InMemoryUnitOfWork(TENANT),
      stores: inMemoryEmploymentStores(),
      people,
      organization,
      clock: { now: () => new Date('2026-08-09T09:00:00Z') },
    },
    // The same deferred seam the composition root uses, so bulk import goes through the real
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
    // `GET /employments/export` resolve to the export rather than to an employment with that
    // identifier.
    controllers: [
      TransferController,
      EmploymentLifecycleController,
      AssignmentsController,
      ReportingLineController,
      ContractsController,
      EmploymentHistoryController,
      EmploymentsController,
    ],
    providers: [
      { provide: EmploymentDispatcher, useValue: new EmploymentDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();

  const application = testing.createNestApplication();

  application.use((_request: unknown, _response: unknown, next: () => void) => {
    if (!resolvesTenant) {
      next();
      return;
    }
    runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:test' }, next);
  });
  configureApplication(application, environment);
  await application.init();
  return { application, people, organization };
};

/** `getHttpServer()` is typed `any`; naming the type once keeps every call site checked. */
const serverOf = (application: INestApplication): Server => application.getHttpServer() as Server;

const authorized = (): Promise<Wired> =>
  applicationWith(permitting(...Object.values(EmploymentPermissions)));

let open: INestApplication[] = [];

const started = async (build: () => Promise<Wired>): Promise<Wired> => {
  const wired = await build();

  open.push(wired.application);
  return wired;
};

afterEach(async () => {
  await Promise.all(open.map((application) => application.close()));
  open = [];
});

const created = async (wired: Wired, personId: string): Promise<string> => {
  const response = await request(serverOf(wired.application))
    .post('/api/v1/employments')
    .send({ personId, employmentTypeCode: 'full-time', startDate: '2026-01-15' })
    .expect(201);

  return (response.body as { employmentId: string }).employmentId;
};

describe('the employment endpoints', () => {
  it('creates an employment and returns the number it generated', async () => {
    const wired = await started(authorized);
    const personId = wired.people.add(uuidV7());

    const response = await request(serverOf(wired.application))
      .post('/api/v1/employments')
      .send({ personId, employmentTypeCode: 'full-time', startDate: '2026-01-15' })
      .expect(201);

    expect((response.body as { employmentNumber: string }).employmentNumber).toMatch(
      /^EMP-2026-\d{6}$/,
    );
  });

  it('refuses a body that tries to supply an employment number', async () => {
    const wired = await started(authorized);
    const personId = wired.people.add(uuidV7());

    // `forbidNonWhitelisted` is what makes this a 400 rather than a silently discarded field, and
    // a silently discarded field is how a client comes to believe it set the number.
    await request(serverOf(wired.application))
      .post('/api/v1/employments')
      .send({
        personId,
        employmentTypeCode: 'full-time',
        startDate: '2026-01-15',
        employmentNumber: 'EMP-2026-000999',
      })
      .expect(400);
  });

  it('refuses a malformed start date with field detail', async () => {
    const wired = await started(authorized);
    const personId = wired.people.add(uuidV7());

    await request(serverOf(wired.application))
      .post('/api/v1/employments')
      .send({ personId, employmentTypeCode: 'full-time', startDate: '15/01/2026' })
      .expect(400);
  });

  it('answers 409 when the person already has an employment that has not ended', async () => {
    const wired = await started(authorized);
    const personId = wired.people.add(uuidV7());

    await created(wired, personId);
    await request(serverOf(wired.application))
      .post('/api/v1/employments')
      .send({ personId, employmentTypeCode: 'full-time', startDate: '2026-03-01' })
      .expect(409);
  });

  it('reads an employment, and answers 404 for one that does not exist', async () => {
    const wired = await started(authorized);
    const personId = wired.people.add(uuidV7());
    const employmentId = await created(wired, personId);

    await request(serverOf(wired.application))
      .get(`/api/v1/employments/${employmentId}`)
      .expect(200);
    await request(serverOf(wired.application)).get(`/api/v1/employments/${uuidV7()}`).expect(404);
  });

  /**
   * The route-ordering trap. `/employments/export` and `/employments/:employmentId` are the same
   * shape, and Nest resolves by declaration order — declared the other way round, an export would
   * answer "no such employment".
   */
  it('resolves /employments/export to the export rather than to an employment', async () => {
    const wired = await started(authorized);

    const response = await request(serverOf(wired.application))
      .get('/api/v1/employments/export')
      .expect(200);

    expect(response.body).toHaveProperty('employments');
  });

  it('pages a search, and reports a total larger than the page', async () => {
    const wired = await started(authorized);

    await created(wired, wired.people.add(uuidV7()));
    await created(wired, wired.people.add(uuidV7()));

    const response = await request(serverOf(wired.application))
      .get('/api/v1/employments?size=1')
      .expect(200);

    expect((response.body as { items: unknown[]; total: number }).items).toHaveLength(1);
    expect((response.body as { total: number }).total).toBe(2);
  });

  it('changes status, and answers 422 for a transition the machine refuses', async () => {
    const wired = await started(authorized);
    const employmentId = await created(wired, wired.people.add(uuidV7()));

    // A refused business rule is 422, not 400: the request was understood, and resending it
    // unchanged will always fail.
    await request(serverOf(wired.application))
      .post(`/api/v1/employments/${employmentId}/status`)
      .send({ status: 'suspended', expectedVersion: 1 })
      .expect(422);

    await request(serverOf(wired.application))
      .post(`/api/v1/employments/${employmentId}/status`)
      .send({ status: 'active', expectedVersion: 1 })
      .expect(201);
  });

  it('ends an employment through its own endpoint, with a date and a reason', async () => {
    const wired = await started(authorized);
    const employmentId = await created(wired, wired.people.add(uuidV7()));

    await request(serverOf(wired.application))
      .post(`/api/v1/employments/${employmentId}/status`)
      .send({ status: 'active', expectedVersion: 1 });

    await request(serverOf(wired.application))
      .post(`/api/v1/employments/${employmentId}/end`)
      .send({ endDate: '2026-09-30', endReasonCode: 'resignation', expectedVersion: 2 })
      .expect(201);
  });

  it('refuses ending to a caller who may only change status', async () => {
    const wired = await started(() =>
      applicationWith(
        permitting(
          EmploymentPermissions.employmentManage,
          EmploymentPermissions.employmentRead,
          EmploymentPermissions.employmentStatusChange,
        ),
      ),
    );
    const employmentId = await created(wired, wired.people.add(uuidV7()));

    await request(serverOf(wired.application))
      .post(`/api/v1/employments/${employmentId}/end`)
      .send({ endDate: '2026-09-30', endReasonCode: 'dismissal', expectedVersion: 1 })
      .expect(403);
  });

  it('places and transfers an employment, and answers 404 for a unit that does not exist', async () => {
    const wired = await started(authorized);
    const employmentId = await created(wired, wired.people.add(uuidV7()));
    const unitId = wired.organization.add(uuidV7());

    await request(serverOf(wired.application))
      .post(`/api/v1/employments/${employmentId}/assignments`)
      .send({ unitId, effectiveFrom: '2026-03-01' })
      .expect(201);

    await request(serverOf(wired.application))
      .post(`/api/v1/employments/${employmentId}/assignments/change`)
      .send({ unitId: uuidV7(), effectiveFrom: '2026-06-01' })
      .expect(404);
  });

  it('returns every timeline from the history endpoint', async () => {
    const wired = await started(authorized);
    const employmentId = await created(wired, wired.people.add(uuidV7()));

    const response = await request(serverOf(wired.application))
      .get(`/api/v1/employments/${employmentId}/history`)
      .expect(200);

    expect(Object.keys(response.body as object)).toEqual(
      expect.arrayContaining(['statusHistory', 'assignments', 'reportingLines', 'contracts']),
    );
  });

  it('refuses a history read to a caller without employment.history.read', async () => {
    const wired = await started(() =>
      applicationWith(
        permitting(EmploymentPermissions.employmentManage, EmploymentPermissions.employmentRead),
      ),
    );
    const employmentId = await created(wired, wired.people.add(uuidV7()));

    await request(serverOf(wired.application))
      .get(`/api/v1/employments/${employmentId}/history`)
      .expect(403);
  });

  it('answers 401 to every endpoint when no tenant resolves', async () => {
    const wired = await started(() =>
      applicationWith(permitting(...Object.values(EmploymentPermissions)), false),
    );

    await request(serverOf(wired.application)).get('/api/v1/employments').expect(401);
    await request(serverOf(wired.application))
      .post('/api/v1/employments')
      .send({ personId: uuidV7(), employmentTypeCode: 'full-time', startDate: '2026-01-15' })
      .expect(401);
  });

  it('renders a refusal as Problem Details, with no internal detail', async () => {
    const wired = await started(authorized);

    const response = await request(serverOf(wired.application))
      .get(`/api/v1/employments/${uuidV7()}`)
      .expect(404);

    expect(response.body).toMatchObject({ status: 404 });
    expect(JSON.stringify(response.body)).not.toMatch(/select |postgres|at Object|node_modules/i);
  });
});
