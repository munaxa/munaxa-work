/**
 * node --test tooling/testing-data
 *
 * The loader's safety rails: it refuses a host that is not plainly Testing or local unless the
 * exact host is confirmed, refuses production outright, recovers from a run that died between the
 * attendance policy and its shift, and takes the password from an owner-only file.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FAKE_TOKEN, startFakeWorkApi } from './fake-work-api.fixture.mjs';
import { ConfigurationError, loadConfig, passwordOf, runLoader } from './load-synthetic.mjs';
import { TargetRefusedError } from './target-guard.mjs';

const SCRIPT = fileURLToPath(new URL('./load-synthetic.mjs', import.meta.url));
const TOKEN = { LOADER_TOKEN_FILE: '/token' };

const configFor = (url, argv = [], extra = {}) =>
  loadConfig({ WORK_BASE_URL: url, ...TOKEN, ...extra }, argv);

const run = (env, argv) =>
  new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...argv], { env }, (error, out, err) =>
      resolve({ code: error ? error.code : 0, stdout: out, stderr: err }),
    );
  });

describe('the target guard', () => {
  test('accepts localhost, 127.0.0.1, ::1 and hosts under .test.munaxa.com', () => {
    for (const url of [
      'http://localhost:3000',
      'http://127.0.0.1:8080',
      'http://[::1]:3000',
      'https://work.test.munaxa.com',
      'https://WORK.Test.Munaxa.com.',
    ]) {
      assert.doesNotThrow(() => configFor(url), url);
    }
  });

  test('refuses any other host without --target-confirm', () => {
    for (const url of [
      'https://work.staging.example',
      'https://test.munaxa.com.attacker.example',
      'https://nottest.munaxa.com',
      'http://127.0.0.2',
    ]) {
      assert.throws(() => configFor(url), TargetRefusedError, url);
    }
  });

  test('accepts another host only with a matching --target-confirm', () => {
    const url = 'https://work.staging.example';
    assert.doesNotThrow(() => configFor(url, ['--target-confirm=work.staging.example']));
    assert.throws(() => configFor(url, ['--target-confirm=staging.example']), TargetRefusedError);
    assert.throws(() => configFor(url, ['--target-confirm=']), ConfigurationError);
  });

  test('refuses production unconditionally, even confirmed', () => {
    for (const host of ['work.munaxa.com', 'api.work.munaxa.com']) {
      assert.throws(() => configFor(`https://${host}`), TargetRefusedError);
      assert.throws(() => configFor(`https://${host}`, [`--target-confirm=${host}`]), /production/);
    }
  });

  test('checks the API and Identity hosts too, not only WORK_BASE_URL', () => {
    const local = 'http://localhost:3000';
    assert.throws(
      () => configFor(local, [], { WORK_API_BASE_URL: 'https://work.munaxa.com' }),
      /production/,
    );
    assert.throws(
      () => configFor(local, [], { IDENTITY_BASE_URL: 'https://identity.example' }),
      TargetRefusedError,
    );
  });

  test('the command exits 2 on a refused target, before any request', async () => {
    const env = { PATH: process.env.PATH, WORK_BASE_URL: 'https://work.munaxa.com', ...TOKEN };
    const refused = await run(env, ['--target-confirm=work.munaxa.com']);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /production/);
    assert.equal(refused.stdout, '');
  });
});

const load = async (fake, argv = ['--employees', '20'], fetch = globalThis.fetch) => {
  const lines = [];
  await runLoader(configFor(fake.url, argv), {
    fetch,
    write: (line) => lines.push(line),
    readFile: () => FAKE_TOKEN,
  });
  return lines;
};

/** A fetch that fails the first shift create: the run dies after its attendance policy. */
const diesBeforeShift = () => {
  let failed = false;
  return (url, init) => {
    if (!failed && init?.method === 'POST' && String(url).endsWith('/attendance/shifts')) {
      failed = true;
      return Promise.reject(new Error('connection reset'));
    }
    return fetch(url, init);
  };
};

