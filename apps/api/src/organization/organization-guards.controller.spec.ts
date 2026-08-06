import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  AdministrationController,
  CalendarsController,
  CentersController,
  EstablishmentController,
  HierarchyController,
  LegalEntitiesController,
  NoAssignmentsYet,
  OrganizationDispatcher,
  OrganizationPermissions,
  PositionsController,
  UnitTypesController,
  UnitsController,
  inMemoryOrganizationStores,
  organizationModule,
} from '@work/organization';
import { InMemoryUnitOfWork } from '@work/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import type { ProblemDetails } from '../errors/problem-details.filter.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * API tests for validation, authorization and tenant settings at the transport.
 *
 * They exercise the real composition — the real dispatcher, the real pipeline, the real global
 * filter and validation pipe — because routing, prefixes and global filters are exactly where a
 * test that configured things slightly differently from production proves nothing about it.
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

/** Grants exactly what it was given, so a permission test is a real test. */
const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

const bilingual = (en: string, ar: string): Record<string, string> => ({ en, ar });

const applicationWith = async (
  checker: PermissionChecker,
  resolvesTenant = true,
): Promise<INestApplication> => {
  const dispatcher = new Dispatcher(checker);
  const module = organizationModule(
    {
      unitOfWork: new InMemoryUnitOfWork(TENANT),
      stores: inMemoryOrganizationStores(),
      filled: new NoAssignmentsYet(),
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
    controllers: [
      UnitTypesController,
      UnitsController,
      HierarchyController,
      LegalEntitiesController,
      CentersController,
      PositionsController,
      EstablishmentController,
      CalendarsController,
      AdministrationController,
    ],
    providers: [
      { provide: OrganizationDispatcher, useValue: new OrganizationDispatcher(dispatcher) },
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
  applicationWith(permitting(...Object.values(OrganizationPermissions)));

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

/** Defines a level through the API, as an administrator would. One per tenant: codes are unique. */
const aUnitType = async (application: INestApplication): Promise<string> => {
  const created = await request(serverOf(application))
    .post('/api/v1/organization/unit-types')
    .send({ code: 'unit', name: bilingual('Unit', 'وحدة'), ordinal: 10 })
    .expect(201);

  return (created.body as { unitTypeId: string }).unitTypeId;
};

const aUnit = async (
  application: INestApplication,
  unitTypeId: string,
  code = 'RUH',
): Promise<string> => {
  const created = await request(serverOf(application))
    .post('/api/v1/organization/units')
    .send({
      unitTypeId,
      code,
      name: bilingual(code, `${code} بالعربية`),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    })
    .expect(201);

  return (created.body as { unitId: string }).unitId;
};

describe('the organization API', () => {
  describe('validation', () => {
    it('refuses a name missing a first-class language, as 422 rather than 400', async () => {
      const application = await started(authorized);
      const type = await request(serverOf(application))
        .post('/api/v1/organization/unit-types')
        .send({ code: 'unit', name: bilingual('Unit', 'وحدة'), ordinal: 10 });

      const refused = await request(serverOf(application))
        .post('/api/v1/organization/units')
        .send({
          unitTypeId: (type.body as { unitTypeId: string }).unitTypeId,
          code: 'HALF',
          // Well-formed as a request; refused by the domain. 422, not 400 — resending it
          // unchanged will always fail, and a client that saw 400 would retry forever.
          name: { en: 'Half named' },
          effectiveFrom: '2026-01-01T00:00:00.000Z',
        })
        .expect(422);

      expect((refused.body as ProblemDetails).detail).toContain(
        'organization.rejection.name_requires_both_languages',
      );
    });

    it('refuses a malformed payload as 400, with the field named', async () => {
      const application = await started(authorized);
      const refused = await request(serverOf(application))
        .post('/api/v1/organization/unit-types')
        .send({ code: 'not a code', name: bilingual('Unit', 'وحدة'), ordinal: 'ten' })
        .expect(400);

      expect((refused.body as ProblemDetails).detail).toMatch(/code|ordinal/);
    });

    it('refuses an undeclared property rather than silently ignoring it', async () => {
      const application = await started(authorized);

      // A client that believed it set something the server dropped is a client with a bug it
      // cannot see.
      await request(serverOf(application))
        .post('/api/v1/organization/unit-types')
        .send({ code: 'unit', name: bilingual('Unit', 'وحدة'), ordinal: 10, depth: 4 })
        .expect(400);
    });

    it('refuses a working week with no working days', async () => {
      const application = await started(authorized);

      await request(serverOf(application))
        .post('/api/v1/organization/calendars')
        .send({
          code: 'CORP',
          name: bilingual('Corporate', 'المؤسسي'),
          timeZone: 'Asia/Riyadh',
          workingDays: [],
          effectiveFrom: '2026-01-01T00:00:00.000Z',
        })
        .expect(400);
    });
  });

  describe('authorization', () => {
    it('refuses an unauthenticated caller before anything else', async () => {
      const application = await started(() =>
        applicationWith(permitting(...Object.values(OrganizationPermissions)), false),
      );
      const refused = await request(serverOf(application))
        .get('/api/v1/organization/hierarchy')
        .expect(401);

      expect((refused.body as ProblemDetails).title).toBe('Unauthorized');
    });

    it('names the permission a caller is missing, since an administrator can act on it', async () => {
      const application = await started(() =>
        applicationWith(permitting(OrganizationPermissions.unitRead)),
      );
      const refused = await request(serverOf(application))
        .get('/api/v1/organization/hierarchy')
        .expect(403);

      expect((refused.body as ProblemDetails).detail).toContain(
        OrganizationPermissions.hierarchyRead,
      );
    });

    it('refuses a reorganization to a caller who may only read the chart', async () => {
      const application = await started(() =>
        applicationWith(
          permitting(
            OrganizationPermissions.hierarchyRead,
            OrganizationPermissions.unitRead,
            OrganizationPermissions.unitManage,
            OrganizationPermissions.unitTypeManage,
          ),
        ),
      );
      const unit = await aUnit(application, await aUnitType(application));

      await request(serverOf(application))
        .post(`/api/v1/organization/units/${unit}/placement`)
        .send({ effectiveFrom: '2026-01-01T00:00:00.000Z' })
        .expect(403);
    });

    it('answers 401 rather than 400 to an unauthenticated caller sending a malformed body', async () => {
      const application = await started(() => applicationWith(permitting(), false));

      // Guards run before pipes, so authentication comes before validation at the transport as
      // well as inside the pipeline. Somebody outside the tenant learns nothing about their
      // payload — not even that it was malformed.
      await request(serverOf(application))
        .post('/api/v1/organization/unit-types')
        .send({ code: 'not a code', ordinal: -1 })
        .expect(401);
    });

    it('still answers 400 to an authenticated member who lacks the permission — the known residual', async () => {
      const application = await started(() => applicationWith(permitting()));

      // Nest runs the global ValidationPipe before the CQRS pipeline's permission check, so a
      // caller already inside the tenant is told their own body was malformed before being told
      // they lack the permission. Recorded in the Phase 2 report and unchanged here: it tells
      // somebody who is already a member only that their own payload was wrong.
      await request(serverOf(application))
        .post('/api/v1/organization/unit-types')
        .send({ code: 'not a code', ordinal: -1 })
        .expect(400);
    });
  });

  describe('tenant settings', () => {
    it('answers with nothing until the tenant configures itself, then with what it chose', async () => {
      const application = await started(authorized);

      const before = await request(serverOf(application))
        .get('/api/v1/organization/tenant-settings')
        .expect(200);

      expect(before.body).toEqual({});

      await request(serverOf(application))
        .put('/api/v1/organization/tenant-settings')
        .send({
          language: 'ar',
          calendar: 'hijri',
          timeZone: 'Asia/Riyadh',
          numerals: 'arabic-indic',
          invitationValidityDays: 14,
          defaultPortals: ['employee'],
        })
        .expect(200);

      const after = await request(serverOf(application))
        .get('/api/v1/organization/tenant-settings')
        .expect(200);

      expect(after.body).toMatchObject({
        language: 'ar',
        calendar: 'hijri',
        timeZone: 'Asia/Riyadh',
      });
    });

    it('refuses a calendar the product cannot render', async () => {
      const application = await started(authorized);

      await request(serverOf(application))
        .put('/api/v1/organization/tenant-settings')
        .send({
          language: 'ar',
          calendar: 'julian',
          timeZone: 'Asia/Riyadh',
          numerals: 'arabic-indic',
          invitationValidityDays: 14,
          defaultPortals: ['employee'],
        })
        .expect(400);
    });
  });
});
