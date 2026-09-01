import { createSign, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfigurationError, loadEnvironment, type Environment } from '@work/config';
import { UnauthenticatedPort } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { authenticationPortFor, platformAccessTokenVerifier } from './authentication-port.js';
import {
  PlatformTokenAuthenticationPort,
  type AccessTokenVerifier,
} from './platform-token-authentication.js';

/**
 * Which port a deployment gets, decided from its environment and from nothing else.
 *
 * This is the test that keeps the seam honest. The failure it exists to prevent is not an
 * exception — it is a deployment that was given Platform's issuer and keys, quietly ran with
 * `UnauthenticatedPort`, answered 401 to every request, and looked from the outside exactly
 * like a Platform outage.
 */

const database = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/work' };

/**
 * A real public key, generated when the suite runs rather than written down.
 *
 * `loadEnvironment` refuses anything that is not a PEM public key, so the configured branch
 * cannot be reached with a placeholder — which is the point of refusing it. Generating the key
 * here keeps key-shaped material out of the repository entirely.
 */
const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const configured = {
  ...database,
  PLATFORM_AUTH_ISSUER: 'https://identity.example.com',
  PLATFORM_AUTH_AUDIENCE: 'munaxa-work',
  PLATFORM_AUTH_ALGORITHM: 'ES256',
  PLATFORM_AUTH_PUBLIC_KEYS: JSON.stringify([{ kid: 'k1', publicKey }]),
};

const verifier: AccessTokenVerifier = {
  verifyAccessToken: () => ({ sub: 'u', iss: 'https://identity.example.com', iat: 1 }),
};

const environmentOf = (source: Record<string, string>): Environment => loadEnvironment(source);

describe('a deployment with no Platform authentication configuration', () => {
  it('authenticates nobody, exactly as it does today', () => {
    const port = authenticationPortFor(environmentOf(database), () => verifier);

    expect(port).toBeInstanceOf(UnauthenticatedPort);
  });

  it('never reaches the verifier factory, so a missing Platform package cannot stop it starting', () => {
    const act = (): unknown =>
      authenticationPortFor(environmentOf(database), () => {
        throw new Error('the factory must not be called');
      });

    expect(act).not.toThrow();
  });

  it('still refuses every caller', async () => {
    const port = authenticationPortFor(environmentOf(database), () => verifier);

    expect(await port.authenticate({ scheme: 'Bearer', value: 'a-token' })).toBeUndefined();
  });
});

describe('a deployment with a complete Platform authentication configuration', () => {
  it('verifies tokens through the Platform verifier it was given', () => {
    const port = authenticationPortFor(environmentOf(configured), () => verifier);

    expect(port).toBeInstanceOf(PlatformTokenAuthenticationPort);
  });

  it('hands the configured issuer, audience, algorithm and keys to the factory', () => {
    let received: unknown;
    authenticationPortFor(environmentOf(configured), (configuration) => {
      received = configuration;
      return verifier;
    });

    expect(received).toMatchObject({
      issuer: 'https://identity.example.com',
      audience: ['munaxa-work'],
      algorithm: 'ES256',
      keys: [{ kid: 'k1' }],
      clockSkewMs: 30_000,
    });
  });

  it('authenticates the subject the verifier vouched for', async () => {
    const port = authenticationPortFor(environmentOf(configured), () => verifier);
    const principal = await port.authenticate({ scheme: 'Bearer', value: 'a-token' });

    expect(principal?.platformUserId).toBe('u');
  });
});

describe('a grant that conferred nothing', () => {
  it('is reported through the observer the composition root wires to the logger', async () => {
    const dropped: unknown[] = [];
    const port = authenticationPortFor(
      environmentOf(configured),
      () => ({
        verifyAccessToken: () => ({
          sub: 'u',
          iss: 'https://identity.example.com',
          iat: 1,
          perms: ['work:*', 'users:read', 'work:leave:read'],
        }),
      }),
      (entry) => dropped.push(entry),
    );
    const principal = await port.authenticate({ scheme: 'Bearer', value: 'a-token' });

    expect(principal?.permissions).toEqual(['leave.read']);
    expect(dropped).toEqual([
      { grant: 'work:*', reason: 'wildcard' },
      { grant: 'users:read', reason: 'not-a-work-grant' },
    ]);
  });
});

