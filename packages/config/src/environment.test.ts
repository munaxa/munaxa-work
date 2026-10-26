import { describe, expect, it } from 'vitest';

import { ConfigurationError, loadEnvironment } from './environment.js';
import { readLicensing } from './licensing.js';

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

describe('loadProcessEnvironment', () => {
  it('reads the real process environment', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/work';
    const { loadProcessEnvironment } = await import('./environment.js');

    expect(loadProcessEnvironment().DATABASE_URL).toContain('postgresql://');
  });
});

describe('licensing', () => {
  const base = { DATABASE_URL: 'postgresql://work@localhost:5432/work' };
  const publicKey = '-----BEGIN PUBLIC KEY-----\nMFkw\n-----END PUBLIC KEY-----';
  const licenceFile = {
    ...base,
    LICENSING_MODE: 'LICENSE_FILE',
    LICENSE_FILE_PATH: '/etc/munaxa/work.license',
    LICENSE_PUBLIC_KEYS: JSON.stringify([{ kid: 'lic-1', publicKey }]),
    LICENSE_INSTALLATION_ID: 'inst-1',
  };

  it('defaults to no licensing, the deployment as it has always been', () => {
    expect(readLicensing(loadEnvironment(base))).toEqual({ kind: 'none' });
  });

  it('reads a licence-file deployment', () => {
    expect(readLicensing(loadEnvironment(licenceFile))).toEqual({
      kind: 'licence-file',
      configuration: {
        path: '/etc/munaxa/work.license',
        algorithm: 'ES256',
        publicKeys: [{ kid: 'lic-1', publicKey }],
        installationId: 'inst-1',
      },
    });
  });

  it.each(['LICENSE_FILE_PATH', 'LICENSE_PUBLIC_KEYS', 'LICENSE_INSTALLATION_ID'])(
    'refuses to start without %s',
    (key) => {
      const source: Record<string, string> = { ...licenceFile };
      delete source[key];
      expect(() => loadEnvironment(source)).toThrow(ConfigurationError);
    },
  );

  it('refuses a private key where public keys belong', () => {
    expect(() =>
      loadEnvironment({
        ...licenceFile,
        LICENSE_PUBLIC_KEYS: JSON.stringify([
          { kid: 'k', publicKey: '-----BEGIN PRIVATE KEY-----\nMIG\n-----END PRIVATE KEY-----' },
        ]),
      }),
    ).toThrow(/private key/);
  });
});
