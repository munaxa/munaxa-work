import type { Server } from 'node:http';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadProcessEnvironment } from '@work/config';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { platformGrantFor } from '../identity/platform-grants.js';
import { workPermissionCatalogue } from '../identity/work-permission-catalogue.js';
import {
  CONNECTION,
  ISSUER,
  KID,
  PASSWORD,
  RUNTIME,
  admitTo,
  applyRuntimeGrants,
  bindTo,
  keys,
  mintToken,
  requireDatabaseInCi,
  stageEnvironment,
  startIdentityStandIn,
} from '../tenancy/cross-tenant.fixture.js';

/**
 * MW-071: a caller's mistake is answered as one, never as a 500, through the **whole production
 * composition** (the real `AppModule`, PostgreSQL as `work_app`, real ES256 tokens).
 *
 * - A path identifier that is not a UUID is refused at the edge with 400 by `ParseUUIDPipe`, the
 *   pipe Career and Workflow already used. Without it the value reached `where id = $1` and
 *   PostgreSQL's `22P02` escaped as a 500: a defect that told a caller with a typo to report a bug.
 *   Every route of every module is checked, so a route added later without the pipe fails here.
 * - A repeated attendance policy code is 409 `policy_code_taken`, not the unique index's 23505
 *   escaping as a 500. A repeated unit code stays 409 `unit_code_taken`.
 */

requireDatabaseInCi('The refusal suite');
const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const ORGANISATION = `org-refusals-${stamp}`;
const SUBJECT = `administrator-${stamp}`;
const MALFORMED = 'not-a-uuid';

/** Path parameters that are not identifiers, and a well-formed value for each. */
const NOT_IDENTIFIERS: Readonly<Record<string, string>> = {
  attendanceDate: '2026-01-05',
  code: 'syn-code',
  onDate: '2026-01-05',
  subjectKind: 'recurring',
};

interface Route {
  readonly method: string;
  readonly path: string;
}

/** Every route the application registered whose path names an identifier. */
const routesWithIdentifiers = (application: NestExpressApplication): readonly Route[] => {
  const routes = new Map<string, Route>();
  for (const layer of application.getHttpAdapter().getInstance().router.stack) {
    const route = layer.route;
    if (route === undefined || !/:[A-Za-z]+Id\b/.test(route.path)) continue;
    for (const handler of route.stack) {
      const method = handler.method.toUpperCase();
      routes.set(`${method} ${route.path}`, { method, path: route.path });
    }
  }
  return [...routes.values()];
};

/** The route's path with every identifier malformed and every other parameter well formed. */
const malformedPath = (path: string): string =>
  path.replace(/:([A-Za-z]+)/g, (_, name: string) => NOT_IDENTIFIERS[name] ?? MALFORMED);

