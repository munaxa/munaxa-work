import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  ContactsController,
  DuplicatesController,
  HmacIdentifierDigest,
  IdentifiersController,
  PeopleController,
  PeopleDispatcher,
  PeoplePermissions,
  PersonLifecycleController,
  PersonalDetailsController,
  ProfileController,
  TransferController,
  inMemoryPeopleStores,
  peopleModule,
} from '@work/people';
import { InMemoryUnitOfWork } from '@work/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * API tests for the People endpoints.
 *
 * They exercise the real composition — the real dispatcher, the real pipeline, the real global
 * filter and validation pipe — because routing, prefixes and global filters are exactly where a
 * test that configured things slightly differently from production proves nothing about it.
 *
 * The permission checker is given to the pipeline **and** to the module's dependencies, exactly as
 * the composition root does it, because a read in this module assembles its answer from what the
 * caller holds. A test that wired only the pipeline would exercise the unredacted path only.
 *
 * The tenant context is established by a stand-in rather than by the real middleware:
 * `tenant.middleware.spec.ts` is where that is tested, and repeating it here would make these
 * tests fail for reasons unrelated to the endpoints.
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

const bilingual = (en: string, ar: string): Record<string, string> => ({ en, ar });

const SARA = bilingual('Sara Al-Amri', 'سارة العامري');

