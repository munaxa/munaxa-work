// Offline tests for the release gate (require-green-ci.mjs). No network, no dependencies:
//   node --test .github/scripts/require-green-ci.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { check, decide, runsUrl } from './require-green-ci.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const REPO = 'munaxa/munaxa-work';
const target = { sha: SHA, repository: REPO };

function run(overrides = {}) {
  return {
    id: 1,
    run_number: 1,
    run_attempt: 1,
    name: 'CI',
    path: '.github/workflows/ci.yml',
    event: 'push',
    head_branch: 'main',
    head_sha: SHA,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-11-23T10:00:00Z',
    html_url: 'https://github.com/munaxa/munaxa-work/actions/runs/1',
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
    ...overrides,
  };
}

function page(...runs) {
  return { total_count: runs.length, workflow_runs: runs };
}

test('accepts a completed, successful push run on main for the exact commit', () => {
  const result = decide(page(run()), target);
  assert.equal(result.ok, true);
  assert.equal(result.run.id, 1);
});

test('refuses when there is no CI run at all (tag without green CI)', () => {
  const result = decide(page(), target);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no "CI" run/);
});

test('refuses a failed, cancelled or skipped run', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral', null]) {
    const result = decide(page(run({ conclusion })), target);
    assert.equal(result.ok, false, `conclusion ${conclusion}`);
  }
});

test('refuses a run that has not completed', () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'pending']) {
    const result = decide(page(run({ status, conclusion: null })), target);
    assert.equal(result.ok, false, `status ${status}`);
    assert.match(result.reason, /not completed/);
  }
});

test('refuses a run for a different commit', () => {
  assert.equal(decide(page(run({ head_sha: OTHER })), target).ok, false);
});

test('refuses pull_request and other events: only push to main counts', () => {
  for (const event of ['pull_request', 'pull_request_target', 'workflow_dispatch', 'schedule']) {
    assert.equal(decide(page(run({ event })), target).ok, false, `event ${event}`);
  }
});

test('refuses a push run on a branch other than main', () => {
  assert.equal(decide(page(run({ head_branch: 'feature' })), target).ok, false);
});

test('refuses another workflow, even one named CI', () => {
  assert.equal(decide(page(run({ path: '.github/workflows/other.yml' })), target).ok, false);
  assert.equal(decide(page(run({ name: 'Publish images' })), target).ok, false);
});

test('refuses a run from a fork or another repository', () => {
  assert.equal(
    decide(page(run({ head_repository: { full_name: 'someone/munaxa-work' } })), target).ok,
    false,
  );
  assert.equal(decide(page(run({ repository: { full_name: 'x/y' } })), target).ok, false);
  assert.equal(decide(page(run({ repository: undefined })), target).ok, false);
});

test('the latest eligible run decides: a later failure outvotes an earlier success', () => {
  const earlier = run({ id: 1, run_number: 1, created_at: '2026-11-23T10:00:00Z' });
  const later = run({
    id: 2,
    run_number: 2,
    created_at: '2026-11-23T11:00:00Z',
    conclusion: 'failure',
  });
  assert.equal(decide(page(earlier, later), target).ok, false);
  assert.equal(decide(page(later, earlier), target).ok, false);
});

test('a later success after an earlier failure is accepted', () => {
  const earlier = run({ id: 1, created_at: '2026-11-23T10:00:00Z', conclusion: 'failure' });
  const later = run({ id: 2, run_number: 2, created_at: '2026-11-23T11:00:00Z' });
  const result = decide(page(earlier, later), target);
  assert.equal(result.ok, true);
  assert.equal(result.run.id, 2);
});

test('ineligible runs never count, even when newer', () => {
  const green = run({ id: 1, created_at: '2026-11-23T10:00:00Z' });
  const prRed = run({
    id: 2,
    event: 'pull_request',
    created_at: '2026-11-23T12:00:00Z',
    conclusion: 'failure',
  });
  assert.equal(decide(page(green, prRed), target).ok, true);
});

test('fails closed on malformed responses', () => {
  for (const body of [
    null,
    undefined,
    'text',
    42,
    {},
    { workflow_runs: 'x' },
    { workflow_runs: [] },
  ]) {
    assert.equal(decide(body, target).ok, false, JSON.stringify(body));
  }
  assert.equal(decide({ total_count: 1, workflow_runs: [null] }, target).ok, false);
});

test('fails closed when the runs do not fit in one page', () => {
  const body = { total_count: 101, workflow_runs: [run()] };
  const result = decide(body, target);
  assert.equal(result.ok, false);
  assert.match(result.reason, /exceed one page/);
});

test('refuses a short or malformed SHA and a malformed repository', () => {
  for (const sha of ['abc1234', 'A'.repeat(40), `${SHA}0`, '', undefined]) {
    assert.equal(decide(page(run()), { sha, repository: REPO }).ok, false, String(sha));
  }
  assert.equal(decide(page(run()), { sha: SHA, repository: 'no-slash' }).ok, false);
});

test('runsUrl asks for this workflow file and this commit only', () => {
  const url = new URL(runsUrl({ apiUrl: 'https://api.github.com/', repository: REPO, sha: SHA }));
  assert.equal(url.pathname, `/repos/${REPO}/actions/workflows/ci.yml/runs`);
  assert.equal(url.searchParams.get('head_sha'), SHA);
  assert.equal(url.searchParams.get('per_page'), '100');
});

function fakeFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { impl, calls };
}

const base = { sha: SHA, repository: REPO, apiUrl: 'https://api.github.com', token: 't' };

test('check passes through a green answer and sends the token as a bearer header', async () => {
  const { impl, calls } = fakeFetch({ ok: true, status: 200, json: async () => page(run()) });
  const result = await check({ ...base, fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.authorization, 'Bearer t');
});

test('check fails closed on HTTP errors', async () => {
  for (const status of [401, 403, 404, 422, 500, 502]) {
    const { impl } = fakeFetch({ ok: false, status, json: async () => page(run()) });
    const result = await check({ ...base, fetchImpl: impl });
    assert.equal(result.ok, false, `HTTP ${status}`);
    assert.match(result.reason, new RegExp(String(status)));
  }
});

test('check fails closed when the network fails or the body is not JSON', async () => {
  const down = fakeFetch(new Error('ECONNRESET'));
  assert.equal((await check({ ...base, fetchImpl: down.impl })).ok, false);
  const garbled = fakeFetch({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  });
  assert.equal((await check({ ...base, fetchImpl: garbled.impl })).ok, false);
});

test('check refuses without a token or with a bad SHA, before calling the API', async () => {
  const { impl, calls } = fakeFetch({ ok: true, status: 200, json: async () => page(run()) });
  assert.equal((await check({ ...base, token: '', fetchImpl: impl })).ok, false);
  assert.equal((await check({ ...base, sha: 'abc', fetchImpl: impl })).ok, false);
  assert.equal(calls.length, 0);
});
