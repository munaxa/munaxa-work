import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { TokenService } from '@munaxa/auth';
import { AsymmetricSigner } from '@munaxa/crypto';
import { loadEnvironment } from '@work/config';
import type { PlatformAuthenticationPort, PlatformPrincipal } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { authenticationPortFor } from './authentication-port.js';

/**
 * WK-02 end to end on the Work side: **real** ES256 tokens, the **real** adapter and verifier built
 * from a real environment exactly as the composition root builds them, **two independent port
 * instances** standing for two Work API tasks, and real HTTP to an Identity stand-in.
 *
 * The stand-in implements Identity's contract for `GET /api/auth/introspect` and the session rules
 * behind it — a session row, an account token version and status, refresh rotation with reuse
 * detection — in memory. It is a model, and deliberately a small one: that the real Identity holds
 * to these rules after every revocation route is proved in munaxa-identity
 * (`token-introspection.integration.test.ts`). What this file proves is that Work, given an Identity
 * that holds to them, stops honouring a revoked session on every instance within the window, and
 * that nothing on the Work side — a cache, a second instance, a refresh, an outage — brings it back.
 */

const ISSUER = 'https://identity.test.invalid';
const AUDIENCE = 'munaxa-work';
const KID = 'identity-test';
const keys = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Identity's side: signs, keeps sessions, and answers introspection. */
class IdentityStandIn {
  public readonly minted = new TokenService({
    signer: new AsymmetricSigner('ES256', [
      { kid: KID, privateKey: keys.privateKey, publicKey: keys.publicKey },
    ]),
    issuer: ISSUER,
    audience: [AUDIENCE],
  });
  public readonly accounts = new Map<string, { tid: string; ver: number; active: boolean }>();
  public readonly sessions = new Map<string, { sub: string; tid: string; revoked: boolean }>();
  /** refresh token → { sid, used } */
  public readonly refreshTokens = new Map<string, { sid: string; used: boolean }>();
  public mode: 'up' | 'unavailable' | 'slow' = 'up';
  public introspections = 0;
  private server: Server | undefined;
  public url = '';