describeWithDatabase('refusals the caller can act on (MW-071)', () => {
  let admin: Client;
  let application: NestExpressApplication;
  let identity: Server;
  let tenant = '';
  let token = '';
  let restoreEnvironment: (() => void) | undefined;

  const http = () => request(application.getHttpServer());
  const as = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const started = await startIdentityStandIn(new Set());
    identity = started.server;

    admin = new Client({ connectionString: CONNECTION });
    await admin.connect();
    await applyRuntimeGrants(admin);

    tenant = (await admin.query<{ id: string }>('select app_uuid_v7() as id')).rows[0]?.id ?? '';
    await bindTo(admin, tenant, ORGANISATION);
    await admitTo(admin, SUBJECT, tenant);
    token = mintToken(SUBJECT, ORGANISATION, workPermissionCatalogue().map(platformGrantFor)).token;

    const url = new URL(CONNECTION ?? '');
    url.username = RUNTIME;
    url.password = PASSWORD;
    restoreEnvironment = stageEnvironment({
      NODE_ENV: 'test',
      APP_NAME: 'munaxa-work-refusals-test',
      APP_VERSION: '0.0.0-test',
      DATABASE_URL: url.toString(),
      LOG_LEVEL: 'fatal',
      OPENAPI_ENABLED: 'false',
      LICENSING_MODE: 'NONE',
      PLATFORM_AUTH_ISSUER: ISSUER,
      PLATFORM_AUTH_AUDIENCE: 'munaxa-work',
      PLATFORM_AUTH_ALGORITHM: 'ES256',
      PLATFORM_AUTH_PUBLIC_KEYS: JSON.stringify([{ kid: KID, publicKey: keys.publicKey }]),
      PLATFORM_AUTH_INTROSPECTION_URL: started.url,
      PLATFORM_AUTH_REVOCATION_CACHE_MS: '0',
    });
    const { AppModule } = await import('../app.module.js');
    const { configureApplication } = await import('../application.setup.js');
    application = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
    configureApplication(application, loadProcessEnvironment());
    await application.init();
  });

  afterAll(async () => {
    await application?.close();
    restoreEnvironment?.();
    await new Promise((resolve) => identity?.close(resolve));
    if (admin !== undefined) {
      if (tenant !== '') {
        for (const table of [
          'attendance_policy',
          'organization_unit',
          'organization_unit_type',
          'tenant_platform_binding',
          'tenant_membership',
        ]) {
          await admin.query(`delete from ${table} where tenant_id = $1`, [tenant]);
        }
      }
      await admin.query('delete from workforce_user where platform_user_id = $1', [SUBJECT]);
      await admin.end();
    }
  });

  describe('a path identifier that is not a UUID', () => {
    it('is found on the routes of every module', () => {
      const prefixes = new Set(
        routesWithIdentifiers(application).map((route) => route.path.split('/')[3]),
      );

      // A guard against this suite passing because it found nothing to check.
      expect(prefixes.size).toBeGreaterThanOrEqual(15);
    });

    it('answers 400 on every route, never 500', async () => {
      const answers: string[] = [];
      for (const route of routesWithIdentifiers(application)) {
        const path = malformedPath(route.path);
        const response = await http()
          [route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](path)
          .set(as())
          .send(route.method === 'GET' || route.method === 'DELETE' ? undefined : {});
        answers.push(`${String(response.status)} ${route.method} ${route.path}`);
      }

      expect(answers.filter((answer) => !answer.startsWith('400 '))).toEqual([]);
    });

    it('says why, as RFC 9457 problem details that leak nothing internal', async () => {
      const response = await http()
        .get(`/api/v1/leave/requests/${MALFORMED}`)
        .set(as())
        .expect(400);
      const problem = response.body as { status?: number; detail?: string };

      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(problem.status).toBe(400);
      expect(problem.detail).toContain('uuid');
      expect(JSON.stringify(problem)).not.toContain('invalid input syntax');
    });
  });

  describe('a repeated code', () => {
    it('is 409 policy_code_taken for an attendance policy, and the first policy stands', async () => {
      const policy = {
        code: `policy-${stamp}`,
        name: { en: 'Standard attendance', ar: 'الحضور المعتاد' },
        effectiveFrom: '2026-01-01',
      };

      const first = await http().post('/api/v1/attendance/policies').set(as()).send(policy);
      const second = await http().post('/api/v1/attendance/policies').set(as()).send(policy);

      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(second.status, JSON.stringify(second.body)).toBe(409);
      expect((second.body as { detail?: string }).detail).toBe('policy_code_taken');
      const stored = await admin.query<{ count: string }>(
        'select count(*)::text as count from attendance_policy where tenant_id = $1 and code = $2',
        [tenant, policy.code],
      );
      expect(stored.rows[0]?.count).toBe('1');
    });

    it('is 409 unit_code_taken for a unit, in any case', async () => {
      const type = await http()
        .post('/api/v1/organization/unit-types')
        .set(as())
        .send({
          code: `type-${stamp}`,
          name: { en: 'Department', ar: 'قسم' },
          ordinal: 1,
          allowedAtRoot: true,
        });
      expect(type.status, JSON.stringify(type.body)).toBe(201);
      const unit = (code: string) => ({
        unitTypeId: (type.body as { unitTypeId: string }).unitTypeId,
        code,
        name: { en: 'Finance', ar: 'المالية' },
        effectiveFrom: '2026-01-01',
      });

      const first = await http().post('/api/v1/organization/units').set(as()).send(unit('fin'));
      const again = await http().post('/api/v1/organization/units').set(as()).send(unit('fin'));
      const upper = await http().post('/api/v1/organization/units').set(as()).send(unit('FIN'));

      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect([again.status, (again.body as { detail?: string }).detail]).toEqual([
        409,
        'unit_code_taken',
      ]);
      expect([upper.status, (upper.body as { detail?: string }).detail]).toEqual([
        409,
        'unit_code_taken',
      ]);
    });
  });
});
