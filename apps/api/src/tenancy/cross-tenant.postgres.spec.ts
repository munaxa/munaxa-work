import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadProcessEnvironment } from '@work/config';
import { ALL_DOCUMENTS_PERMISSIONS } from '@work/documents';
import { ALL_PEOPLE_PERMISSIONS } from '@work/people';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { platformGrantFor } from '../identity/platform-grants.js';
import {
  CONNECTION,
  ISSUER,
  KID,
  PASSWORD,
  RUNTIME,
  admitTo,
  applyRuntimeGrants,
  bindTo,
  inTenant,
  keys,
  mintToken,
  requireDatabaseInCi,
  stageEnvironment,
  startIdentityStandIn,
} from './cross-tenant.fixture.js';
import { TENANT_HEADER } from './tenant.middleware.js';

/**
 * WK-01, adversarially, through the **whole production composition**: the real `AppModule` (every
 * module, guard and middleware a deployment runs), real PostgreSQL connected as a `work_app` role
 * that holds exactly `deploy/aws/runtime-grants.sql`, real ES256 tokens verified by Platform's
 * `TokenService`, and the revocation check pointed at a local Identity stand-in over HTTP.
 *
 * The cast:
 *
 * - **bob** administers Work tenant B (bound to organisation B). He creates the data under attack.
 * - **mallory** is an administrator in organisation A — every People and Documents grant — and an
 *   ordinary member of tenant B as well. Before the fix her organisation-A token, with
 *   `x-munaxa-tenant: B`, carried her organisation-A grants into tenant B.
 * - **alice** administers tenant A only.
 *
 * Every refusal is checked three ways: the status, that the response body carries none of B's
 * data, and — for writes — that the row in the database is unchanged.
 */

requireDatabaseInCi('The cross-tenant suite');
const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ORG_A = `org-a-${stamp}`;
const ORG_B = `org-b-${stamp}`;
/** Every Platform grant an administrator of People and Documents would hold. */
const ADMIN_GRANTS = [...ALL_PEOPLE_PERMISSIONS, ...ALL_DOCUMENTS_PERMISSIONS].map(
  platformGrantFor,
);

/** Revoked sessions, as the stand-in Identity knows them. */
const revoked = new Set<string>();
let identity: Server;

const tokenFor = (sub: string, organisation: string, grants: readonly string[] = ADMIN_GRANTS) =>
  mintToken(sub, organisation, grants);