describe('a deployment with a partial configuration', () => {
  it('never gets as far as choosing a port, because startup already refused', () => {
    expect(() =>
      environmentOf({ ...database, PLATFORM_AUTH_ISSUER: 'https://identity.example.com' }),
    ).toThrow(ConfigurationError);
  });
});

describe('the Platform verifier this repository ships', () => {
  const configuration = {
    issuer: 'https://identity.example.com',
    audience: ['munaxa-work'],
    algorithm: 'ES256',
    keys: [{ kid: 'k1', publicKey }],
    clockSkewMs: 30_000,
  } as const;

  /** A token minted the way Munaxa Identity mints one: ES256, `kid` in the header, real claims. */
  const mint = (claims: Record<string, unknown>, key = privateKey, kid = 'k1'): string => {
    const header = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
    const payload = base64url(
      JSON.stringify({
        sub: 'a-platform-account',
        tid: 'an-identity-organisation',
        iss: 'https://identity.example.com',
        aud: ['munaxa-work'],
        iat: Math.floor(Date.now() / 1_000),
        exp: Math.floor(Date.now() / 1_000) + 900,
        jti: 'jti_test',
        ver: 1,
        ...claims,
      }),
    );
    const signature = createSign('SHA256')
      .update(`${header}.${payload}`)
      .end()
      .sign({ key, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');

    return `${header}.${payload}.${signature}`;
  };

  it('verifies a token signed by the configured key', () => {
    const verifier = platformAccessTokenVerifier(configuration);

    expect(verifier.verifyAccessToken(mint({ perms: ['work:people:person:read'] })).sub).toBe(
      'a-platform-account',
    );
  });

  it('refuses a token signed by a key it was not given', () => {
    const stranger = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const verifier = platformAccessTokenVerifier(configuration);

    expect(() => verifier.verifyAccessToken(mint({}, stranger.privateKey))).toThrow();
  });

  it('refuses a token whose key id it does not hold', () => {
    const verifier = platformAccessTokenVerifier(configuration);

    expect(() => verifier.verifyAccessToken(mint({}, privateKey, 'a-retired-key'))).toThrow();
  });

  it('refuses another issuer, however well signed', () => {
    const verifier = platformAccessTokenVerifier(configuration);

    expect(() => verifier.verifyAccessToken(mint({ iss: 'https://elsewhere.example' }))).toThrow();
  });

  it('refuses an audience this deployment does not answer to', () => {
    const verifier = platformAccessTokenVerifier(configuration);

    expect(() => verifier.verifyAccessToken(mint({ aud: ['munaxa-school'] }))).toThrow();
  });

  it('refuses an expired token', () => {
    const verifier = platformAccessTokenVerifier(configuration);
    const past = Math.floor(Date.now() / 1_000) - 10_000;

    expect(() => verifier.verifyAccessToken(mint({ iat: past, exp: past + 900 }))).toThrow();
  });

  /**
   * The property that makes this Platform's code rather than ours.
   *
   * `AsymmetricSigner` is constructed with public keys only, so this deployment holds no material
   * that could produce a signature it would accept. "Platform owns authentication" (ADR-0001) is a
   * structural fact here, not an intention.
   */
  it('is built from public keys alone, so this deployment cannot mint what it verifies', () => {
    // Resolved from the working directory rather than `import.meta.url`: this package compiles as
    // CommonJS, where `tsc` rejects the meta-property even though vitest would run it.
    const source = readFileSync(join(process.cwd(), 'src/identity/authentication-port.ts'), 'utf8');

    expect(source).toContain('publicKey: key.publicKey');
    expect(source).not.toMatch(/privateKey/);
  });
});

const base64url = (value: string): string => Buffer.from(value).toString('base64url');