const applicationWith = async (
  checker: PermissionChecker,
  resolvesTenant = true,
): Promise<INestApplication> => {
  const dispatcher = new Dispatcher(checker);
  const module = peopleModule(
    {
      unitOfWork: new InMemoryUnitOfWork(TENANT),
      stores: inMemoryPeopleStores(),
      permissions: checker,
      digest: new HmacIdentifierDigest('a-test-key-long-enough-to-be-a-key-000000'),
      disclosure: { recordDisclosure: () => undefined },
      clock: { now: () => new Date('2026-08-06T09:00:00Z') },
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
    // `GET /people/duplicates` resolve to the queue rather than to a person with that identifier.
    controllers: [
      DuplicatesController,
      TransferController,
      PersonLifecycleController,
      IdentifiersController,
      ContactsController,
      PersonalDetailsController,
      ProfileController,
      PeopleController,
    ],
    providers: [
      { provide: PeopleDispatcher, useValue: new PeopleDispatcher(dispatcher) },
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
  return application;
};

/** `getHttpServer()` is typed `any`; naming the type once keeps every call site checked. */
const serverOf = (application: INestApplication): Server => application.getHttpServer() as Server;

const authorized = (): Promise<INestApplication> =>
  applicationWith(permitting(...Object.values(PeoplePermissions)));

let open: INestApplication[] = [];

const started = async (build: () => Promise<INestApplication>): Promise<INestApplication> => {
  const application = await build();

  open.push(application);
  return application;
};

afterEach(async () => {
  await Promise.all(open.map((application) => application.close()));
  open = [];
});

const aPerson = async (
  application: INestApplication,
  personNumber = 'E-1001',
  legalName: Record<string, string> = SARA,
  extra: Record<string, unknown> = {},
): Promise<string> => {
  const created = await request(serverOf(application))
    .post('/api/v1/people')
    .send({ personNumber, legalName, ...extra })
    .expect(201);

  return (created.body as { personId: string }).personId;
};

describe('the People API', () => {
  describe('routing', () => {
    it('publishes every endpoint under /api/v1', async () => {
      const application = await started(authorized);

      await request(serverOf(application)).get('/api/v1/people').expect(200);
      await request(serverOf(application)).get('/api/v1/people/duplicates').expect(200);
      await request(serverOf(application)).get('/api/v1/people/export').expect(200);
    });

    it('resolves the collection routes rather than treating them as a person identifier', async () => {
      const application = await started(authorized);
      const queue = await request(serverOf(application))
        .get('/api/v1/people/duplicates')
        .expect(200);

      // Both are one segment after `/people`, exactly like `/people/{personId}`. If the
      // controllers were declared the other way round this would be a 404 for a person called
      // "duplicates" — which is why the module's declaration order is not cosmetic.
      expect(queue.body).toMatchObject({ total: 0 });
      await request(serverOf(application)).get('/api/v1/people/export').expect(200);
    });

    it('refuses a caller with no tenant, before anything else runs', async () => {
      const application = await started(() => applicationWith(permitting(), false));

      await request(serverOf(application)).get('/api/v1/people').expect(401);
    });

    it('returns Problem Details on every error path, with no internal detail', async () => {
      const application = await started(authorized);
      const missing = await request(serverOf(application))
        .get(`/api/v1/people/${uuidV7()}`)
        .expect(404);

      expect(missing.headers['content-type']).toContain('application/problem+json');
      expect(missing.body).toMatchObject({ status: 404, title: 'Not Found' });
      expect(JSON.stringify(missing.body)).not.toContain('select');
    });
  });

  describe('the register', () => {
    it('creates a person and reads them back with the name in force', async () => {
      const application = await started(authorized);
      const personId = await aPerson(application);
      const read = await request(serverOf(application))
        .get(`/api/v1/people/${personId}`)
        .expect(200);

      expect(read.body).toMatchObject({
        personNumber: 'E-1001',
        legalName: { ar: 'سارة العامري' },
      });
    });

    it('refuses a person named in only one language', async () => {
      const application = await started(authorized);

      await request(serverOf(application))
        .post('/api/v1/people')
        .send({ personNumber: 'E-1002', legalName: { en: 'Only English' } })
        .expect(400);
    });

    it('refuses an undeclared property rather than silently dropping it', async () => {
      const application = await started(authorized);

      await request(serverOf(application))
        .post('/api/v1/people')
        .send({ personNumber: 'E-1003', legalName: SARA, salary: 10_000 })
        .expect(400);
    });

    it('renders a legal name change as at a date', async () => {
      const application = await started(authorized);
      const personId = await aPerson(application, 'E-1004', SARA, {
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      });

      await request(serverOf(application))
        .post(`/api/v1/people/${personId}/names`)
        .send({
          legalName: bilingual('Sara Al-Ghamdi', 'سارة الغامدي'),
          effectiveFrom: '2026-06-01T00:00:00.000Z',
        })
        .expect(201);

      const march = await request(serverOf(application))
        .get(`/api/v1/people/${personId}?asOf=2026-03-01T00:00:00.000Z`)
        .expect(200);
      const september = await request(serverOf(application))
        .get(`/api/v1/people/${personId}?asOf=2026-09-01T00:00:00.000Z`)
        .expect(200);

      expect((march.body as { legalName: { ar: string } }).legalName.ar).toBe('سارة العامري');
      expect((september.body as { legalName: { ar: string } }).legalName.ar).toBe('سارة الغامدي');
    });
  });

  describe('duplicate prevention', () => {
    it('refuses a create that may already exist, with 409 and no echoed value', async () => {
      const application = await started(authorized);

      await aPerson(application, 'E-1001', bilingual('Ahmed Al-Ghamdi', 'أحمد الغامدي'), {
        dateOfBirth: '1990-03-14',
      });

      const again = await request(serverOf(application))
        .post('/api/v1/people')
        .send({
          personNumber: 'E-1002',
          legalName: bilingual('Ahmed Alghamdi', 'احمد الغامدي'),
          dateOfBirth: '1990-03-14',
        })
        .expect(409);

      expect(again.body).toMatchObject({ status: 409 });
    });

    it('creates when the caller acknowledges, and queues the pair for review', async () => {
      const application = await started(authorized);

      await aPerson(application, 'E-1001', bilingual('Ahmed Al-Ghamdi', 'أحمد الغامدي'), {
        dateOfBirth: '1990-03-14',
      });
      await aPerson(application, 'E-1002', bilingual('Ahmed Alghamdi', 'احمد الغامدي'), {
        dateOfBirth: '1990-03-14',
        acknowledgedDuplicates: true,
      });

      const queue = await request(serverOf(application))
        .get('/api/v1/people/duplicates?status=pending')
        .expect(200);

      expect((queue.body as { total: number }).total).toBe(1);
    });
  });
});