describeWithDatabase('cross-tenant access through the production composition (WK-01)', () => {
  let admin: Client;
  let application: INestApplication;
  let tenantA = '';
  let tenantB = '';
  let personB = '';
  let personBNumber = '';
  const subjects = {
    alice: `alice-${stamp}`,
    bob: `bob-${stamp}`,
    mallory: `mallory-${stamp}`,
  };
  let tokens: Record<'alice' | 'bob' | 'mallory', string>;
  let restoreEnvironment: (() => void) | undefined;

  const http = () => request(application.getHttpServer() as Server);
  const as = (token: string, tenant?: string) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (tenant !== undefined) headers[TENANT_HEADER] = tenant;
    return headers;
  };
  const personRow = async (id: string) =>
    (
      await admin.query<{
        person_number: string;
        status: string;
        version: number;
        updated_at: Date;
        names: unknown;
      }>(
        `select p.person_number, p.status, p.version, p.updated_at,
                (select json_agg(n.legal_name order by n.effective_from)
                   from person_name n where n.person_id = p.id) as names
           from person p where p.id = $1`,
        [id],
      )
    ).rows[0];

  const admit = (sub: string, tenant: string) => admitTo(admin, sub, tenant);
  const bind = (tenant: string, organisation: string) => bindTo(admin, tenant, organisation);

  beforeAll(async () => {
    const started = await startIdentityStandIn(revoked);
    identity = started.server;
    const identityUrl = started.url;

    admin = new Client({ connectionString: CONNECTION });
    await admin.connect();
    await applyRuntimeGrants(admin);

    tenantA = (await admin.query<{ id: string }>('select app_uuid_v7() as id')).rows[0]?.id ?? '';
    tenantB = (await admin.query<{ id: string }>('select app_uuid_v7() as id')).rows[0]?.id ?? '';
    await bind(tenantA, ORG_A);
    await bind(tenantB, ORG_B);
    await admit(subjects.alice, tenantA);
    await admit(subjects.bob, tenantB);
    await admit(subjects.mallory, tenantA);
    await admit(subjects.mallory, tenantB);

    tokens = {
      alice: tokenFor(subjects.alice, ORG_A).token,
      bob: tokenFor(subjects.bob, ORG_B).token,
      mallory: tokenFor(subjects.mallory, ORG_A).token,
    };

    const url = new URL(CONNECTION ?? '');
    url.username = RUNTIME;
    url.password = PASSWORD;
    restoreEnvironment = stageEnvironment({
      NODE_ENV: 'test',
      APP_NAME: 'munaxa-work-cross-tenant-test',
      APP_VERSION: '0.0.0-test',
      DATABASE_URL: url.toString(),
      LOG_LEVEL: 'fatal',
      OPENAPI_ENABLED: 'false',
      LICENSING_MODE: 'NONE',
      PLATFORM_AUTH_ISSUER: ISSUER,
      PLATFORM_AUTH_AUDIENCE: 'munaxa-work',
      PLATFORM_AUTH_ALGORITHM: 'ES256',
      PLATFORM_AUTH_PUBLIC_KEYS: JSON.stringify([{ kid: KID, publicKey: keys.publicKey }]),
      PLATFORM_AUTH_INTROSPECTION_URL: identityUrl,
      PLATFORM_AUTH_REVOCATION_CACHE_MS: '0',
    });
    const { AppModule } = await import('../app.module.js');
    const { configureApplication } = await import('../application.setup.js');
    application = await NestFactory.create(AppModule, { logger: false });
    configureApplication(application, loadProcessEnvironment());
    await application.init();

    // bob creates a person in tenant B: the data under attack.
    personBNumber = `B${stamp.toUpperCase().slice(0, 8)}`;
    const created = await http()
      .post('/api/v1/people')
      .set(as(tokens.bob))
      .send({ personNumber: personBNumber, legalName: { en: 'Bob Tenant B Person', ar: 'شخص' } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    personB =
      (created.body as { personId?: string; id?: string }).personId ??
      (created.body as { id?: string }).id ??
      '';
    expect(personB).not.toBe('');
  });

  afterAll(async () => {
    await application?.close();
    // Restore exactly what was there: later suites in this worker read the process environment.
    restoreEnvironment?.();
    await new Promise((resolve) => identity?.close(resolve));
    if (admin !== undefined) {
      for (const tenant of [tenantA, tenantB]) {
        if (tenant === '') continue;
        await admin.query('delete from tenant_platform_binding where tenant_id = $1', [tenant]);
        await admin.query('delete from tenant_membership where tenant_id = $1', [tenant]);
      }
      await admin.query('delete from workforce_user where platform_user_id like $1', [
        `%-${stamp}`,
      ]);
      await admin.end();
    }
  });

  /**
   * No B data in the body. `instance` is left out: it echoes the path the caller sent, which may
   * hold B's id because the caller typed it, and so discloses nothing the caller did not know.
   */
  const leaksNothing = (body: unknown) => {
    const { instance: _echoedPath, ...rest } = (body ?? {}) as Record<string, unknown>;
    const text = JSON.stringify(rest);
    expect(text).not.toContain(personB);
    expect(text).not.toContain(personBNumber);
    expect(text).not.toContain('Bob Tenant B Person');
  };

  describe('1-3. mallory names tenant B with her organisation-A token', () => {
    it('cannot read B’s person, and learns nothing', async () => {
      const response = await http()
        .get(`/api/v1/people/${personB}`)
        .set(as(tokens.mallory, tenantB));
      expect(response.status).toBe(401);
      leaksNothing(response.body);
    });

    it('cannot update it, and the row is unchanged', async () => {
      const before = await personRow(personB);
      const response = await http()
        .patch(`/api/v1/people/${personB}`)
        .set(as(tokens.mallory, tenantB))
        .send({ legalName: { en: 'Changed by mallory', ar: 'تغيير' }, expectedVersion: 1 });
      expect(response.status).toBe(401);
      leaksNothing(response.body);
      expect(await personRow(personB)).toEqual(before);
    });

    it('cannot change its status (the archive/delete path), and the row is unchanged', async () => {
      const before = await personRow(personB);
      const response = await http()
        .patch(`/api/v1/people/${personB}/status`)
        .set(as(tokens.mallory, tenantB))
        .send({ status: 'inactive', expectedVersion: 1 });
      expect(response.status).toBe(401);
      expect(await personRow(personB)).toEqual(before);
    });

    it('cannot create in B: nothing is written', async () => {
      const response = await http()
        .post('/api/v1/people')
        .set(as(tokens.mallory, tenantB))
        .send({
          personNumber: `M${stamp.toUpperCase().slice(0, 8)}`,
          legalName: { en: 'Planted', ar: 'مزروع' },
        });
      expect(response.status).toBe(401);
      const planted = await admin.query('select 1 from person where person_number = $1', [
        `M${stamp.toUpperCase().slice(0, 8)}`,
      ]);
      expect(planted.rows).toHaveLength(0);
    });
  });

  describe('4-6. nested resources, search, export and download', () => {
    for (const [label, path] of [
      ['the nested profile', () => `/api/v1/people/${personB}/profile`],
      ['search', () => `/api/v1/people?name=Bob`],
      ['export', () => '/api/v1/people/export'],
    ] as const) {
      it(`${label}: refused with tenant B named, and B absent when acting in A`, async () => {
        const named = await http().get(path()).set(as(tokens.mallory, tenantB));
        expect(named.status).toBe(401);
        leaksNothing(named.body);

        // Acting in A — where her grants were issued — B's records are not visible at all.
        const inA = await http().get(path()).set(as(tokens.mallory));
        expect([200, 404]).toContain(inA.status);
        leaksNothing(inA.body);
      });
    }

    it('B’s person id addressed from tenant A is not found, and the row is unchanged', async () => {
      const before = await personRow(personB);
      const read = await http().get(`/api/v1/people/${personB}`).set(as(tokens.mallory));
      expect(read.status).toBe(404);
      leaksNothing(read.body);
      const write = await http()
        .patch(`/api/v1/people/${personB}`)
        .set(as(tokens.mallory))
        .send({ legalName: { en: 'Changed from A', ar: 'تغيير' }, expectedVersion: 1 });
      expect([400, 404, 409]).toContain(write.status);
      leaksNothing(write.body);
      expect(await personRow(personB)).toEqual(before);
    });

    it('a document download for an id from another tenant is refused without a link', async () => {
      const response = await http()
        .post(`/api/v1/documents/${randomUUID()}/download`)
        .set(as(tokens.mallory, tenantB))
        .send({ purpose: 'review' });
      expect(response.status).toBe(401);
      expect(JSON.stringify(response.body)).not.toMatch(/https?:\/\//);
    });
  });

  describe('7-9. missing, invalid and revoked context', () => {
    it('7. a token for an organisation bound to no tenant reaches nothing', async () => {
      const stray = tokenFor(subjects.mallory, `org-unbound-${stamp}`).token;
      for (const tenant of [undefined, tenantA, tenantB]) {
        const response = await http().get('/api/v1/people/export').set(as(stray, tenant));
        expect(response.status).toBe(401);
      }
    });

    it('7. a token with no organisation claim is not a principal', async () => {
      const raw = mintToken(subjects.alice, '', ADMIN_GRANTS).token;
      expect((await http().get('/api/v1/people/export').set(as(raw))).status).toBe(401);
    });

    it('8. an ended membership in the bound tenant stops resolving', async () => {
      const temp = `temp-${stamp}`;
      await admit(temp, tenantA);
      const token = tokenFor(temp, ORG_A).token;
      expect((await http().get('/api/v1/people/export').set(as(token))).status).toBe(200);

      await inTenant(
        admin,
        tenantA,
        `update tenant_membership set status = 'suspended'
           where workforce_user_id = (select id from workforce_user where platform_user_id = $1)`,
        [temp],
      );
      expect((await http().get('/api/v1/people/export').set(as(token))).status).toBe(401);
    });

    it('9. a revoked session is refused at once', async () => {
      const issued = tokenFor(subjects.alice, ORG_A);
      expect((await http().get('/api/v1/people/export').set(as(issued.token))).status).toBe(200);
      revoked.add(issued.claims.sid ?? '');
      expect((await http().get('/api/v1/people/export').set(as(issued.token))).status).toBe(401);
    });
  });

  describe('9-10. multiple memberships and privilege boundaries', () => {
    it('9. with her organisation-B token mallory acts in B with her B grants only (none), not her A grants', async () => {
      // In organisation B mallory holds no People role, so her B token carries no People grant.
      const bToken = tokenFor(subjects.mallory, ORG_B, []).token;
      const read = await http().get(`/api/v1/people/${personB}`).set(as(bToken));
      expect(read.status).toBe(403);
      leaksNothing(read.body);
      // And it cannot be pointed at A, where her administrator grants live.
      expect((await http().get('/api/v1/people/export').set(as(bToken, tenantA))).status).toBe(401);
    });

    it('10. a wildcard or foreign-product grant confers nothing; there is no operator bypass', async () => {
      const wildcard = tokenFor(subjects.alice, ORG_A, ['work:*', 'docs:*', '*']).token;
      const response = await http().get('/api/v1/people/export').set(as(wildcard));
      expect(response.status).toBe(403);
    });
  });

  describe('12. caching', () => {
    it('authenticated answers are no-store and vary by credential and tenant', async () => {
      const response = await http().get('/api/v1/people/export').set(as(tokens.alice));
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.vary).toMatch(/Authorization/i);
      expect(response.headers.vary).toMatch(/X-Munaxa-Tenant/i);

      const refused = await http().get('/api/v1/people/export');
      expect(refused.headers['cache-control']).toBe('no-store');
    });

    it('the same URL answers each tenant with its own rows only', async () => {
      const forB = await http().get('/api/v1/people/export').set(as(tokens.bob));
      const forA = await http().get('/api/v1/people/export').set(as(tokens.alice));
      expect(JSON.stringify(forB.body)).toContain(personBNumber);
      leaksNothing(forA.body);
    });
  });
});