describe('a run that died between the attendance policy and its shift', () => {
  test('is recovered: the repeated code (409 policy_code_taken) counts as present', async () => {
    const fake = await startFakeWorkApi();
    try {
      await assert.rejects(load(fake, ['--employees', '20'], diesBeforeShift()));
      assert.equal(fake.count('attendancePolicies'), 1);
      assert.equal(fake.count('shifts'), 0);
      await load(fake);
      assert.equal(fake.count('attendancePolicies'), 1);
      assert.equal(fake.count('shifts'), 1);
      assert.equal(fake.count('people'), 20);
    } finally {
      await fake.close();
    }
  });

  test('before MW-071 (500), stops once with the manual step; the skip flag completes it', async () => {
    const fake = await startFakeWorkApi({ legacyPolicyConflict: true });
    try {
      await assert.rejects(load(fake, ['--employees', '20'], diesBeforeShift()));
      const before = fake.requests.length;
      await assert.rejects(load(fake), (error) => {
        assert.match(error.message, /attendance policy syn-attendance-policy/);
        assert.match(error.message, /--skip-attendance-policy/);
        return true;
      });
      // One policy attempt, no retry loop.
      const attempts = fake.requests
        .slice(before)
        .filter((r) => r.method === 'POST' && r.path.endsWith('/attendance/policies'));
      assert.equal(attempts.length, 1);
      await load(fake, ['--employees', '20', '--skip-attendance-policy']);
      assert.equal(fake.count('attendancePolicies'), 1);
      assert.equal(fake.count('shifts'), 1);
      assert.equal(fake.count('people'), 20);
    } finally {
      await fake.close();
    }
  });
});

describe('LOADER_PASSWORD_FILE', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loader-password-'));
  const file = join(directory, 'password');
  const login = (extra = {}) =>
    loadConfig(
      {
        WORK_BASE_URL: 'http://localhost:3000',
        LOADER_IDENTIFIER: 'loader@example.test',
        LOADER_PASSWORD_FILE: file,
        ...extra,
      },
      [],
    );
  const io = (lines, secrets) => ({
    readFile: (path) => `${path === file ? 'Synthetic-File-Password-1!' : ''}\n`,
    fileMode: (path) => statSync(path).mode,
    write: (line) => lines.push(line),
    secret: (value) => secrets.push(value),
  });

  test('is read from an owner-only file and registered for redaction', () => {
    writeFileSync(file, 'unused', { mode: 0o600 });
    chmodSync(file, 0o600);
    const lines = [];
    const secrets = [];
    assert.equal(passwordOf(login(), io(lines, secrets)), 'Synthetic-File-Password-1!');
    assert.deepEqual(secrets, ['Synthetic-File-Password-1!']);
    assert.deepEqual(lines, []);
  });

  test('a group- or world-readable file is refused unless overridden, then warned about', () => {
    chmodSync(file, 0o644);
    assert.throws(() => passwordOf(login(), io([], [])), /chmod 600/);
    const lines = [];
    passwordOf(login({ LOADER_ALLOW_SHARED_PASSWORD_FILE: '1' }), io(lines, []));
    assert.match(lines[0], /^WARN LOADER_PASSWORD_FILE is readable by group or others/);
  });

  test('the command refuses a shared file with exit 2 and never prints the password', async () => {
    writeFileSync(file, 'Synthetic-File-Password-2!\n');
    chmodSync(file, 0o640);
    const env = {
      PATH: process.env.PATH,
      WORK_BASE_URL: 'http://localhost:9',
      LOADER_IDENTIFIER: 'loader@example.test',
      LOADER_PASSWORD_FILE: file,
    };
    const result = await run(env, []);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /chmod 600/);
    assert.ok(!(result.stdout + result.stderr).includes('Synthetic-File-Password-2!'));
    rmSync(directory, { recursive: true, force: true });
  });
});
