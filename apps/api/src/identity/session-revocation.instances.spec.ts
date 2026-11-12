import { generateKeyPairSync, randomUUID } from 'node:crypto';

import { TokenService } from '@munaxa/auth';
import { AsymmetricSigner } from '@munaxa/crypto';
import { loadEnvironment } from '@work/config';
import type { PlatformAuthenticationPort, PlatformPrincipal } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { authenticationPortFor } from './authentication-port.js';
import { AUDIENCE, ISSUER, IdentityStandIn, KID, keys } from './identity-stand-in.fixture.js';

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

const identity = new IdentityStandIn();

const workInstance = (
  cacheMs: number | undefined,
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
      ...(cacheMs === undefined ? {} : { PLATFORM_AUTH_REVOCATION_CACHE_MS: String(cacheMs) }),
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

  it('2. with no positive cache (window 0), refused on the very next request on both instances', async () => {
    const { access, sid } = identity.signIn(`acct-${randomUUID()}`);
    expect(await asks(instanceA, access)).toBeDefined();
    expect(await asks(instanceB, access)).toBeDefined();

    identity.revoke(sid);

    expect(await asks(instanceA, access)).toBeUndefined();
    expect(await asks(instanceB, access)).toBeUndefined();
  });

  it('3. with a 300 ms window, both instances refuse once it has passed', async () => {
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

describe('the shipped default window', () => {
  it('3. with PLATFORM_AUTH_REVOCATION_CACHE_MS unset (5 s), a revoked session is refused within 5 s', async () => {
    const first = workInstance(undefined);
    const second = workInstance(undefined);
    const { access, sid } = identity.signIn(`acct-${randomUUID()}`);
    expect(await asks(first, access)).toBeDefined();
    expect(await asks(second, access)).toBeDefined();

    identity.revoke(sid);
    // Inside the window a cached positive may still be honoured; that is the documented bound.
    expect(await asks(first, access)).toBeDefined();

    await sleep(5_050);
    expect(await asks(first, access)).toBeUndefined();
    expect(await asks(second, access)).toBeUndefined();
  }, 15_000);
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
