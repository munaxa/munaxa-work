#!/usr/bin/env node
/**
 * Drift ratchet — MW-008, prisma/README.md.
 *
 * `prisma/schema.prisma` and the SQL migrations describe the same database, and they disagree:
 * the SQL carries exclusion constraints, partial indexes, named foreign keys and defaults the
 * Prisma schema language cannot express or does not mirror. CI applies every migration to an
 * empty database and asks Prisma what it would change to match the schema file:
 *
 *   prisma migrate diff --from-url <migrated database> --to-schema-datamodel prisma/schema.prisma --script
 *
 * This script counts that script by kind of change and compares the counts with the committed
 * baseline in prisma/drift-baseline.json. Any count above its baseline fails: a change made the
 * two models disagree more. A count below it passes with a notice to lower the baseline in the
 * same pull request, so the drift can only shrink.
 *
 * Usage:
 *   node scripts/check-migration-drift.mjs <drift.sql>                    compare with the baseline
 *   node scripts/check-migration-drift.mjs <drift.sql> --write-baseline   record the counts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BASELINE_PATH = 'prisma/drift-baseline.json';

/** Every kind counted, in the order the baseline lists them. */
export const KINDS = [
  'statements',
  'tablesAffected',
  'createTable',
  'dropTable',
  'addColumn',
  'dropColumn',
  'columnType',
  'columnNullability',
  'columnDefault',
  'addForeignKey',
  'addPrimaryKey',
  'addConstraint',
  'dropConstraint',
  'createIndex',
  'dropIndex',
  'renameIndex',
  'enumChange',
  'other',
];

const zero = () => Object.fromEntries(KINDS.map((kind) => [kind, 0]));

function classifyAlterTableClause(clause) {
  if (/^DROP CONSTRAINT\b/i.test(clause)) return 'dropConstraint';
  if (/^ADD CONSTRAINT\b.*\bFOREIGN KEY\b/is.test(clause)) return 'addForeignKey';
  if (/^ADD CONSTRAINT\b.*\bPRIMARY KEY\b/is.test(clause)) return 'addPrimaryKey';
  if (/^ADD CONSTRAINT\b/i.test(clause)) return 'addConstraint';
  if (/^ADD (COLUMN\b|")/i.test(clause)) return 'addColumn';
  if (/^DROP (COLUMN\b|")/i.test(clause)) return 'dropColumn';
  if (/^ALTER COLUMN\s+"[^"]+"\s+(SET|DROP) DEFAULT\b/i.test(clause)) return 'columnDefault';
  if (/^ALTER COLUMN\s+"[^"]+"\s+(SET|DROP) NOT NULL\b/i.test(clause)) return 'columnNullability';
  if (/^ALTER COLUMN\s+"[^"]+"\s+(SET DATA )?TYPE\b/i.test(clause)) return 'columnType';
  return 'other';
}

/** Counts a `prisma migrate diff --script` output by kind of change. */
export function countDrift(script) {
  const counts = zero();
  const tables = new Set();
  const body = script
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  const statements = body
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
  for (const statement of statements) {
    counts.statements += 1;
    const table = statement.match(/^(?:CREATE|DROP|ALTER) TABLE\s+(?:IF EXISTS\s+)?"([^"]+)"/i);
    const indexed = statement.match(/^CREATE (?:UNIQUE )?INDEX\s+"[^"]+"\s+ON\s+"([^"]+)"/i);
    if (table) tables.add(table[1]);
    if (indexed) tables.add(indexed[1]);
    if (/^CREATE TABLE\b/i.test(statement)) counts.createTable += 1;
    else if (/^DROP TABLE\b/i.test(statement)) counts.dropTable += 1;
    else if (/^CREATE (UNIQUE )?INDEX\b/i.test(statement)) counts.createIndex += 1;
    else if (/^DROP INDEX\b/i.test(statement)) counts.dropIndex += 1;
    else if (/^ALTER INDEX\b.*\bRENAME TO\b/is.test(statement)) counts.renameIndex += 1;
    else if (/^(CREATE|ALTER|DROP) TYPE\b/i.test(statement)) counts.enumChange += 1;
    else if (table && /^ALTER TABLE\b/i.test(statement)) {
      const clauses = statement
        .slice(table[0].length)
        .split(/,\s*\n/)
        .map((clause) => clause.trim())
        .filter((clause) => clause !== '');
      for (const clause of clauses) counts[classifyAlterTableClause(clause)] += 1;
    } else counts.other += 1;
  }
  counts.tablesAffected = tables.size;
  return counts;
}

/**
 * @returns {{grown: string[], shrunk: string[]}} one line per kind that moved
 */
export function compareWithBaseline(counts, baseline) {
  const grown = [];
  const shrunk = [];
  for (const kind of KINDS) {
    const now = counts[kind] ?? 0;
    const before = baseline[kind] ?? 0;
    if (now > before) grown.push(`${kind}: ${before} -> ${now}`);
    if (now < before) shrunk.push(`${kind}: ${before} -> ${now}`);
  }
  return { grown, shrunk };
}

function main() {
  const [scriptPath, flag] = process.argv.slice(2);
  if (!scriptPath) {
    process.stderr.write(
      'Usage: node scripts/check-migration-drift.mjs <drift.sql> [--write-baseline]\n',
    );
    process.exit(2);
  }
  const counts = countDrift(readFileSync(scriptPath, 'utf8'));
  process.stdout.write(`Drift between the SQL migrations and prisma/schema.prisma:\n`);
  for (const kind of KINDS) process.stdout.write(`  ${kind.padEnd(18)} ${counts[kind]}\n`);

  if (flag === '--write-baseline') {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
    process.stdout.write(`Wrote ${BASELINE_PATH}.\n`);
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const { grown, shrunk } = compareWithBaseline(counts, baseline);
  if (shrunk.length > 0) {
    process.stdout.write(
      `::notice::The drift shrank (${shrunk.join(', ')}). Lower ${BASELINE_PATH} in this pull ` +
        'request so it cannot grow back: run this script with --write-baseline.\n',
    );
  }
  if (grown.length > 0) {
    process.stderr.write(
      `::error::The drift grew (${grown.join(', ')}). Make prisma/schema.prisma mirror the SQL ` +
        'migration you added, or the migration mirror the schema; see prisma/README.md.\n',
    );
    process.exit(1);
  }
  process.stdout.write('The drift did not grow.\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
