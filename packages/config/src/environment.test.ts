import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadEnvironment } from './environment.js';

const valid = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/work' };

describe('loadEnvironment', () => {
  it('applies documented defaults', () => {
    const environment = loadEnvironment(valid);

    expect(environment.NODE_ENV).toBe('development');
    expect(environment.PORT).toBe(3000);
    expect(environment.LOG_LEVEL).toBe('info');
    expect(environment.DEFAULT_CALENDAR).toBe('gregorian');
  });

  it('coerces numeric variables from strings', () => {
    expect(loadEnvironment({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['on', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['off', false],
  ])('reads LOG_PRETTY=%s as %s', (value, expected) => {
    expect(loadEnvironment({ ...valid, LOG_PRETTY: value }).LOG_PRETTY).toBe(expected);
  });

  it('rejects a boolean spelling it does not understand rather than guessing', () => {
    expect(() => loadEnvironment({ ...valid, OPENAPI_ENABLED: 'maybe' })).toThrow(
      ConfigurationError,
    );
  });

  it('fails when a required variable is missing', () => {
    expect(() => loadEnvironment({})).toThrow(ConfigurationError);
  });

  it('names every invalid variable so the failure is actionable', () => {
    const act = (): unknown => loadEnvironment({ ...valid, PORT: '70000', LOG_LEVEL: 'chatty' });

    expect(act).toThrow(/PORT/);
    expect(act).toThrow(/LOG_LEVEL/);
  });

  it('rejects a database url that is not a url', () => {
    expect(() => loadEnvironment({ DATABASE_URL: 'not-a-url' })).toThrow(ConfigurationError);
  });

  it('returns a frozen value so configuration cannot drift at runtime', () => {
    expect(Object.isFrozen(loadEnvironment(valid))).toBe(true);
  });
});

describe('the People duplicate-match key', () => {
  it('applies a development default so a checkout runs', () => {
    expect(loadEnvironment(valid).PII_MATCH_SECRET).toMatch(/development-only/);
  });

  it('refuses that default in production, because a shipped key is the same key everywhere', () => {
    const act = (): unknown => loadEnvironment({ ...valid, NODE_ENV: 'production' });

    expect(act).toThrow(ConfigurationError);
    expect(act).toThrow(/PII_MATCH_SECRET/);
  });

  it('accepts a real key in production', () => {
    const environment = loadEnvironment({
      ...valid,
      // A production deployment is also a relying party of the issuer, and is refused without
      // one. Configured here so this case stays about the match key.
      AUTH_ISSUER: 'https://issuer.example.invalid',
      AUTH_AUDIENCE: 'munaxa-work',
      AUTH_PUBLIC_KEYS: JSON.stringify([{ kid: 'k', publicKey: '-----BEGIN PUBLIC KEY-----' }]),
      NODE_ENV: 'production',
      PII_MATCH_SECRET: 'a'.repeat(48),
    });

    expect(environment.PII_MATCH_SECRET).toHaveLength(48);
  });

  it('refuses a key too short to be one', () => {
    expect(() => loadEnvironment({ ...valid, PII_MATCH_SECRET: 'short' })).toThrow(
      ConfigurationError,
    );
  });
});

describe('the issuer this deployment is a relying party of', () => {
  const keys = JSON.stringify([
    { kid: 'current', publicKey: '-----BEGIN PUBLIC KEY-----\nMII…\n-----END PUBLIC KEY-----\n' },
  ]);
  const configured = {
    ...valid,
    AUTH_ISSUER: 'https://issuer.example.invalid',
    AUTH_AUDIENCE: 'munaxa-work',
    AUTH_PUBLIC_KEYS: keys,
  };

  it('reads the keys as a list a verifier can be built from', () => {
    const environment = loadEnvironment(configured);

    expect(environment.AUTH_PUBLIC_KEYS).toHaveLength(1);
    expect(environment.AUTH_PUBLIC_KEYS?.[0]?.kid).toBe('current');
    expect(environment.AUTH_SIGNING_ALGORITHM).toBe('RS256');
  });

  it('accepts a deployment that configures no issuer at all', () => {
    // Which authenticates nobody. That is the safe default, and it is refused in production below
    // rather than here: a checkout has to run.
    expect(loadEnvironment(valid).AUTH_ISSUER).toBeUndefined();
  });

  it('refuses a half-configured relying party', () => {
    const act = (): unknown => loadEnvironment({ ...valid, AUTH_ISSUER: 'https://x.invalid' });

    // An issuer with no keys verifies nothing. Failing at startup beats failing at the first
    // request that depended on it.
    expect(act).toThrow(ConfigurationError);
    expect(act).toThrow(/AUTH_ISSUER, AUTH_AUDIENCE and AUTH_PUBLIC_KEYS/);
  });

  it('refuses a production deployment that authenticates nobody', () => {
    const act = (): unknown =>
      loadEnvironment({ ...valid, NODE_ENV: 'production', PII_MATCH_SECRET: 'a'.repeat(48) });

    expect(act).toThrow(ConfigurationError);
    expect(act).toThrow(/AUTH_ISSUER/);
  });

  it('accepts a fully configured production deployment', () => {
    const environment = loadEnvironment({
      ...configured,
      NODE_ENV: 'production',
      PII_MATCH_SECRET: 'a'.repeat(48),
    });

    expect(environment.AUTH_ISSUER).toBe('https://issuer.example.invalid');
  });

  it('refuses key material that is not a list of keys', () => {
    expect(() => loadEnvironment({ ...configured, AUTH_PUBLIC_KEYS: 'not json' })).toThrow(
      ConfigurationError,
    );
    expect(() =>
      loadEnvironment({ ...configured, AUTH_PUBLIC_KEYS: JSON.stringify([{ kid: 'k' }]) }),
    ).toThrow(ConfigurationError);
    expect(() => loadEnvironment({ ...configured, AUTH_PUBLIC_KEYS: '[]' })).toThrow(
      ConfigurationError,
    );
  });
});

describe('loadProcessEnvironment', () => {
  it('reads the real process environment', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/work';
    const { loadProcessEnvironment } = await import('./environment.js');

    expect(loadProcessEnvironment().DATABASE_URL).toContain('postgresql://');
  });
});
