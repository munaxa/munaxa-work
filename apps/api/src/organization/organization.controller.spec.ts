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
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * API tests for routing and the structure endpoints.
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
  describe('routing', () => {
    it('publishes every endpoint under /api/v1', async () => {
      const application = await started(authorized);

      await request(serverOf(application)).get('/api/v1/organization/unit-types').expect(200);
      await request(serverOf(application)).get('/api/v1/organization/hierarchy').expect(200);
      await request(serverOf(application)).get('/api/v1/organization/positions').expect(200);
      await request(serverOf(application)).get('/api/v1/organization/legal-entities').expect(200);
      await request(serverOf(application)).get('/api/v1/organization/tenant-settings').expect(200);
      await request(serverOf(application)).get('/api/v1/organization/export').expect(200);
    });

    it('offers the standard levels as data without installing any of them', async () => {
      const application = await started(authorized);
      const offered = await request(serverOf(application))
        .get('/api/v1/organization/standard-unit-types')
        .expect(200);
      const installed = await request(serverOf(application))
        .get('/api/v1/organization/unit-types')
        .expect(200);

      expect((offered.body as readonly unknown[]).length).toBeGreaterThan(0);
      expect(installed.body).toEqual([]);
    });
  });

  describe('the structure', () => {
    it('creates, places and reads back a hierarchy as at a date', async () => {
      const application = await started(authorized);
      const type = await aUnitType(application);
      const parent = await aUnit(application, type, 'GROUP');
      const child = await aUnit(application, type, 'HR');

      await request(serverOf(application))
        .post(`/api/v1/organization/units/${parent}/placement`)
        .send({ effectiveFrom: '2026-01-01T00:00:00.000Z' })
        .expect(201);
      await request(serverOf(application))
        .post(`/api/v1/organization/units/${child}/placement`)
        .send({ parentUnitId: parent, effectiveFrom: '2026-01-01T00:00:00.000Z' })
        .expect(201);

      const tree = await request(serverOf(application))
        .get('/api/v1/organization/hierarchy?asOf=2026-03-01T00:00:00.000Z')
        .expect(200);
      const body = tree.body as {
        roots: readonly {
          unit: { code: string };
          children: readonly { unit: { code: string } }[];
        }[];
      };

      expect(body.roots).toHaveLength(1);
      expect(body.roots[0]?.unit.code).toBe('GROUP');
      expect(body.roots[0]?.children[0]?.unit.code).toBe('HR');
    });

    it('answers the country a unit is governed by, or says there is none', async () => {
      const application = await started(authorized);
      const unit = await aUnit(application, await aUnitType(application), 'HR');
      const answer = await request(serverOf(application))
        .get(`/api/v1/organization/units/${unit}/governing-legal-entity`)
        .expect(200);

      // No registration anywhere above it. The answer is the *absence* of one — never a
      // tenant-level default, which would compute somebody's end of service under a country
      // nobody chose and produce a number that looks right.
      expect((answer.body as { legalEntity?: unknown }).legalEntity).toBeUndefined();
      expect(answer.body).toMatchObject({ unitId: unit });
    });

    it('returns 404 for a unit in another tenant, by its exact identifier', async () => {
      const application = await started(authorized);

      await request(serverOf(application))
        .get(`/api/v1/organization/units/${uuidV7()}/ancestry`)
        .expect(404);
    });
  });
});
