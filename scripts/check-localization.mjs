#!/usr/bin/env node
/**
 * Localization gate — 00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md.
 *
 * Every catalogue must carry every key the reference language carries. A missing key is not a
 * cosmetic gap: it is an Arabic user meeting an English string, or a blank label where a
 * fallback returned nothing. Catching it here is the difference between a translation task and
 * a support ticket.
 *
 * A no-op until catalogues exist, so it is in force from the commit that adds the first one.
 * Dependency-free, like the other gates.
 *
 * Layout: <package>/locales/<language>.json
 *
 * Usage: node scripts/check-localization.mjs
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REFERENCE = 'en';
const REQUIRED = ['en', 'ar'];

const catalogues = execFileSync('git', ['ls-files', '*/locales/*.json'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

if (catalogues.length === 0) {
  console.log('Localization: no catalogues yet — nothing to check.');
  process.exit(0);
}

/** Groups catalogue files by the package that owns them. */
const byPackage = new Map();
for (const file of catalogues) {
  const owner = file.slice(0, file.lastIndexOf('/locales/'));
  const language = file.slice(file.lastIndexOf('/') + 1).replace('.json', '');
  byPackage.set(owner, [...(byPackage.get(owner) ?? []), { file, language }]);
}

const keysOf = (file) => {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const flatten = (value, prefix) =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, nested]) =>
          flatten(nested, prefix === '' ? key : `${prefix}.${key}`),
        )
      : [prefix];
  return new Set(flatten(parsed, ''));
};

const violations = [];

for (const [owner, files] of byPackage) {
  const languages = new Map(files.map(({ file, language }) => [language, file]));
  const referenceFile = languages.get(REFERENCE);

  if (referenceFile === undefined) {
    violations.push(`${owner}: no ${REFERENCE} catalogue to check the others against.`);
    continue;
  }
  const reference = keysOf(referenceFile);

  for (const language of REQUIRED) {
    const file = languages.get(language);

    if (file === undefined) {
      violations.push(`${owner}: missing the ${language} catalogue entirely.`);
      continue;
    }
    const missing = [...reference].filter((key) => !keysOf(file).has(key));

    if (missing.length > 0) {
      violations.push(
        `${file}: ${String(missing.length)} key(s) missing — ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(`Localization: ${String(violations.length)} problem(s).\n`);
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('\nEvery language ships complete. See 00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md.');
  process.exit(1);
}

console.log(`Localization: ${String(byPackage.size)} catalogue set(s) complete.`);