  public async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.answer(request.headers.authorization, request.url ?? '').then(
        ({ status, body }) => {
          response.writeHead(status, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          });
          response.end(JSON.stringify(body));
        },
      );
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${String(port)}/api/auth/introspect`;
  }

  public async stop(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve));
  }

  private async answer(
    authorization: string | undefined,
    path: string,
  ): Promise<{ status: number; body: unknown }> {
    this.introspections += 1;
    if (path !== '/api/auth/introspect') return { status: 404, body: {} };
    if (this.mode === 'unavailable') return { status: 503, body: { code: 'AUTH_UNAVAILABLE' } };
    if (this.mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 1_000));
    const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1];
    if (token === undefined) return { status: 200, body: { active: false } };
    try {
      const claims = this.minted.verifyAccessToken(token);
      return {
        status: 200,
        body: this.isLive(claims)
          ? { active: true, sub: claims.sub, tid: claims.tid, sid: claims.sid, exp: claims.exp }
          : { active: false },
      };
    } catch {
      return { status: 200, body: { active: false } };
    }
  }

  /** Identity's `resolvePrincipal`, in miniature: account active, version current, session live. */
  private isLive(claims: { sub: string; tid?: string; sid?: string; ver?: number }): boolean {
    const account = this.accounts.get(claims.sub);
    const session = claims.sid === undefined ? undefined : this.sessions.get(claims.sid);
    if (account === undefined || session === undefined) return false;
    return (
      account.active &&
      account.ver === claims.ver &&
      !session.revoked &&
      session.sub === claims.sub &&
      session.tid === claims.tid
    );
  }

  public signIn(sub: string, tid = 'org-a'): { access: string; refresh: string; sid: string } {
    if (!this.accounts.has(sub)) this.accounts.set(sub, { tid, ver: 1, active: true });
    const sid = `sess_${randomUUID()}`;
    this.sessions.set(sid, { sub, tid, revoked: false });
    return { access: this.mint(sub, sid), refresh: this.newRefresh(sid), sid };
  }

  /** Rotation with reuse detection, as Identity's `attemptRefresh` does it. */
  public refresh(token: string): { access: string; refresh: string } | undefined {
    const record = this.refreshTokens.get(token);
    if (record === undefined) return undefined;
    const session = this.sessions.get(record.sid);
    if (record.used) {
      if (session !== undefined) session.revoked = true; // two parties hold the lineage
      return undefined;
    }
    record.used = true;
    if (session === undefined || session.revoked) return undefined;
    const account = this.accounts.get(session.sub);
    if (account === undefined || !account.active) return undefined;
    return { access: this.mint(session.sub, record.sid), refresh: this.newRefresh(record.sid) };
  }

  public revoke(sid: string): void {
    const session = this.sessions.get(sid);
    if (session !== undefined) session.revoked = true;
  }

  /** Password reset or change: version bump and every session. */
  public resetPassword(sub: string): void {
    const account = this.accounts.get(sub);
    if (account !== undefined) account.ver += 1;
    for (const session of this.sessions.values()) if (session.sub === sub) session.revoked = true;
  }

  /** Lockdown: status first, sessions after (the order Identity's `disable` uses). */
  public lockDown(sub: string, alsoRevokeSessions = true): void {
    const account = this.accounts.get(sub);
    if (account !== undefined) account.active = false;
    if (alsoRevokeSessions) {
      for (const session of this.sessions.values()) if (session.sub === sub) session.revoked = true;
    }
  }

  public mint(sub: string, sid: string, ttlMs?: number): string {
    const account = this.accounts.get(sub);
    return this.minted.issueAccessToken({
      subject: sub,
      tenantId: (account?.tid ?? 'org-a') as never,
      tokenVersion: account?.ver ?? 1,
      sessionId: sid as never,
      authMethods: ['pwd', 'otp'],
      mfaSatisfied: true,
      permissions: ['work:organization:tenant-settings:read'],
      ...(ttlMs === undefined ? {} : { ttl: ttlMs }),
    }).token;
  }

  private newRefresh(sid: string): string {
    const token = randomBytes(24).toString('base64url');
    this.refreshTokens.set(token, { sid, used: false });
    return token;
  }
}

const identity = new IdentityStandIn();

const workInstance = (
  cacheMs: number,
  overrides: Record<string, string> = {},
): PlatformAuthenticationPort =>
  authenticationPortFor(
    loadEnvironment({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
      PLATFORM_AUTH_ISSUER: ISSUER,
      PLATFORM_AUTH_AUDIENCE: AUDIENCE,
      PLATFORM_AUTH_ALGORITHM: 'ES256',
      PLATFORM_AUTH_PUBLIC_KEYS: JSON.stringify([{ kid: KID, publicKey: keys.publicKey }]),
      PLATFORM_AUTH_INTROSPECTION_URL: identity.url,
      PLATFORM_AUTH_REVOCATION_CACHE_MS: String(cacheMs),
      PLATFORM_AUTH_INTROSPECTION_TIMEOUT_MS: '300',
      ...overrides,
    }),
  );

const asks = (
  port: PlatformAuthenticationPort,
  token: string,
): Promise<PlatformPrincipal | undefined> => port.authenticate({ scheme: 'Bearer', value: token });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let instanceA: PlatformAuthenticationPort;
let instanceB: PlatformAuthenticationPort;

beforeAll(async () => {
  await identity.start();
});
afterAll(async () => {
  await identity.stop();
});
beforeEach(() => {
  identity.mode = 'up';
  // No positive cache: "immediately after revocation" means the very next request.
  instanceA = workInstance(0);
  instanceB = workInstance(0);
});

describe('one session across two Work API instances', () => {
  it('1. is accepted before revocation, with its organisation, session and MFA claims intact', async () => {
    const { access, sid } = identity.signIn(`acct-${randomUUID()}`);
    const principal = await asks(instanceA, access);
    expect(principal).toMatchObject({
      platformTenantId: 'org-a',
      sessionId: sid,
      authenticationMethods: ['pwd', 'otp'],
      mfaSatisfied: true,
      permissions: ['organization.tenant-settings.read'],
    });
    expect(await asks(instanceB, access)).toBeDefined();
  });

  it('2-3. is refused immediately after revocation, on both instances', async () => {
    const { access, sid } = identity.signIn(`acct-${randomUUID()}`);
    expect(await asks(instanceA, access)).toBeDefined();
    expect(await asks(instanceB, access)).toBeDefined();

    identity.revoke(sid);

    expect(await asks(instanceA, access)).toBeUndefined();
    expect(await asks(instanceB, access)).toBeUndefined();
  });

  it('3. with the default 5 s window, both instances refuse once it has passed', async () => {
    const first = workInstance(300);
    const second = workInstance(300);
    const { access, sid } = identity.signIn(`acct-${randomUUID()}`);
    expect(await asks(first, access)).toBeDefined();
    expect(await asks(second, access)).toBeDefined();

    identity.revoke(sid);
    await sleep(320);

    expect(await asks(first, access)).toBeUndefined();
    expect(await asks(second, access)).toBeUndefined();
  });
});

describe('refresh cannot restore a revoked session', () => {
  it('4. a refresh after revocation mints nothing, and the old token stays refused', async () => {
    const signedIn = identity.signIn(`acct-${randomUUID()}`);
    identity.revoke(signedIn.sid);
    expect(identity.refresh(signedIn.refresh)).toBeUndefined();
    expect(await asks(instanceA, signedIn.access)).toBeUndefined();
  });

  it('5. a replayed refresh token revokes the session; every token of the lineage is refused', async () => {
    const signedIn = identity.signIn(`acct-${randomUUID()}`);
    const rotated = identity.refresh(signedIn.refresh);
    expect(rotated).toBeDefined();
    expect(await asks(instanceA, rotated?.access ?? '')).toBeDefined();

    expect(identity.refresh(signedIn.refresh)).toBeUndefined(); // replay

    expect(await asks(instanceA, signedIn.access)).toBeUndefined();
    expect(await asks(instanceB, rotated?.access ?? '')).toBeUndefined();
    expect(identity.refresh(rotated?.refresh ?? '')).toBeUndefined();
  });

  it('12. a refresh racing a revocation: every token minted in the race is refused afterwards', async () => {
    const signedIn = identity.signIn(`acct-${randomUUID()}`);
    const minted = [signedIn.access];
    let refreshToken = signedIn.refresh;

    await Promise.all([
      (async () => {
        for (let step = 0; step < 5; step += 1) {
          const rotated = identity.refresh(refreshToken);
          if (rotated === undefined) return;
          minted.push(rotated.access);
          refreshToken = rotated.refresh;
          // Each new token is used on a Work instance while the race runs.
          await asks(step % 2 === 0 ? instanceA : instanceB, rotated.access);
        }
      })(),
      (async () => {
        await sleep(1);
        identity.revoke(signedIn.sid);
      })(),
    ]);

    for (const access of minted) {
      expect(await asks(instanceA, access)).toBeUndefined();
      expect(await asks(instanceB, access)).toBeUndefined();
    }
  });
});

describe('every revocation route', () => {
  it('6. logout, then the access token is reused', async () => {
    const signedIn = identity.signIn(`acct-${randomUUID()}`);
    expect(await asks(instanceA, signedIn.access)).toBeDefined();
    identity.revoke(signedIn.sid); // what logout does to the session
    expect(await asks(instanceB, signedIn.access)).toBeUndefined();
  });

  it('7. password recovery, then any earlier access token is reused', async () => {
    const sub = `acct-${randomUUID()}`;
    const one = identity.signIn(sub);
    const two = identity.signIn(sub);
    identity.resetPassword(sub);
    for (const access of [one.access, two.access]) {
      expect(await asks(instanceA, access)).toBeUndefined();
      expect(await asks(instanceB, access)).toBeUndefined();
    }
    // A fresh sign-in at the new version works.
    expect(await asks(instanceA, identity.signIn(sub).access)).toBeDefined();
  });

  it('8. account lockdown, even before its session step has run', async () => {
    const sub = `acct-${randomUUID()}`;
    const signedIn = identity.signIn(sub);
    identity.lockDown(sub, false);
    expect(await asks(instanceA, signedIn.access)).toBeUndefined();
    identity.lockDown(sub, true);
    expect(await asks(instanceB, signedIn.access)).toBeUndefined();
  });
});

describe('failure and malformed input', () => {
  it('9. Identity unavailable (503): refused, and not remembered once it recovers', async () => {
    const instance = workInstance(5_000);
    const signedIn = identity.signIn(`acct-${randomUUID()}`);
    identity.mode = 'unavailable';
    expect(await asks(instance, signedIn.access)).toBeUndefined();
    identity.mode = 'up';
    expect(await asks(instance, signedIn.access)).toBeDefined();
  });

  it('9. Identity unreachable (nothing listening) or too slow: refused', async () => {
    const signedIn = identity.signIn(`acct-${randomUUID()}`);
    const unreachable = workInstance(0, {
      PLATFORM_AUTH_INTROSPECTION_URL: 'http://127.0.0.1:1/api/auth/introspect',
    });
    expect(await asks(unreachable, signedIn.access)).toBeUndefined();

    identity.mode = 'slow'; // 1 s against a 300 ms timeout
    const started = Date.now();
    expect(await asks(instanceA, signedIn.access)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('10. an expired, a malformed and a forged token are refused without asking Identity', async () => {
    const sub = `acct-${randomUUID()}`;
    const signedIn = identity.signIn(sub);
    const expired = identity.mint(sub, signedIn.sid, -120_000);
    const forgerKeys = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const forger = new TokenService({
      signer: new AsymmetricSigner('ES256', [{ kid: KID, ...forgerKeys }]),
      issuer: ISSUER,
      audience: [AUDIENCE],
    });
    const forged = forger.issueAccessToken({
      subject: sub,
      tenantId: 'org-a' as never,
      tokenVersion: 1,
      sessionId: signedIn.sid as never,
    }).token;
    const sessionless = identity.minted.issueAccessToken({
      subject: sub,
      tenantId: 'org-a' as never,
      tokenVersion: 1,
    }).token;

    const before = identity.introspections;
    for (const token of [expired, forged, sessionless, 'not-a-token', 'a.b.c', '']) {
      expect(await asks(instanceA, token)).toBeUndefined();
    }
    expect(identity.introspections).toBe(before);
  });

  it('11. a stale cached "active" does not outlive the window, and a cached refusal is never replaced', async () => {
    const instance = workInstance(200);
    const sub = `acct-${randomUUID()}`;
    const signedIn = identity.signIn(sub);
    expect(await asks(instance, signedIn.access)).toBeDefined();
    identity.revoke(signedIn.sid);
    await sleep(220);
    expect(await asks(instance, signedIn.access)).toBeUndefined();

    // Even if Identity were (wrongly) to report the session live again, the refusal stands.
    const session = identity.sessions.get(signedIn.sid);
    if (session !== undefined) session.revoked = false;
    expect(await asks(instance, signedIn.access)).toBeUndefined();
  });
});

describe('configuration', () => {
  it('production refuses PLATFORM_AUTH_REVOCATION_CHECK=disabled at startup', () => {
    expect(() =>
      workInstance(0, {
        NODE_ENV: 'production',
        PLATFORM_AUTH_REVOCATION_CHECK: 'disabled',
        PII_MATCH_SECRET: 'x'.repeat(48),
        LICENSING_MODE: 'LICENSE_FILE',
        LICENSE_FILE: '/dev/null',
      }),
    ).toThrow(/PLATFORM_AUTH_REVOCATION_CHECK/);
  });

  it('outside production, disabled is the documented local-development escape hatch', async () => {
    const unchecked = workInstance(0, { PLATFORM_AUTH_REVOCATION_CHECK: 'disabled' });
    const signedIn = identity.signIn(`acct-${randomUUID()}`);
    identity.revoke(signedIn.sid);
    const before = identity.introspections;
    expect(await asks(unchecked, signedIn.access)).toBeDefined();
    expect(identity.introspections).toBe(before);
  });
});
