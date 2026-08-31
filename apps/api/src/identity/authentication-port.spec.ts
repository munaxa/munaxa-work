import { generateKeyPairSync } from 'node:crypto';

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
const { publicKey } = generateKeyPairSync('ec', {
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
  it('refuses rather than verifying, because Munaxa Work must not implement verification', () => {
    // `@munaxa/auth` is not installable here yet (Phase 1, section C). The refusal is the
    // behaviour: a deployment that configured Platform authentication is told its verifier is
    // not wired, rather than silently running as though nobody had configured anything.
    expect(() =>
      platformAccessTokenVerifier({
        issuer: 'https://identity.example.com',
        audience: ['munaxa-work'],
        algorithm: 'ES256',
        keys: [{ kid: 'k1', publicKey }],
        clockSkewMs: 30_000,
      }),
    ).toThrow(ConfigurationError);
  });

  it('says what to do about it', () => {
    const act = (): unknown =>
      platformAccessTokenVerifier({
        issuer: 'https://identity.example.com',
        audience: ['munaxa-work'],
        algorithm: 'ES256',
        keys: [{ kid: 'k1', publicKey }],
        clockSkewMs: 30_000,
      });

    expect(act).toThrow(/@munaxa\/auth/);
  });
});
