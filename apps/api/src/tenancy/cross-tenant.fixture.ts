import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';

import { TokenService } from '@munaxa/auth';
import { AsymmetricSigner } from '@munaxa/crypto';
import type { Client } from 'pg';

/**
 * Harness concerns of `cross-tenant.postgres.spec.ts`: which database to use, and setting the
 * process environment the real `AppModule` reads, then putting it back exactly.
 *
 * In a `.fixture.ts` for the reason `apps/api/eslint.config.mjs` gives: choosing a database and
 * staging an environment for a booted application are harness work, not business configuration.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** A suite that quietly skips itself where merges are gated reports a property nobody checked. */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

/** Sets `values` on the process environment and returns the function that restores it. */
export const stageEnvironment = (values: Readonly<Record<string, string>>): (() => void) => {
  const saved = { ...process.env };
  Object.assign(process.env, values);
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) Reflect.deleteProperty(process.env, key);
    }
    Object.assign(process.env, saved);
  };
};

export const RUNTIME = 'work_app';
export const PASSWORD = 'probe';
export const ISSUER = 'https://identity.cross-tenant.invalid';
export const KID = 'cross-tenant-test';

/** The repository's runtime grants, found by walking up (this package compiles as CommonJS). */
const GRANTS = ((): string => {
  for (let directory = process.cwd(); ; directory = dirname(directory)) {
    const candidate = resolve(directory, 'deploy/aws/runtime-grants.sql');
    if (existsSync(candidate)) return candidate;
    if (dirname(directory) === directory)
      throw new Error('deploy/aws/runtime-grants.sql not found');
  }
})();

export const keys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const signer = new TokenService({
  signer: new AsymmetricSigner('ES256', [
    { kid: KID, privateKey: keys.privateKey, publicKey: keys.publicKey },
  ]),
  issuer: ISSUER,
  audience: ['munaxa-work'],
});

/** A real ES256 access token for `sub` in `organisation`, with a fresh session. */
export const mintToken = (
  sub: string,
  organisation: string,
  grants: readonly string[],
): ReturnType<TokenService['issueAccessToken']> =>
  signer.issueAccessToken({
    subject: sub,
    tenantId: organisation as never,
    tokenVersion: 1,
    sessionId: `sess_${randomUUID()}` as never,
    permissions: grants,
  });

/**
 * Identity's `GET /api/auth/introspect` contract over real HTTP: active for a token this harness
 * signed whose session is not in `revoked`, inactive otherwise.
 */
export const startIdentityStandIn = async (
  revoked: ReadonlySet<string>,
): Promise<{ server: Server; url: string }> => {
  const server = createServer((incoming, response) => {
    const token = /^Bearer (\S+)$/.exec(incoming.headers.authorization ?? '')?.[1] ?? '';
    let body: unknown = { active: false };
    try {
      const claims = signer.verifyAccessToken(token);
      if (claims.sid !== undefined && !revoked.has(claims.sid)) {
        body = { active: true, sub: claims.sub, tid: claims.tid, sid: claims.sid, exp: claims.exp };
      }
    } catch {
      // inactive
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${String(port)}/api/auth/introspect` };
};

/** The runtime role, holding exactly `deploy/aws/runtime-grants.sql` and nothing more. */
export const applyRuntimeGrants = async (admin: Client): Promise<void> => {
  await admin.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${RUNTIME}') then
        create role ${RUNTIME} login nosuperuser nobypassrls password '${PASSWORD}';
      end if;
    end $$`);
  await admin.query(`alter role ${RUNTIME} login nosuperuser nobypassrls password '${PASSWORD}'`);
  await admin.query(readFileSync(GRANTS, 'utf8'));
};

/** Runs one statement as the admin connection, inside `tenant`'s context. */
export const inTenant = async (
  admin: Client,
  tenant: string,
  sql: string,
  values: unknown[],
): Promise<void> => {
  await admin.query('begin');
  await admin.query('select set_config($1, $2, true)', ['app.tenant_id', tenant]);
  await admin.query(sql, values);
  await admin.query('commit');
};

/** Makes `sub` an active member of `tenant`, creating the workforce user on first sight. */
export const admitTo = async (admin: Client, sub: string, tenant: string): Promise<void> => {
  const known = await admin.query<{ id: string }>(
    'select id from workforce_user where platform_user_id = $1',
    [sub],
  );
  const userId = known.rows[0]?.id ?? randomUUID();
  if (known.rows[0] === undefined) {
    await inTenant(
      admin,
      tenant,
      `insert into workforce_user (id, platform_user_id, status, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'active', now(), 'test', now(), 'test', 1)`,
      [userId, sub],
    );
  }
  await inTenant(
    admin,
    tenant,
    `insert into tenant_membership (id, tenant_id, workforce_user_id, status, joined_at, created_at, created_by, updated_at, updated_by, version)
     values (app_uuid_v7(), $1, $2, 'active', now(), now(), 'test', now(), 'test', 1)`,
    [tenant, userId],
  );
};

/** Binds `tenant` to `organisation` of this harness's issuer, as bootstrap does (ADR-0080). */
export const bindTo = (admin: Client, tenant: string, organisation: string): Promise<void> =>
  inTenant(
    admin,
    tenant,
    `insert into tenant_platform_binding (tenant_id, platform_issuer, platform_tenant_id, created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, now(), 'test', now(), 'test', 1)`,
    [tenant, ISSUER, organisation],
  );
