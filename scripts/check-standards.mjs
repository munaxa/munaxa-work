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
/** snake_case, the Dart convention its own analyzer enforces (ADR-0029). */
const SNAKE_FILE = /^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+)*$/;
const SNAKE_FOLDER = /^[a-z0-9]+(_[a-z0-9]+)*$/;
/** Ecosystems whose own tools mandate snake_case names (ADR-0029). */
const SNAKE_CASE_ECOSYSTEMS = [
  /^apps\/mobile\//, // Dart: the analyzer's file_names rule, pubspec.yaml, analysis_options.yaml
  /^prisma\/migrations\//, // Prisma: <timestamp>_<name>/migration.sql, migration_lock.toml
];
const isSnakeCaseEcosystem = (file) => SNAKE_CASE_ECOSYSTEMS.some((pattern) => pattern.test(file));

/**
 * The Android host project (ADR-0031). Every name in it is chosen by the Android toolchain,
 * not by us: resource folders are qualifiers the platform parses (`mipmap-hdpi`,
 * `values-night`), a Kotlin file must carry the name of the class it declares, and the Gradle
 * files answer to Gradle. It is checked against those rules rather than left unchecked.
 */
const ANDROID_HOST = /^apps\/mobile\/android\//;
const ANDROID_FOLDER = /^[a-z0-9]+([_-][a-z0-9]+)*$/;
const ANDROID_FILE = /^[a-z0-9]+([_-][a-z0-9]+)*(\.[a-z0-9]+)*$/;
/** A Kotlin or Java file is named after its class, which is `PascalCase` by language rule. */
const ANDROID_CLASS_FILE = /^[A-Z][A-Za-z0-9]*\.(kt|java)$/;
/** Names the Android build looks up literally. */
const ANDROID_FIXED_NAMES = new Set(['AndroidManifest.xml']);

/**
 * A Next.js App Router directory, whose dynamic segments the router names (ADR-0075).
 *
 * `[employmentId]`, `[...slug]`, `[[...slug]]`, `(group)` and `@slot` are routing syntax rather
 * than folders somebody named badly, and the identifier inside is still checked: it is `camelCase`,
 * exactly as an identifier in this workspace is. A folder that is neither routing syntax nor
 * kebab-case is still a violation, so the directory every future screen lives in stays checked.
 */
const APP_ROUTER = /^apps\/[a-z0-9-]+\/src\/app\//;
const ROUTE_PARAMETER = '[a-z][a-zA-Z0-9]*';
const ROUTE_SEGMENT = new RegExp(
  `^(\\[${ROUTE_PARAMETER}\\]` + // [employmentId]
    `|\\[\\.\\.\\.${ROUTE_PARAMETER}\\]` + // [...slug]
    `|\\[\\[\\.\\.\\.${ROUTE_PARAMETER}\\]\\]` + // [[...slug]]
    `|\\([a-z0-9]+(-[a-z0-9]+)*\\)` + // (group)
    `|@${ROUTE_PARAMETER})$`, // @slot
);

/** Dotfiles are named by the tool that reads them, in every ecosystem. */
const DOTFILE = /^\./;
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

const checkAndroidNaming = (file) => {
  const segments = file.split('/');
  const name = segments.pop();
  for (const folder of segments) {
    if (!ANDROID_FOLDER.test(folder)) fail(file, `Folder "${folder}" is not an Android name.`);
  }
  if (DOTFILE.test(name) || ANDROID_FIXED_NAMES.has(name) || ANDROID_CLASS_FILE.test(name)) return;
  if (!ANDROID_FILE.test(name)) fail(file, `File "${name}" is not an Android name.`);
};

const checkNaming = (file) => {
  if (ANDROID_HOST.test(file)) return checkAndroidNaming(file);

  const snake = isSnakeCaseEcosystem(file);
  const [filePattern, folderPattern, convention] = snake
    ? [SNAKE_FILE, SNAKE_FOLDER, 'snake_case']
    : [KEBAB_FILE, KEBAB_FOLDER, 'kebab-case'];

  const routed = APP_ROUTER.test(file);
  const segments = file.split('/');
  const name = segments.pop();
  for (const folder of segments) {
    if (routed && ROUTE_SEGMENT.test(folder)) continue;
    // These ecosystems sit under kebab-case folders that predate their own convention.
    const pattern = snake && !folder.includes('_') ? KEBAB_FOLDER : folderPattern;
    if (!pattern.test(folder)) fail(file, `Folder "${folder}" is not ${convention}.`);
  }
  if (DOTFILE.test(name) || NAME_EXEMPT.test(name)) return;
  if (!filePattern.test(name)) fail(file, `File "${name}" is not ${convention}.`);
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
