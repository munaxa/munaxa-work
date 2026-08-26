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

/**
 * Every key whose own name contains a dot.
 *
 * This gate flattens a catalogue by *joining* nested names with a dot, so a key literally named
 * `"boundary.employment"` inside `label` flattens to `label.boundary.employment` and looks present.
 * Every runtime translator in this repository does the opposite — it *splits* the requested key on
 * a dot and walks segment by segment — so it looks for a nested `boundary` object, finds none, and
 * renders the raw key to the customer. The gate stayed green while five keys reached customers in
 * both languages on the attendance screen.
 *
 * A dot inside a key name is therefore not a style question: it is the one shape where this gate
 * and the resolver disagree about what a catalogue says. Rejecting it is what makes the flattening
 * above and the splitting at runtime mean the same thing.
 */
const dottedKeysOf = (file) => {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const walk = (value, prefix) =>
    typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, nested]) => [
          ...(key.includes('.') ? [prefix === '' ? key : `${prefix}.${key}`] : []),
          ...walk(nested, prefix === '' ? key : `${prefix}.${key}`),
        ])
      : [];
  return walk(parsed, '');
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

  for (const { file } of files) {
    const dotted = dottedKeysOf(file);

    if (dotted.length > 0) {
      violations.push(
        `${file}: ${String(dotted.length)} key name(s) contain a dot — ${dotted.slice(0, 5).join(', ')}${dotted.length > 5 ? ', …' : ''}. Nest them instead: a runtime translator splits on the dot and cannot resolve a key that contains one.`,
      );
    }
  }

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
  console.error(
    '\nEvery language ships complete. See 00B_LOCALIZATION_AND_STATUTORY_FRAMEWORK.md.',
  );
  process.exit(1);
}

console.log(`Localization: ${String(byPackage.size)} catalogue set(s) complete.`);
