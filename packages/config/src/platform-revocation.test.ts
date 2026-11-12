import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadEnvironment } from './environment.js';
import { readPlatformAuthentication } from './platform-authentication.js';

/** The revocation half of the Platform authentication configuration (WK-02, ADR-0080). */

const rsa = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const keys = (...entries: readonly Record<string, unknown>[]): string => JSON.stringify(entries);

/** The four that decide whether authentication is configured. Strings, as an environment holds them. */
const complete = {
  PLATFORM_AUTH_ISSUER: 'https://identity.example.com',
  PLATFORM_AUTH_AUDIENCE: 'munaxa-work',
  PLATFORM_AUTH_ALGORITHM: 'RS256',
  PLATFORM_AUTH_PUBLIC_KEYS: keys({ kid: 'k1', publicKey: rsa.publicKey }),
};

/** The tolerance is already coerced to a number by the time the contract is read. */
const SKEW = { PLATFORM_AUTH_CLOCK_SKEW_MS: 30_000 };

describe('the session revocation check (WK-02, ADR-0080)', () => {
  const database = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/work' };
  const production = {
    NODE_ENV: 'production',
    PII_MATCH_SECRET: 'a-production-match-secret-of-sufficient-length',
    LICENSING_MODE: 'LICENSE_FILE',
    LICENSE_FILE: '/run/licence.json',
  };

  it('is on by default, asking Identity at the issuer’s own /api/auth/introspect', () => {
    expect(readPlatformAuthentication({ ...complete, ...SKEW })).toMatchObject({
      kind: 'configured',
      configuration: {
        revocation: {
          kind: 'introspect',
          url: 'https://identity.example.com/api/auth/introspect',
          cacheMs: 5_000,
          timeoutMs: 2_000,
        },
      },
    });
  });

  it('derives the URL without doubling a trailing slash on the issuer', () => {
    expect(
      readPlatformAuthentication({
        ...complete,
        ...SKEW,
        PLATFORM_AUTH_ISSUER: 'https://identity.example.com/',
      }),
    ).toMatchObject({
      configuration: { revocation: { url: 'https://identity.example.com/api/auth/introspect' } },
    });
  });

  it('takes an explicit URL, window and timeout from the environment', () => {
    const environment = loadEnvironment({
      ...database,
      ...complete,
      PLATFORM_AUTH_INTROSPECTION_URL: 'https://id.internal.example/api/auth/introspect',
      PLATFORM_AUTH_REVOCATION_CACHE_MS: '0',
      PLATFORM_AUTH_INTROSPECTION_TIMEOUT_MS: '500',
    });
    expect(readPlatformAuthentication(environment)).toMatchObject({
      configuration: {
        revocation: {
          kind: 'introspect',
          url: 'https://id.internal.example/api/auth/introspect',
          cacheMs: 0,
          timeoutMs: 500,
        },
      },
    });
  });

  it('refuses a window longer than 30 s, so the check cannot be configured away', () => {
    expect(() =>
      loadEnvironment({ ...database, ...complete, PLATFORM_AUTH_REVOCATION_CACHE_MS: '30001' }),
    ).toThrow(ConfigurationError);
    expect(
      readPlatformAuthentication({
        ...complete,
        ...SKEW,
        PLATFORM_AUTH_REVOCATION_CACHE_MS: 60_000,
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('refuses "disabled" in production, and allows it elsewhere', () => {
    expect(() =>
      loadEnvironment({
        ...database,
        ...complete,
        ...production,
        PLATFORM_AUTH_REVOCATION_CHECK: 'disabled',
      }),
    ).toThrow(/PLATFORM_AUTH_REVOCATION_CHECK/);
    expect(
      readPlatformAuthentication({
        ...complete,
        ...SKEW,
        NODE_ENV: 'development',
        PLATFORM_AUTH_REVOCATION_CHECK: 'disabled',
      }),
    ).toMatchObject({ configuration: { revocation: { kind: 'disabled' } } });
  });

  it('refuses an unknown mode rather than reading it as off', () => {
    expect(
      readPlatformAuthentication({ ...complete, ...SKEW, PLATFORM_AUTH_REVOCATION_CHECK: 'off' }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('refuses plain http in production, and a URL carrying credentials anywhere', () => {
    expect(
      readPlatformAuthentication({
        ...complete,
        ...SKEW,
        NODE_ENV: 'production',
        PLATFORM_AUTH_INTROSPECTION_URL: 'http://identity.internal/api/auth/introspect',
      }),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      readPlatformAuthentication({
        ...complete,
        ...SKEW,
        PLATFORM_AUTH_INTROSPECTION_URL: 'https://user:pass@identity.example.com/x',
      }),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      readPlatformAuthentication({
        ...complete,
        ...SKEW,
        NODE_ENV: 'development',
        PLATFORM_AUTH_INTROSPECTION_URL: 'http://localhost:4001/api/auth/introspect',
      }),
    ).toMatchObject({ kind: 'configured' });
  });
});
