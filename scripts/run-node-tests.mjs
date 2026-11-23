#!/usr/bin/env node
/**
 * Runs the dependency-free node:test suites of the repository's own tooling: every
 * `*.test.mjs` under scripts/ and tooling/. The workspace's packages have their own runner
 * (vitest, through turbo); these files import only node built-ins, so they run on a bare
 * checkout, before `pnpm install`.
 *
 * A root with no test files is not an error, so a directory can start shipping tests without a
 * change here. No test file at all is an error: the gate would otherwise pass while testing
 * nothing.
 *
 * Usage: node scripts/run-node-tests.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['scripts', 'tooling'];
const SKIP = new Set(['node_modules', 'dist', 'coverage']);

function collect(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !SKIP.has(entry.name)) found.push(...collect(path));
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) found.push(path);
  }
  return found;
}

const files = ROOTS.filter((root) => existsSync(root))
  .flatMap(collect)
  .sort();
if (files.length === 0) {
  process.stderr.write(`No *.test.mjs under ${ROOTS.join(' or ')}.\n`);
  process.exit(1);
}
process.stdout.write(`node --test over ${files.length} files:\n  ${files.join('\n  ')}\n`);
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
