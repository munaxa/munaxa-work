import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadEnvironment } from './environment.js';
import { readPlatformAuthentication } from './platform-authentication.js';

/**
 * The configuration half of the Platform authentication seam.
 *
 * Every key in this file is generated when the suite runs. None is committed, and the private
 * halves — which two of these tests genuinely need, to prove that private material is refused —
 * exist only in memory for the length of the run. A fixture key pasted into a repository is a
 * key somebody eventually uses.
 */

const rsa = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const ec = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
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

describe('a deployment that configured no Platform authentication', () => {
  it('is absent rather than invalid, because that is a supported deployment', () => {
    expect(readPlatformAuthentication({ PLATFORM_AUTH_CLOCK_SKEW_MS: 30_000 })).toEqual({
      kind: 'absent',
    });
  });

  it('stays absent when only the clock tolerance was tuned', () => {
    // The tolerance carries a default and cannot by itself switch verification on or off, so
    // requiring the other four alongside it would be a rule that only ever surprises people.
    expect(readPlatformAuthentication({ PLATFORM_AUTH_CLOCK_SKEW_MS: 5_000 }).kind).toBe('absent');
  });

  it('treats a blank value as unsupplied rather than as an empty issuer', () => {
    const platform = readPlatformAuthentication({
      PLATFORM_AUTH_ISSUER: '   ',
      PLATFORM_AUTH_CLOCK_SKEW_MS: 30_000,
    });

    expect(platform.kind).toBe('absent');
  });
});

describe('a complete configuration', () => {
  it('is read into the contract the verifier needs', () => {
    const platform = readPlatformAuthentication({ ...complete, ...SKEW });

    expect(platform).toMatchObject({
      kind: 'configured',
      configuration: {
        issuer: 'https://identity.example.com',
        audience: ['munaxa-work'],
        algorithm: 'RS256',
        clockSkewMs: 30_000,
      },
    });
  });

  it('accepts ES256 with an elliptic-curve public key', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_ALGORITHM: 'ES256',
      PLATFORM_AUTH_PUBLIC_KEYS: keys({ kid: 'e1', publicKey: ec.publicKey }),
    });

    expect(platform.kind).toBe('configured');
  });

  it('reads several audiences from one comma-separated value', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_AUDIENCE: 'munaxa-work, munaxa-work-admin',
    });

    expect(platform).toMatchObject({
      configuration: { audience: ['munaxa-work', 'munaxa-work-admin'] },
    });
  });

  it('carries every key, so a rotation can publish the next one before switching to it', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_PUBLIC_KEYS: keys(
        { kid: 'k1', publicKey: rsa.publicKey },
        { kid: 'k2', publicKey: ec.publicKey },
      ),
    });

    expect(platform).toMatchObject({
      configuration: { keys: [{ kid: 'k1' }, { kid: 'k2' }] },
    });
  });
});

describe('a partial configuration', () => {
  it.each(Object.keys(complete))('is invalid when %s alone is missing', (missing) => {
    const source: Record<string, string> = { ...complete };
    delete source[missing];
    const platform = readPlatformAuthentication({ ...source, ...SKEW });

    expect(platform.kind).toBe('invalid');
  });

  it('names what was supplied and what was not, so the failure is actionable', () => {
    const platform = readPlatformAuthentication({
      PLATFORM_AUTH_ISSUER: 'https://identity.example.com',
      PLATFORM_AUTH_CLOCK_SKEW_MS: 30_000,
    });

    expect(platform).toMatchObject({ kind: 'invalid' });
    expect(platform.kind === 'invalid' && platform.issues.join(' ')).toContain(
      'PLATFORM_AUTH_PUBLIC_KEYS',
    );
  });

  it('never degrades to absent, which would silently answer 401 to everybody', () => {
    const platform = readPlatformAuthentication({
      PLATFORM_AUTH_ISSUER: 'https://identity.example.com',
      PLATFORM_AUTH_ALGORITHM: 'RS256',
      PLATFORM_AUTH_CLOCK_SKEW_MS: 30_000,
    });

    expect(platform.kind).not.toBe('absent');
  });
});

describe('the algorithm', () => {
  it.each(['HS256', 'HS512', 'none', 'None', 'RS512', 'ES384', ''])('refuses %s', (algorithm) => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_ALGORITHM: algorithm,
    });

    expect(platform.kind).toBe('invalid');
  });

  it('says why a symmetric algorithm is refused, not merely that it is', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_ALGORITHM: 'HS256',
    });

    expect(platform.kind === 'invalid' && platform.issues.join(' ')).toContain('symmetric');
  });
});

