import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  IdentityDispatcher,
  IdentityPermissions,
  InvitationsController,
  MembersController,
  PortalAccessController,
  identityModule,
  inMemoryIdentityStores,
} from '@work/identity';
import { InMemoryUnitOfWork } from '@work/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import type { ProblemDetails } from '../errors/problem-details.filter.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * API tests for the endpoints Phase 2 adds: routing, validation, authorization failures and the
 * Problem Details contract.
 *
 * They exercise the real composition — the real dispatcher, the real pipeline, the real global
 * filter and validation pipe — because routing, prefixes and global filters are exactly where a
 * test that configured things slightly differently from production proves nothing about it.
 *
 * The tenant context is established by a stand-in here rather than by the real middleware:
 * `tenant.middleware.spec.ts` is where that is tested, and repeating it would make these tests
 * fail for reasons unrelated to the endpoints.
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

const RIYADH_TENANT_SETTINGS = {
  language: 'ar',
  calendar: 'hijri' as const,
  timeZone: 'Asia/Riyadh',
  numerals: 'arabic-indic' as const,
  invitationValidityDays: 14,
  defaultPortals: ['employee' as const],
};

const applicationWith = async (
  checker: PermissionChecker,
  resolvesTenant = true,
): Promise<INestApplication> => {
  const dispatcher = new Dispatcher(checker);
  const module = identityModule({
    unitOfWork: new InMemoryUnitOfWork(TENANT),
    stores: inMemoryIdentityStores(),
    settings: { settingsFor: () => Promise.resolve(RIYADH_TENANT_SETTINGS) },
    clock: { now: () => new Date('2026-08-05T10:00:00Z') },
  });

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }

  const testing = await Test.createTestingModule({
    controllers: [MembersController, InvitationsController, PortalAccessController],
    providers: [
      { provide: IdentityDispatcher, useValue: new IdentityDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();

  const application = testing.createNestApplication();

  // Stands in for the tenant middleware. `resolvesTenant: false` is the shape of a request from
  // somebody Platform did not authenticate, or who resolved no membership.
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

interface InvitationIssuedBody {
  readonly invitationId: string;
  readonly expiresAt: string;
}

interface InvitationListBody {
  readonly items: readonly {
    readonly email: string;
    readonly status: string;
    readonly portals: readonly string[];
  }[];
  readonly total: number;
  readonly page: number;
}

const authorized = (): Promise<INestApplication> =>
  applicationWith(permitting(...Object.values(IdentityPermissions)));

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

describe('the identity API', () => {
  describe('routing', () => {
    it('serves the member register under the versioned prefix', async () => {
      const application = await started(authorized);
      const response = await request(serverOf(application)).get('/api/v1/identity/members');

      const body = response.body as InvitationListBody;

      expect(response.status).toBe(200);
      expect(body.page).toBe(1);
      expect(body.total).toBe(0);
    });
  });

  describe('authorization', () => {
    it('refuses a caller holding no permission, with Problem Details', async () => {
      const application = await started(() => applicationWith(permitting()));
      const response = await request(serverOf(application)).get('/api/v1/identity/members');

      const problem = response.body as ProblemDetails;

      expect(response.status).toBe(403);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(problem.status).toBe(403);
      expect(problem.title).toBe('Forbidden');
      expect(problem.detail).toBe(`Requires ${IdentityPermissions.membershipRead}.`);
    });

    it('refuses an unauthenticated caller before validating their payload', async () => {
      const application = await started(() =>
        applicationWith(permitting(...Object.values(IdentityPermissions)), false),
      );
      const response = await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'definitely not an address' });

      // 401, not 400. Nest runs guards before pipes, which is what extends the kernel pipeline's
      // "authorization before validation" ordering out to the transport: without the guard, the
      // global ValidationPipe would answer first and tell an unauthenticated caller that their
      // body was malformed.
      expect(response.status).toBe(401);
      expect((response.body as ProblemDetails).detail).toBe('Not authenticated.');
    });

    it('refuses an unauthenticated caller on a read as well, with Problem Details', async () => {
      const application = await started(() => applicationWith(permitting(), false));
      const response = await request(serverOf(application)).get('/api/v1/identity/members');

      expect(response.status).toBe(401);
      expect(response.headers['content-type']).toContain('application/problem+json');
    });

    it('answers 403 rather than 400 for an authenticated caller who lacks the permission', async () => {
      const application = await started(() => applicationWith(permitting()));
      const response = await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'sara@example.com' });

      expect(response.status).toBe(403);
    });

    it('grants each endpoint only the permission it declares', async () => {
      const application = await started(() =>
        applicationWith(permitting(IdentityPermissions.invitationManage)),
      );

      const invited = await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'sara@example.com' });
      const listed = await request(serverOf(application)).get('/api/v1/identity/members');

      expect(invited.status).toBe(201);
      expect(listed.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('rejects a malformed address with 400 and says which field', async () => {
      const application = await started(authorized);
      const response = await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'not-an-address' });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('email');
    });

    it('rejects a property the endpoint does not declare, rather than ignoring it', async () => {
      const application = await started(authorized);
      const response = await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'sara@example.com', isAdministrator: true });

      // Dropping it silently would let a client believe it set something the server ignored.
      expect(response.status).toBe(400);
    });

    it('rejects an unknown portal', async () => {
      const application = await started(authorized);
      const response = await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'sara@example.com', portals: ['superuser'] });

      expect(response.status).toBe(400);
    });
  });

  describe('the happy path', () => {
    it('issues an invitation and lists it, with the tenant’s default portals', async () => {
      const application = await started(authorized);

      const issued = await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'sara@example.com' });

      expect(issued.status).toBe(201);
      expect(typeof (issued.body as InvitationIssuedBody).invitationId).toBe('string');

      const listed = await request(serverOf(application)).get('/api/v1/identity/invitations');
      const { items } = listed.body as InvitationListBody;

      expect(items).toHaveLength(1);
      expect(items[0]?.email).toBe('sara@example.com');
      expect(items[0]?.status).toBe('pending');
      expect(items[0]?.portals).toEqual(['employee']);
    });
  });

  describe('a refused business rule', () => {
    it('is 422 with a catalogue key, not 400', async () => {
      const application = await started(authorized);

      await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'omar@example.com' });

      const second = await request(serverOf(application))
        .post('/api/v1/identity/invitations')
        .send({ email: 'omar@example.com' });

      // The request was well formed and the domain refused it. Resending the same bytes will
      // always fail, so a client that saw 400 would retry with a different payload forever.
      expect(second.status).toBe(422);
      // A key rather than a sentence, so the portal renders it in the reader's language.
      expect((second.body as ProblemDetails).detail).toBe(
        'identity.rejection.invitation_already_pending',
      );
    });
  });

  describe('not found', () => {
    it('answers 404 for a membership this tenant cannot see', async () => {
      const application = await started(authorized);
      const response = await request(serverOf(application)).get(
        `/api/v1/identity/members/${uuidV7()}`,
      );

      expect(response.status).toBe(404);
      expect((response.body as ProblemDetails).detail).toBe('No such membership.');
    });

    it('leaks no stack trace, no SQL and no environment detail on any error path', async () => {
      const application = await started(authorized);
      const response = await request(serverOf(application)).get(
        `/api/v1/identity/members/${uuidV7()}`,
      );
      const body = JSON.stringify(response.body).toLowerCase();

      for (const leak of ['stack', 'select ', 'postgres', 'password', 'node_modules']) {
        expect(body).not.toContain(leak);
      }
    });
  });
});
