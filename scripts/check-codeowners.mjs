#!/usr/bin/env node
/**
 * Keeps .github/CODEOWNERS honest. GitHub silently ignores a pattern that matches nothing, so a
 * rename or a typo would drop a gate file out of code-owner review without anyone noticing.
 *
 * Checks, against the files git tracks:
 *  - every rule is anchored (starts with "/") and names at least one "@owner";
 *  - every pattern matches at least one tracked file;
 *  - every path in REQUIRED_OWNED is covered by a rule that names an owner.
 *
 * Supported pattern syntax is the subset this repository uses: a leading "/", "*" within one path
 * segment, "**" across segments, and a trailing "/" for a whole directory. Anything else is refused
 * rather than guessed.
 *
 * Usage: node scripts/check-codeowners.mjs   (exit 0 ok, 1 findings)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CODEOWNERS_PATH = '.github/CODEOWNERS';

/** Files whose changes must always reach a code owner (Wave 1 owner actions, item A-2). */
export const REQUIRED_OWNED = [
  '.github/CODEOWNERS',
  '.github/workflows/ci.yml',
  '.github/workflows/publish-images.yml',
  '.github/workflows/publish-images-ecr.yml',
  '.github/workflows/release-gate.yml',
  '.github/scripts/require-green-ci.mjs',
  '.github/scripts/scan-image.sh',
  '.github/scripts/verify-image.sh',
  '.github/scripts/check-pinned.sh',
  'scripts/check-migration-safety.mjs',
  'scripts/check-migration-drift.mjs',
  'scripts/db-reset-guard.mjs',
  'prisma/drift-baseline.json',
  'scripts/bootstrap-tenant.mjs',
  'scripts/bootstrap-tenant-guard.mjs',
  'tooling/testing-data/target-guard.mjs',
  'scripts/check-codeowners.mjs',
  'apps/api/Dockerfile',
  'apps/admin/Dockerfile',
];

const OWNER = /^@[A-Za-z0-9-]+(\/[A-Za-z0-9._-]+)?$/;

/** Parses CODEOWNERS text into rules { line, pattern, owners }, skipping blank and "#" lines. */
export function parseCodeowners(text) {
  const rules = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const [pattern, ...owners] = line.split(/\s+/);
    rules.push({ line: index + 1, pattern, owners });
  });
  return rules;
}

/** Converts a supported pattern to a RegExp over repository-relative paths, or throws. */
export function patternToRegExp(pattern) {
  if (!pattern.startsWith('/'))
    throw new Error(`pattern "${pattern}" is not anchored with a leading "/"`);
  if (/[?[\]!\\]/.test(pattern))
    throw new Error(`pattern "${pattern}" uses syntax this check does not support`);
  const directory = pattern.endsWith('/');
  const body = pattern.slice(1, directory ? -1 : undefined);
  if (body === '') throw new Error('pattern "/" would own the whole repository');
  let source = '';
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '*' && body[i + 1] === '*') {
      source += '.*';
      i += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.+^${}()|]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}${directory ? '/.+' : ''}$`);
}

/** Returns a list of human-readable findings; empty means the file is valid. */
export function checkCodeowners(text, trackedFiles, requiredOwned = REQUIRED_OWNED) {
  const findings = [];
  const compiled = [];
  for (const rule of parseCodeowners(text)) {
    let regexp;
    try {
      regexp = patternToRegExp(rule.pattern);
    } catch (error) {
      findings.push(`line ${rule.line}: ${error.message}`);
      continue;
    }
    if (rule.owners.length === 0)
      findings.push(`line ${rule.line}: "${rule.pattern}" names no owner`);
    for (const owner of rule.owners) {
      if (!OWNER.test(owner))
        findings.push(`line ${rule.line}: "${owner}" is not an @user or @org/team`);
    }
    if (!trackedFiles.some((file) => regexp.test(file))) {
      findings.push(`line ${rule.line}: "${rule.pattern}" matches no tracked file`);
    }
    compiled.push({ ...rule, regexp });
  }
  for (const file of requiredOwned) {
    if (!trackedFiles.includes(file)) {
      findings.push(
        `required file ${file} is not tracked (renamed? update REQUIRED_OWNED and CODEOWNERS)`,
      );
      continue;
    }
    // GitHub applies the last matching rule.
    const last = compiled.filter((rule) => rule.regexp.test(file)).at(-1);
    if (!last || last.owners.length === 0) findings.push(`required file ${file} has no code owner`);
  }
  return findings;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = checkCodeowners(readFileSync(CODEOWNERS_PATH, 'utf8'), trackedFiles());
  if (findings.length > 0) {
    console.error(`${CODEOWNERS_PATH}: ${findings.length} finding(s)`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }
  console.log(`${CODEOWNERS_PATH}: ok (${REQUIRED_OWNED.length} required files owned)`);
}
