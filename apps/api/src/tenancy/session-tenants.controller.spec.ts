import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { uuidV7, type PlatformAuthenticationPort } from '@work/kernel';
import type { ResolvedMembership, TenantMembershipDirectory } from '@work/identity';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import { MEMBERSHIP_DIRECTORY } from '../identity/identity.tokens.js';

import { AuthenticatedTenantGuard } from './authenticated-tenant.guard.js';
import { SessionTenantsController } from './session-tenants.controller.js';
import { TENANT_HEADER, TenantMiddleware } from './tenant.middleware.js';

/**
 * `GET /api/v1/session/tenants` (MW-007): what the Admin tenant picker lists.
 *
 * Through the real middleware and the real guard. The properties: it needs a principal and no
 * tenant; it answers with exactly the memberships the middleware would choose from; and nothing the
 * caller sends — a selection header naming a tenant they are not in — changes the answer.
 */

const TENANT_A = uuidV7();
const TENANT_B = uuidV7();
const PLATFORM_USER = 'platform-user-picker';

const membershipOf = (tenantId: string): ResolvedMembership => ({
  tenantId,
  membershipId: uuidV7(),
  workforceUserId: uuidV7(),
  platformUserId: PLATFORM_USER,
  status: 'active',
});

const authenticating: PlatformAuthenticationPort = {
  authenticate: (credentials) =>
    Promise.resolve(
      credentials === undefined
        ? undefined
        : {
            platformUserId: PLATFORM_USER,
            platformTenantId: 'org-a',
            issuer: 'platform-test',
            authenticatedAt: new Date('2026-11-23T00:00:00Z'),
          },
    ),
};

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

let open: INestApplication | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

const serving = async (...memberships: ResolvedMembership[]): Promise<Server> => {
  const directory: TenantMembershipDirectory = {
    activeMembershipsOf: () => Promise.resolve(memberships),
  };
  const testing = await Test.createTestingModule({
    controllers: [SessionTenantsController],
    providers: [
      { provide: MEMBERSHIP_DIRECTORY, useValue: directory },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();
  const application = testing.createNestApplication();
  const middleware = new TenantMiddleware(authenticating, directory);

  application.use((incoming: Request, outgoing: Response, next: NextFunction) => {
    void middleware.use(incoming, outgoing, next);
  });
  configureApplication(application, environment);
  await application.init();
  open = application;
  return application.getHttpServer() as Server;
};

const AUTHORIZED = { authorization: 'Bearer a-platform-token' };

describe('GET /api/v1/session/tenants', () => {
  it('refuses a caller with no principal', async () => {
    const http = await serving(membershipOf(TENANT_A));

    await request(http).get('/api/v1/session/tenants').expect(401);
  });

  it('lists every tenant a member of several may choose from, without one being chosen', async () => {
    const http = await serving(membershipOf(TENANT_A), membershipOf(TENANT_B));

    const answer = await request(http).get('/api/v1/session/tenants').set(AUTHORIZED).expect(200);

    expect(answer.body).toEqual({ tenants: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }] });
  });

  it('is not widened or narrowed by a selection header naming another tenant', async () => {
    const http = await serving(membershipOf(TENANT_A));

    const answer = await request(http)
      .get('/api/v1/session/tenants')
      .set({ ...AUTHORIZED, [TENANT_HEADER]: TENANT_B })
      .expect(200);

    expect(answer.body).toEqual({ tenants: [{ tenantId: TENANT_A }] });
  });

  it('answers an empty list, not an error, for a person who is a member of nothing', async () => {
    const http = await serving();

    const answer = await request(http).get('/api/v1/session/tenants').set(AUTHORIZED).expect(200);

    expect(answer.body).toEqual({ tenants: [] });
  });
});
