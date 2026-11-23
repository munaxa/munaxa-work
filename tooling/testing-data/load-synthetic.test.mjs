/**
 * node --test tooling/testing-data
 *
 * The loader against an in-memory fake of the Work API (fake-work-api.fixture.mjs): a first run
 * creates the dataset, a second creates nothing, a dry run writes nothing, a run that stopped
 * halfway is completed rather than duplicated, and the dataset carries no real personal data.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FAKE_TOKEN, startFakeWorkApi } from './fake-work-api.fixture.mjs';
import { ConfigurationError, loadConfig, runLoader } from './load-synthetic.mjs';
import {
  FAMILY_NAMES,
  GIVEN_NAMES,
  MAXIMUM_EMPLOYEES,
  MINIMUM_EMPLOYEES,
  employees,
  payrollPeriod,
} from './synthetic-dataset.mjs';

const SCRIPT = fileURLToPath(new URL('./load-synthetic.mjs', import.meta.url));
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const load = async (fake, argv = ['--employees', '20'], io = {}) => {
  const lines = [];
  const config = loadConfig({ WORK_BASE_URL: fake.url, LOADER_TOKEN_FILE: '/token' }, argv);
  const summary = await runLoader(config, {
    fetch: io.fetch ?? globalThis.fetch,
    write: (line) => lines.push(line),
    readFile: () => FAKE_TOKEN,
  });
  return { summary, lines };
};

const writesIn = (requests) => requests.filter((request) => WRITE_METHODS.has(request.method));

describe('idempotency', () => {
  for (const broken of [false, true]) {
    test(`a second run creates nothing${broken ? ' (organization lists answering 500)' : ''}`, async () => {
      const fake = await startFakeWorkApi({ brokenOrganizationLists: broken });
      try {
        const first = await load(fake);
        assert.ok(first.summary.created > 0);
        const requestsAfterFirst = fake.requests.length;
        assert.equal(fake.count('people'), 20);
        assert.equal(fake.count('employments'), 20);
        assert.equal(fake.count('assignments'), 20);
        assert.equal(fake.count('entitlements'), 20);
        assert.equal(fake.count('recurring'), 20);
        assert.equal(fake.count('scheduleAssignments'), 20);
        assert.equal(fake.count('units'), 4);
        assert.equal(fake.count('positions'), 3);
        assert.equal(fake.count('periods'), 1);

        const second = await load(fake);
        assert.equal(second.summary.created, 0, second.lines.join('\n'));
        // The only writes a repeat may send are the ones whose refusal (409) is the check.
        const repeatedWrites = writesIn(fake.requests.slice(requestsAfterFirst));
        assert.equal(repeatedWrites.length, 20);
        assert.ok(
          repeatedWrites.every(
            (request) =>
              request.path.endsWith('/assignments') &&
              request.path.includes('/attendance/schedules/'),
          ),
        );
        assert.equal(fake.count('people'), 20);
        assert.equal(fake.count('scheduleAssignments'), 20);
        assert.match(second.lines.at(-1), /^Done: 0 created, \d+ already present\.$/);
      } finally {
        await fake.close();
      }
    });
  }

  test('a larger count only appends', async () => {
    const fake = await startFakeWorkApi();
    try {
      await load(fake, ['--employees', '20']);
      const grown = await load(fake, ['--employees', '25']);
      assert.equal(fake.count('people'), 25);
      assert.equal(fake.count('units'), 4);
      assert.ok(grown.lines.some((line) => line === 'created person syn-p-021'));
      assert.ok(!grown.lines.some((line) => line === 'created person syn-p-020'));
    } finally {
      await fake.close();
    }
  });

  test('a run that stopped halfway is completed, not duplicated', async () => {
    const fake = await startFakeWorkApi();
    try {
      let calls = 0;
      // Fail every request after the 60th: the first run dies part way through the configuration.
      const flaky = (url, init) => {
        calls += 1;
        return calls > 60 ? Promise.reject(new Error('connection reset')) : fetch(url, init);
      };
      await assert.rejects(load(fake, ['--employees', '20'], { fetch: flaky }));
      await load(fake);
      const settled = await load(fake);
      assert.equal(settled.summary.created, 0);
      assert.equal(fake.count('people'), 20);
      assert.equal(fake.count('segments'), 3);
    } finally {
      await fake.close();
    }
  });
});

describe('dry run', () => {
  test('makes no write on an empty tenant and reports what it would create', async () => {
    const fake = await startFakeWorkApi();
    try {
      const { summary, lines } = await load(fake, ['--dry-run', '--employees', '20']);
      assert.deepEqual(writesIn(fake.requests), []);
      assert.ok(summary.planned > 100);
      assert.ok(lines.includes('would create person syn-p-001'));
      assert.match(lines.at(-1), /^Dry run: /);
    } finally {
      await fake.close();
    }
  });

  test('after a load, plans nothing and still writes nothing', async () => {
    const fake = await startFakeWorkApi();
    try {
      await load(fake);
      const before = writesIn(fake.requests).length;
      const { summary } = await load(fake, ['--dry-run', '--employees', '20']);
      assert.equal(summary.planned, 0);
      assert.equal(writesIn(fake.requests).length, before);
    } finally {
      await fake.close();
    }
  });
});

describe('the dataset', () => {
  test('is deterministic and within 20 to 50 employees', () => {
    assert.deepEqual(employees(30), employees(30));
    assert.deepEqual(employees(20), employees(50).slice(0, 20));
    assert.throws(() => employees(MINIMUM_EMPLOYEES - 1), RangeError);
    assert.throws(() => employees(MAXIMUM_EMPLOYEES + 1), RangeError);
  });

  test('carries no real personal data', () => {
    const roster = employees(MAXIMUM_EMPLOYEES);
    const given = new Set(GIVEN_NAMES.map(([en]) => en));
    const family = new Set(FAMILY_NAMES.map(([en]) => en));
    for (const employee of roster) {
      assert.match(employee.email, /^synthetic\.employee\.\d{3}@example\.test$/);
      const [first, last] = employee.legalName.en.split(' ');
      assert.ok(given.has(first) && family.has(last));
      assert.match(employee.personNumber, /^syn-p-\d{3}$/);
      // No identifier of any kind is generated: no national number, passport or IBAN field exists.
      assert.deepEqual(
        Object.keys(employee).filter((key) => /national|identifier|passport|iban|phone/i.test(key)),
        [],
      );
    }
    assert.equal(new Set(roster.map((e) => e.legalName.en)).size, roster.length);
    assert.equal(new Set(roster.map((e) => e.dateOfBirth)).size, roster.length);
  });

  test('the payroll period is the whole month', () => {
    assert.deepEqual(payrollPeriod('2026-02'), {
      code: 'syn-2026-02',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      paymentDate: '2026-02-25',
    });
    assert.throws(() => payrollPeriod('2026-13'), RangeError);
  });
});

describe('the command', () => {
  test('refuses incomplete inputs with exit code 2', async () => {
    assert.throws(() => loadConfig({}, []), ConfigurationError);
    const { code, stderr } = await new Promise((resolve) => {
      execFile(
        process.execPath,
        [SCRIPT],
        { env: { PATH: process.env.PATH } },
        (error, _out, err) => resolve({ code: error ? error.code : 0, stderr: err }),
      );
    });
    assert.equal(code, 2);
    assert.match(stderr, /Missing inputs/);
  });

  test('never prints the token or the password', async () => {
    const fake = await startFakeWorkApi();
    try {
      const { lines } = await load(fake);
      assert.ok(!lines.join('\n').includes(FAKE_TOKEN));
      const env = {
        PATH: process.env.PATH,
        WORK_BASE_URL: fake.url,
        LOADER_IDENTIFIER: 'loader@example.test',
        LOADER_PASSWORD: 'Synthetic-Password-Not-Real-1!',
      };
      const { stdout, stderr } = await new Promise((resolve) => {
        execFile(process.execPath, [SCRIPT, '--employees', '20'], { env }, (_error, out, err) =>
          resolve({ stdout: out, stderr: err }),
        );
      });
      assert.ok(!(stdout + stderr).includes('Synthetic-Password-Not-Real-1!'));
      assert.match(stderr, /Identity sign-in answered 401/);
    } finally {
      await fake.close();
    }
  });
});
