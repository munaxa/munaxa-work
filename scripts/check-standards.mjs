#!/usr/bin/env node
/**
 * Engineering Standards gate — docs/ENGINEERING_STANDARDS.md.
 *
 * Covers the standards ESLint cannot: file and folder naming, file budgets for files no
 * package config reaches yet, and suppression markers (which a committed `eslint-disable`
 * would otherwise hide). Deliberately dependency-free — it runs on a bare checkout, before
 * `pnpm install`, so the gate never depends on the registry being reachable.
 *
 * Usage: node scripts/check-standards.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

/** Prompts, docs and lockfiles are inputs to the standards, not subjects of them. */
const EXCLUDED_PATHS = [
  /^work prompts\//,
  /^docs\//,
  /^\.github\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
  /pnpm-lock\.yaml$/,
];

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SOURCE_ROOTS = /^(apps|packages|prisma|scripts|tooling)\//;

/** Standard → maximum lines. Longest suffix wins. */
const FILE_BUDGETS = [
  ['.controller.ts', 150],
  ['.repository.ts', 250],
  ['.service.ts', 300],
  ['.use-case.ts', 300],
];
const DEFAULT_BUDGET = 400;

/** Suppressions and unfinished work, as forbidden by the standards. */
const FORBIDDEN_MARKERS = [
  [/@ts-ignore/, 'Suppressing a type error is forbidden. Fix the type.'],
  [/@ts-nocheck/, 'Suppressing a whole file is forbidden. Fix the types.'],
  [
    /eslint-disable/,
    'Disabling a lint rule is forbidden. Fix the code, or change the rule with an ADR.',
  ],
  [
    /\bconsole\s*\.\s*log\s*\(/,
    'Use the structured logger. console.log is forbidden in production code.',
    // Local tooling has no logger and its output is the point; the ESLint layer draws the
    // same line with `no-console: off` for these paths.
    { productionOnly: true },
  ],
  [/^\s*debugger\s*;?\s*$/, 'Debugger statements never reach main.'],
  [/\bTODO\b/, 'No TODO may be left in production code.'],
  [/\bFIXME\b/, 'No FIXME may be left in production code.'],
];

/** This file names the markers it forbids; scanning it would report every one of them. */
const MARKER_EXEMPT = new Set(['scripts/check-standards.mjs']);

/** Local tooling — the gates themselves, build scripts — is not production code. */
const TOOLING = /^(scripts|tooling)\//;

/** kebab-case, optionally with dotted role and extension: `leave-request.service.ts`. */
const KEBAB_FILE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/;
const KEBAB_FOLDER = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Ecosystem files whose names are fixed by the tools that read them. */
const NAME_EXEMPT = /^(README|LICENSE|CHANGELOG|CONTRIBUTING|Dockerfile|Makefile)/;

const REQUIRED_DOCS = ['docs/ENGINEERING_STANDARDS.md', 'ARCHITECTURE.md', 'README.md'];

const violations = [];
const fail = (file, message, line) => violations.push({ file, message, line });

const trackedFiles = () =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((file) => !EXCLUDED_PATHS.some((pattern) => pattern.test(file)));

const budgetFor = (file) => {
  const match = FILE_BUDGETS.filter(([suffix]) => file.endsWith(suffix)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return match ? match[1] : DEFAULT_BUDGET;
};

const checkMarkers = (file) => {
  const lines = readFileSync(file, 'utf8').split('\n');
  if (MARKER_EXEMPT.has(file)) return lines.length;

  const isTooling = TOOLING.test(file);
  lines.forEach((text, index) => {
    for (const [marker, message, options] of FORBIDDEN_MARKERS) {
      if (isTooling && options?.productionOnly === true) continue;
      if (marker.test(text)) fail(file, message, index + 1);
    }
  });
  return lines.length;
};

const checkNaming = (file) => {
  const segments = file.split('/');
  const name = segments.pop();
  for (const folder of segments) {
    if (!KEBAB_FOLDER.test(folder)) fail(file, `Folder "${folder}" is not kebab-case.`);
  }
  if (!NAME_EXEMPT.test(name) && !KEBAB_FILE.test(name)) {
    fail(file, `File "${name}" is not kebab-case.`);
  }
};

for (const doc of REQUIRED_DOCS) {
  if (!existsSync(doc)) fail(doc, 'Required document is missing.');
}

for (const file of trackedFiles()) {
  if (SOURCE_ROOTS.test(file)) checkNaming(file);
  if (!CODE.test(file)) continue;

  const lineCount = checkMarkers(file);
  const budget = budgetFor(file);
  if (lineCount > budget) {
    fail(file, `${lineCount} lines exceeds the ${budget}-line budget. Split it before the limit.`);
  }
}

if (violations.length > 0) {
  console.error(`Engineering Standards: ${violations.length} violation(s).\n`);
  for (const { file, message, line } of violations) {
    console.error(`  ${file}${line ? `:${line}` : ''}  ${message}`);
  }
  console.error('\nSee docs/ENGINEERING_STANDARDS.md. Changing a standard requires an ADR.');
  process.exit(1);
}

console.log('Engineering Standards: no violations.');