describe('the key material', () => {
  it('refuses an entry that carries a private key alongside the public one', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_PUBLIC_KEYS: keys({
        kid: 'k1',
        publicKey: rsa.publicKey,
        privateKey: rsa.privateKey,
      }),
    });

    expect(platform.kind).toBe('invalid');
    expect(platform.kind === 'invalid' && platform.issues.join(' ')).toContain('private key');
  });

  it('refuses a private key pasted into the publicKey field', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_PUBLIC_KEYS: keys({ kid: 'k1', publicKey: rsa.privateKey }),
    });

    expect(platform.kind).toBe('invalid');
  });

  it('refuses an elliptic-curve private key too, not only an RSA one', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_ALGORITHM: 'ES256',
      PLATFORM_AUTH_PUBLIC_KEYS: keys({ kid: 'e1', publicKey: ec.privateKey }),
    });

    expect(platform.kind).toBe('invalid');
  });

  it.each([
    ['not JSON at all', 'BEGIN PUBLIC KEY'],
    ['an empty array', '[]'],
    ['an object rather than an array', '{"kid":"k1"}'],
    ['an entry that is not an object', '["a-key"]'],
  ])('refuses %s', (_description, raw) => {
    expect(
      readPlatformAuthentication({ ...complete, ...SKEW, PLATFORM_AUTH_PUBLIC_KEYS: raw }).kind,
    ).toBe('invalid');
  });

  it('refuses an entry with no kid, because the kid is what selects the key', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_PUBLIC_KEYS: keys({ publicKey: rsa.publicKey }),
    });

    expect(platform.kind).toBe('invalid');
  });

  it('refuses two keys sharing one kid', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_PUBLIC_KEYS: keys(
        { kid: 'k1', publicKey: rsa.publicKey },
        { kid: 'k1', publicKey: ec.publicKey },
      ),
    });

    expect(platform.kind).toBe('invalid');
    expect(platform.kind === 'invalid' && platform.issues.join(' ')).toContain('duplicate kid');
  });

  it('refuses material that is not a PEM public key', () => {
    const platform = readPlatformAuthentication({
      ...complete,
      ...SKEW,
      PLATFORM_AUTH_PUBLIC_KEYS: keys({ kid: 'k1', publicKey: 'a-secret-string' }),
    });

    expect(platform.kind).toBe('invalid');
  });
});

describe('the issuer and audience', () => {
  it('refuses an issuer that is not a URL', () => {
    expect(
      readPlatformAuthentication({ ...complete, ...SKEW, PLATFORM_AUTH_ISSUER: 'identity' }).kind,
    ).toBe('invalid');
  });

  it('refuses an audience that names nothing', () => {
    expect(
      readPlatformAuthentication({ ...complete, ...SKEW, PLATFORM_AUTH_AUDIENCE: ' , , ' }).kind,
    ).toBe('invalid');
  });
});

describe('startup', () => {
  const database = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/work' };

  it('starts with no Platform authentication configured, as every deployment does today', () => {
    expect(loadEnvironment(database).PLATFORM_AUTH_ISSUER).toBeUndefined();
  });

  it('starts with a complete configuration', () => {
    expect(() => loadEnvironment({ ...database, ...complete })).not.toThrow();
  });

  it('refuses to start on a partial configuration rather than answering 401 to everybody', () => {
    const act = (): unknown =>
      loadEnvironment({ ...database, PLATFORM_AUTH_ISSUER: 'https://identity.example.com' });

    expect(act).toThrow(ConfigurationError);
    expect(act).toThrow(/partly configured/);
  });

  it('refuses to start on a symmetric algorithm', () => {
    expect(() =>
      loadEnvironment({ ...database, ...complete, PLATFORM_AUTH_ALGORITHM: 'HS256' }),
    ).toThrow(ConfigurationError);
  });

  it('refuses to start when a private key was supplied', () => {
    expect(() =>
      loadEnvironment({
        ...database,
        ...complete,
        PLATFORM_AUTH_PUBLIC_KEYS: keys({ kid: 'k1', publicKey: rsa.privateKey }),
      }),
    ).toThrow(ConfigurationError);
  });

  it('refuses to start on an issuer that is not a URL', () => {
    expect(() =>
      loadEnvironment({ ...database, ...complete, PLATFORM_AUTH_ISSUER: 'identity' }),
    ).toThrow(ConfigurationError);
  });

  it('refuses to start on an audience that names nothing', () => {
    expect(() => loadEnvironment({ ...database, ...complete, PLATFORM_AUTH_AUDIENCE: '' })).toThrow(
      ConfigurationError,
    );
  });

  it('refuses to start on key material that is not a key', () => {
    expect(() =>
      loadEnvironment({ ...database, ...complete, PLATFORM_AUTH_PUBLIC_KEYS: 'not-json' }),
    ).toThrow(ConfigurationError);
  });

  it('applies the documented clock-skew default', () => {
    expect(loadEnvironment(database).PLATFORM_AUTH_CLOCK_SKEW_MS).toBe(30_000);
  });
});
