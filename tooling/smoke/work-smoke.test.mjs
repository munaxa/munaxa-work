/**
 * node --test tooling/smoke
 *
 * Runs the smoke script against a fake Work host (fake-work.fixture.mjs): once healthy, once per
 * broken behaviour, and as a child process to prove the exit code and that neither stdout nor
 * stderr carries a token, a cookie value or a supplied password.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LIMITED_PASSWORD,
  LIMITED_REFRESH,
  LIMITED_TOKEN,
  READER_PASSWORD,
  READER_REFRESH,
  READER_TOKEN,
  smokeEnvironment,
  startFakeWork,
} from './fake-work.fixture.mjs';
import { createRedactor, looksTokenShaped } from './redact.mjs';
import { ConfigurationError, loadConfig, runSmoke } from './work-smoke.mjs';

const SCRIPT = fileURLToPath(new URL('./work-smoke.mjs', import.meta.url));
const SECRETS = [
  READER_TOKEN,
  LIMITED_TOKEN,
  READER_REFRESH,
  LIMITED_REFRESH,
  READER_PASSWORD,
  LIMITED_PASSWORD,
];

const run = async (faults = {}, overrides = {}) => {
  const fake = await startFakeWork(faults);
  const lines = [];
  try {
    const summary = await runSmoke(
      loadConfig(
        smokeEnvironment(
          fake.url,
          typeof overrides === 'function' ? overrides(fake.url) : overrides,
        ),
      ),
      {
        fetch: globalThis.fetch,
        write: (line) => lines.push(line),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        readFile: () => '',
        fileMode: () => 0o100600,
        now: () => performance.now(),
      },
    );
    return { summary, lines, requests: fake.requests };
  } finally {
    await fake.close();
  }
};

const outcome = (summary, name) => summary.results.find((result) => result.name === name);

const assertNoSecrets = (text) => {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), 'a supplied secret was printed');
  assert.ok(!text.includes(encodeURIComponent(READER_PASSWORD)), 'an encoded password was printed');
  assert.equal(looksTokenShaped(text), false, `token-shaped output: ${text}`);
};

describe('a healthy Work host', () => {
  test('every probe passes', async () => {
    const { summary, lines } = await run();
    assert.equal(summary.failed, 0, lines.join('\n'));
    assert.equal(summary.passed, 8);
    assert.match(lines.at(-1), /^OK: 8 passed, 0 failed, 0 skipped$/);
    assertNoSecrets(lines.join('\n'));
  });

  test('the API is called with a bearer token and the tenant header, Identity with an origin', async () => {
    const { requests } = await run();
    const read = requests.find(
      (r) => r.path === '/api/v1/organization/unit-types' && r.headers.authorization,
    );
    assert.equal(read.headers['x-munaxa-tenant'], 'tenant-a');
    const login = requests.find((r) => r.path === '/api/auth/login');
    assert.ok(login.headers.origin.startsWith('http://127.0.0.1:'));
    const logout = requests.find((r) => r.path === '/api/auth/logout');
    assert.match(logout.headers.cookie, /__Host-mx_session=/);
  });

  test('WORK_HEALTH_URL=skip skips only the readiness probe and the run is not green', async () => {
    const { summary, lines } = await run({}, { WORK_HEALTH_URL: 'skip' });
    assert.equal(summary.skipped, 1);
    assert.equal(summary.failed, 0);
    assert.ok(lines.includes('readiness NOT VERIFIED'), lines.join('\n'));
    assert.match(lines.at(-1), /^INCOMPLETE: 7 passed, 0 failed, 1 skipped$/);
  });

  test('cross-tenant passes on 403 as well as on 401 "No tenant resolved"', async () => {
    const { summary, lines } = await run({ crossTenantForbidden: true });
    assert.equal(outcome(summary, 'cross-tenant').ok, true, lines.join('\n'));
  });
});

describe('each broken behaviour fails its probe', () => {
  const cases = [
    ['health-ready', { notReady: true }],
    ['unauthenticated', { unauthenticatedAllowed: true }],
    ['persona-read', { readFails: true }],
    ['forbidden', { forbiddenAllowed: true }],
    ['entitlements', { licenceRefuses: true }],
    ['admin-signed-in', { adminSignedOut: true }],
    ['cross-tenant', { crossTenantLeaks: true }],
    ['cross-tenant', { crossTenantNotFound: true }],
    ['cross-tenant', { crossTenantOtherUnauthorized: true }],
    ['logout-revocation', { logoutDoesNotRevoke: true }],
  ];
  for (const [probe, faults] of cases) {
    test(`${probe} (${Object.keys(faults).join(', ')})`, async () => {
      const { summary, lines } = await run(faults);
      assert.equal(outcome(summary, probe).ok, false, lines.join('\n'));
      assert.ok(summary.failed >= 1);
      assert.match(lines.at(-1), /^FAILED: /);
      assertNoSecrets(lines.join('\n'));
    });
  }

  test('a readiness 200 that is not the API body (the admin answering) fails', async () => {
    const { summary, lines } = await run({}, (url) => ({ WORK_HEALTH_URL: `${url}/` }));
    assert.equal(outcome(summary, 'health-ready').ok, false);
    assert.match(lines[0], /not the API readiness body/);
  });

  test('an unreachable host fails the probe instead of crashing the run', async () => {
    const { summary } = await run({}, { WORK_HEALTH_URL: 'http://127.0.0.1:1/health/ready' });
    assert.equal(outcome(summary, 'health-ready').ok, false);
    assert.equal(summary.results.length, 8);
  });

  test('revocation slower than the window fails; within the window passes', async () => {
    const slow = await run({ revocationDelayMs: 1500 }, { SMOKE_REVOCATION_WAIT_SECONDS: '0.5' });
    assert.equal(outcome(slow.summary, 'logout-revocation').ok, false);
    const fast = await run({ revocationDelayMs: 200 }, { SMOKE_REVOCATION_WAIT_SECONDS: '2' });
    assert.equal(outcome(fast.summary, 'logout-revocation').ok, true, fast.lines.join('\n'));
  });

  test('a failed sign-in fails every probe that needs the session', async () => {
    const { summary } = await run({ loginFails: true });
    for (const name of ['persona-read', 'forbidden', 'admin-signed-in', 'logout-revocation']) {
      assert.equal(outcome(summary, name).ok, false);
    }
  });
});

describe('inputs', () => {
  test('missing inputs are named, not guessed', () => {
    assert.throws(() => loadConfig({}), ConfigurationError);
    assert.throws(
      () =>
        loadConfig({
          WORK_BASE_URL: 'http://x',
          SMOKE_READER_TOKEN_FILE: 'a',
          SMOKE_LIMITED_TOKEN_FILE: 'b',
        }),
      /SMOKE_OTHER_TENANT_ID/,
    );
  });

  test('Identity defaults to the Work host, as the Testing ALB routes /api/auth there', () => {
    const config = loadConfig(smokeEnvironment('https://work.example.test/'));
    assert.equal(config.identity, 'https://work.example.test');
    assert.equal(config.healthUrl, 'https://work.example.test/health/ready');
  });
});

describe('redaction', () => {
  test('known secrets, JWT shapes, bearer values and session cookies are removed', () => {
    const { redact, add } = createRedactor(['hunter2-password']);
    add('opaque-refresh-value');
    const text = redact(
      `pw=hunter2-password Bearer abc.def ${READER_TOKEN} __Host-mx_session=xyz; ` +
        `__Secure-mx_refresh=opaque-refresh-value other=fine`,
    );
    assert.ok(!text.includes('hunter2-password'));
    assert.ok(!text.includes('abc.def'));
    assert.ok(!text.includes('xyz'));
    assert.ok(!text.includes('opaque-refresh-value'));
    assert.ok(text.includes('other=fine'));
    assert.equal(looksTokenShaped(text), false);
  });

  test('Basic credentials and api_key / x-api-key values are removed', () => {
    const { redact } = createRedactor();
    const text = redact(
      'authorization: Basic dXNlcjpzM2NyZXQ= x-api-key: k3y-one api_key=k3y-two ' +
        '{"apiKey":"k3y-three"} url?api-key=k3y-four&page=1',
    );
    for (const value of ['dXNlcjpzM2NyZXQ=', 'k3y-one', 'k3y-two', 'k3y-three', 'k3y-four']) {
      assert.ok(!text.includes(value), `${value} was printed: ${text}`);
    }
    assert.ok(text.includes('page=1'));
    assert.equal(looksTokenShaped(text), false);
  });

  test('a token echoed by a hostile server is not printed', async () => {
    const { lines } = await run({ loginFails: true, loginEchoesToken: true });
    assertNoSecrets(lines.join('\n'));
  });
});

describe('the command', () => {
  // A fresh fake host per test: a passing run logs the reader out, which revokes its token.
  let fake;
  let directory;
  before(() => {
    directory = mkdtempSync(join(tmpdir(), 'work-smoke-'));
  });
  beforeEach(async () => {
    fake = await startFakeWork();
  });
  afterEach(async () => {
    await fake.close();
  });
  after(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const command = (env) =>
    new Promise((resolve) => {
      execFile(
        process.execPath,
        [SCRIPT],
        { env: { PATH: process.env.PATH, ...env } },
        (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }),
      );
    });

  test('exits 0 when every probe passes and prints no secret', async () => {
    const { code, stdout, stderr } = await command(smokeEnvironment(fake.url));
    assert.equal(code, 0, stdout + stderr);
    assertNoSecrets(stdout + stderr);
  });

  test('exits 1 when a probe fails and prints no secret', async () => {
    const { code, stdout, stderr } = await command(
      smokeEnvironment(fake.url, { SMOKE_READ_PATH: '/nowhere' }),
    );
    assert.equal(code, 1);
    assertNoSecrets(stdout + stderr);
  });

  test('accepts token files instead of passwords, and never prints the tokens', async () => {
    writeFileSync(join(directory, 'reader'), `${READER_TOKEN}\n`, { mode: 0o600 });
    writeFileSync(join(directory, 'limited'), LIMITED_TOKEN, { mode: 0o600 });
    const { code, stdout, stderr } = await command({
      ...smokeEnvironment(fake.url),
      SMOKE_READER_IDENTIFIER: '',
      SMOKE_READER_PASSWORD: '',
      SMOKE_LIMITED_IDENTIFIER: '',
      SMOKE_LIMITED_PASSWORD: '',
      SMOKE_READER_TOKEN_FILE: join(directory, 'reader'),
      SMOKE_LIMITED_TOKEN_FILE: join(directory, 'limited'),
    });
    assert.equal(code, 0, stdout + stderr);
    assertNoSecrets(stdout + stderr);
  });

  test('exits 3 and says readiness was not verified when the probe is skipped', async () => {
    const { code, stdout } = await command(smokeEnvironment(fake.url, { WORK_HEALTH_URL: 'skip' }));
    assert.equal(code, 3, stdout);
    assert.match(stdout, /readiness NOT VERIFIED/);
    assert.match(stdout, /^INCOMPLETE: /m);
  });

  test('refuses a group- or world-readable token file unless overridden, then warns', async () => {
    const tokenEnv = {
      ...smokeEnvironment(fake.url),
      SMOKE_READER_IDENTIFIER: '',
      SMOKE_READER_PASSWORD: '',
      SMOKE_READER_TOKEN_FILE: join(directory, 'shared'),
    };
    writeFileSync(join(directory, 'shared'), READER_TOKEN);
    chmodSync(join(directory, 'shared'), 0o644);
    const refused = await command(tokenEnv);
    assert.equal(refused.code, 1);
    assert.match(refused.stdout, /readable by group or others/);
    assertNoSecrets(refused.stdout + refused.stderr);

    const allowed = await command({ ...tokenEnv, SMOKE_ALLOW_SHARED_TOKEN_FILE: '1' });
    assert.equal(allowed.code, 0, allowed.stdout + allowed.stderr);
    assert.match(allowed.stdout, /^WARN the token file is readable by group or others/m);
    assertNoSecrets(allowed.stdout + allowed.stderr);
  });

  test('exits 2 on incomplete inputs', async () => {
    const { code, stderr } = await command({ WORK_BASE_URL: fake.url });
    assert.equal(code, 2);
    assert.match(stderr, /Missing inputs/);
  });
});
