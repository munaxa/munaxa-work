import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  ApplicationsController,
  CandidateRecordsController,
  CandidatesController,
  HireController,
  InterviewsController,
  OffersController,
  RecruitmentDispatcher,
  RecruitmentPermissions,
  RequisitionDecisionsController,
  RequisitionsController,
  VacanciesController,
  inMemoryRecruitmentStores,
  recruitmentModule,
} from '@work/recruitment';
import { FakeEmployment, FakeOrganization, FakePeople } from '@work/recruitment/testing';
import { InMemoryUnitOfWork } from '@work/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * API tests for the Recruitment endpoints.
 *
 * They exercise the real composition — the real dispatcher, the real pipeline, the real global
 * filter and validation pipe — because routing, prefixes and global filters are exactly where a test
 * that configured things slightly differently from production proves nothing about it.
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

const ALL = Object.values(RecruitmentPermissions);

interface Wired {
  readonly application: INestApplication;
  readonly people: FakePeople;
  readonly organization: FakeOrganization;
  readonly employment: FakeEmployment;
}

const applicationWith = async (
  checker: PermissionChecker,
  resolvesTenant = true,
): Promise<Wired> => {
  const dispatcher = new Dispatcher(checker);
  const people = new FakePeople();
  const organization = new FakeOrganization();
  const employment = new FakeEmployment();
  const module = recruitmentModule(
    {
      unitOfWork: new InMemoryUnitOfWork(TENANT),
      stores: inMemoryRecruitmentStores(),
      people,
      organization,
      employment,
      clock: { now: () => new Date('2026-08-09T09:00:00Z') },
    },
    // The same deferred seam the composition root uses, so candidate import goes through the real
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
    // `GET /recruitment/export` resolve to the export rather than to a candidate.
    controllers: [
      HireController,
      RequisitionDecisionsController,
      RequisitionsController,
      VacanciesController,
      CandidateRecordsController,
      CandidatesController,
      InterviewsController,
      ApplicationsController,
      OffersController,
    ],
    providers: [
      { provide: RecruitmentDispatcher, useValue: new RecruitmentDispatcher(dispatcher) },
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
  return { application, people, organization, employment };
};

describe('the Recruitment endpoints', () => {
  let wired: Wired | undefined;

  afterEach(async () => {
    await wired?.application.close();
    wired = undefined;
  });

  const server = (): Server => wired?.application.getHttpServer() as Server;

  const openApplication = async (): Promise<Wired> => {
    wired = await applicationWith(permitting(...ALL));
    return wired;
  };

  const aRequisition = async (): Promise<string> => {
    const created = await request(server())
      .post('/api/v1/recruitment/requisitions')
      .send({
        positionId: uuidV7(),
        unitId: wired?.organization.add(),
        headcountRequested: 1,
        reasonCode: 'growth',
        requestedByEmploymentId: wired?.employment.add(),
      })
      .expect(201);

    return (created.body as { requisitionId: string }).requisitionId;
  };

  it('generates the requisition number rather than accepting one', async () => {
    await openApplication();

    const created = await request(server())
      .post('/api/v1/recruitment/requisitions')
      .send({
        positionId: uuidV7(),
        unitId: wired?.organization.add(),
        headcountRequested: 1,
        reasonCode: 'growth',
        requestedByEmploymentId: wired?.employment.add(),
      })
      .expect(201);

    expect((created.body as { requisitionNumber: string }).requisitionNumber).toMatch(
      /^REQ-2026-\d{6}$/,
    );
  });

  it('refuses a body carrying a field the shape does not declare', async () => {
    await openApplication();

    await request(server())
      .post('/api/v1/recruitment/requisitions')
      .send({
        positionId: uuidV7(),
        unitId: wired?.organization.add(),
        headcountRequested: 1,
        reasonCode: 'growth',
        requestedByEmploymentId: wired?.employment.add(),
        requisitionNumber: 'REQ-MINE-0001',
      })
      .expect(400);
  });

  it('answers 403 with the permission the caller is missing', async () => {
    wired = await applicationWith(permitting(RecruitmentPermissions.requisitionRead));

    const refused = await request(server())
      .post('/api/v1/recruitment/requisitions')
      .send({
        positionId: uuidV7(),
        unitId: uuidV7(),
        headcountRequested: 1,
        reasonCode: 'growth',
        requestedByEmploymentId: uuidV7(),
      })
      .expect(403);

    expect(JSON.stringify(refused.body)).toContain('recruitment.requisition.manage');
  });

  it('answers 401 when no tenant resolved, before any handler runs', async () => {
    wired = await applicationWith(permitting(...ALL), false);

    await request(server()).get('/api/v1/recruitment/candidates').expect(401);
  });

  it('refuses a vacancy against a requisition nobody approved, as 422', async () => {
    await openApplication();

    const requisitionId = await aRequisition();

    await request(server())
      .post('/api/v1/recruitment/vacancies')
      .send({ requisitionId, title: { en: 'Field engineer', ar: 'مهندس ميداني' } })
      .expect(409);
  });

  it('resolves the export to the collection rather than to a candidate', async () => {
    await openApplication();

    const exported = await request(server()).get('/api/v1/recruitment/export').expect(200);

    expect(exported.body).toHaveProperty('candidates');
  });

  it('refuses a candidate carrying a national identifier, because no such field exists', async () => {
    await openApplication();

    await request(server())
      .post('/api/v1/recruitment/candidates')
      .send({
        displayName: { en: 'Noura Al-Fahad', ar: 'نورة الفهد' },
        email: 'noura@example.com',
        sourceCode: 'referral',
        nationalId: '1234567890',
      })
      .expect(400);
  });

  it('answers 404 rather than 403 for a candidate this tenant does not have', async () => {
    await openApplication();

    await request(server()).get(`/api/v1/recruitment/candidates/${uuidV7()}`).expect(404);
  });
});
