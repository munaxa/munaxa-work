#!/usr/bin/env node
// Release gate: refuse to publish an image unless the workflow "CI" (.github/workflows/ci.yml)
// has a completed, successful run for the exact commit being published (MW-009, WK-14).
//
//   node .github/scripts/require-green-ci.mjs <40-hex commit SHA>
//
// Environment: GITHUB_REPOSITORY (owner/name), GITHUB_API_URL (defaults to https://api.github.com)
// and GH_TOKEN, the job's own GITHUB_TOKEN with `actions: read`. Nothing else is needed and
// nothing is written.
//
// What counts as green CI for a commit, and nothing else does:
//   - a run of this repository's .github/workflows/ci.yml (not a fork's, not another workflow);
//   - triggered by `push` to `main`, whose head_sha is exactly the commit (a pull_request run
//     tested the merge result or the branch head, never the commit that landed on main);
//   - of those runs for the commit, the most recent one is `completed` with conclusion `success`.
//     A later failed, cancelled or still-running run for the same commit refuses the release, and
//     an earlier success does not outvote it.
//
// It fails closed: any HTTP error, a response that is not the expected JSON, more runs than one
// page holds, a missing token or a malformed SHA ends in a refusal (exit 1), never in a pass.
// Run it before any build or push.

import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';
export const CI_WORKFLOW_NAME = 'CI';
export const RELEASE_BRANCH = 'main';
const PAGE_SIZE = 100;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Decides from the API response whether `sha` has green CI. Pure: no I/O.
 * @param {unknown} body the parsed JSON of GET .../actions/workflows/ci.yml/runs?head_sha=<sha>
 * @param {{ sha: string, repository: string }} target
 * @returns {{ ok: true, run: { id: number, url: string } } | { ok: false, reason: string }}
 */
export function decide(body, { sha, repository }) {
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha)) {
    return { ok: false, reason: `not a full 40-hex commit SHA: '${String(sha)}'` };
  }
  if (typeof repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    return { ok: false, reason: `not an owner/name repository: '${String(repository)}'` };
  }
  if (body === null || typeof body !== 'object' || !Array.isArray(body.workflow_runs)) {
    return { ok: false, reason: 'the API response has no workflow_runs list' };
  }
  if (typeof body.total_count !== 'number') {
    return { ok: false, reason: 'the API response has no total_count' };
  }
  if (body.total_count > body.workflow_runs.length) {
    return {
      ok: false,
      reason: `${body.total_count} runs for ${sha} exceed one page (${body.workflow_runs.length}); refusing rather than guessing`,
    };
  }

  const repo = repository.toLowerCase();
  const eligible = body.workflow_runs.filter(
    (run) =>
      run !== null &&
      typeof run === 'object' &&
      run.head_sha === sha &&
      run.event === 'push' &&
      run.head_branch === RELEASE_BRANCH &&
      run.path === CI_WORKFLOW_PATH &&
      run.name === CI_WORKFLOW_NAME &&
      typeof run.repository?.full_name === 'string' &&
      run.repository.full_name.toLowerCase() === repo &&
      typeof run.head_repository?.full_name === 'string' &&
      run.head_repository.full_name.toLowerCase() === repo,
  );
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: `no "${CI_WORKFLOW_NAME}" run on a push to ${RELEASE_BRANCH} for ${sha}; merge to ${RELEASE_BRANCH} and wait for CI before tagging`,
    };
  }

  const latest = eligible.reduce((a, b) => (newer(b, a) ? b : a));
  if (latest.status !== 'completed') {
    return {
      ok: false,
      reason: `the latest CI run for ${sha} (${describe(latest)}) is ${String(latest.status)}, not completed`,
    };
  }
  if (latest.conclusion !== 'success') {
    return {
      ok: false,
      reason: `the latest CI run for ${sha} (${describe(latest)}) concluded ${String(latest.conclusion)}, not success`,
    };
  }
  return { ok: true, run: { id: latest.id, url: String(latest.html_url ?? '') } };
}

function newer(a, b) {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb;
  return Number(a.run_number) > Number(b.run_number) || Number(a.id) > Number(b.id);
}

function describe(run) {
  return `run ${String(run.id)} attempt ${String(run.run_attempt ?? 1)}`;
}

/** Builds the one API URL the gate reads. */
export function runsUrl({ apiUrl, repository, sha }) {
  const base = apiUrl.replace(/\/+$/, '');
  const path = `/repos/${repository}/actions/workflows/ci.yml/runs`;
  const query = new URLSearchParams({
    head_sha: sha,
    per_page: String(PAGE_SIZE),
    exclude_pull_requests: 'true',
  });
  return `${base}${path}?${query.toString()}`;
}

/**
 * Fetches and decides. Every failure is a refusal.
 * @param {{ sha: string, repository: string, apiUrl: string, token: string, fetchImpl?: typeof fetch }} input
 */
export async function check({ sha, repository, apiUrl, token, fetchImpl = fetch }) {
  if (!token) return { ok: false, reason: 'no GH_TOKEN; the job needs `actions: read`' };
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha)) {
    return { ok: false, reason: `not a full 40-hex commit SHA: '${String(sha)}'` };
  }
  let response;
  try {
    response = await fetchImpl(runsUrl({ apiUrl, repository, sha }), {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
  } catch (error) {
    return {
      ok: false,
      reason: `GitHub API unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!response.ok) {
    return { ok: false, reason: `GitHub API answered HTTP ${response.status}` };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'GitHub API answered with something that is not JSON' };
  }
  return decide(body, { sha, repository });
}

async function main() {
  const sha = process.argv[2];
  const result = await check({
    sha,
    repository: process.env.GITHUB_REPOSITORY ?? '',
    apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
    token: process.env.GH_TOKEN ?? '',
  });
  if (!result.ok) {
    console.error(`::error::release refused: ${result.reason}`);
    process.exit(1);
  }
  console.log(`CI is green for ${sha}: run ${result.run.id} ${result.run.url}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(
      `::error::release refused: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
