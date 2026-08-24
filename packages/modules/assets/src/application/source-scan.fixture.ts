import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The module's own source and SQL, prepared for the negative-space scans.
 *
 * Extracted when the Checkpoint 3 assertions pushed `assets-boundaries.test.ts` past its budget and
 * a second boundary suite appeared beside it. Two copies of this scanner would eventually disagree
 * about what counts as source, and the copy that was wrong would be the one that stopped noticing a
 * capability nobody approved.
 *
 * **Named `.fixture.` deliberately.** The scanner excludes fixtures, harnesses and suites from what it
 * reads, so this file is outside its own corpus — a scanner that scanned itself would fail on the very
 * identifiers it exists to search for.
 */

export const SOURCE_ROOT = join(process.cwd(), 'src');

export const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
    // Test doubles, suites and the database fixture describe absences in order to assert them, and
    // the fixture legitimately constructs the event dispatcher `PostgresUnitOfWork` requires.
    // Scanning them would make the suites fail on their own supporting cast rather than on the module.
    if (
      entry.name.includes('.test.') ||
      entry.name.includes('test-harness') ||
      entry.name.includes('.fixture.')
    ) {
      return [];
    }
    return [path];
  });

export const codeOf = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * Every source file this module owns, with its comments stripped.
 *
 * The suites explain at length what they deliberately do not do — "there is no `JobPort`", "no
 * Payroll adapter" — and a scan that could not tell prose from code would force those explanations
 * out of exactly the files that most need them.
 */
export const ALL_CODE = sourceFiles(SOURCE_ROOT).map(codeOf).join('\n');

/**
 * The same code with its string literals removed as well.
 *
 * Used by the scans that ask whether a *concept* is implemented. A Swagger description saying "no
 * valuation basis: neither is built" is prose that happens to live in a string, and a scan that could
 * not tell it from an identifier would force the API to stop documenting its own boundaries — which
 * is the same mistake as scanning comments, one layer down. The scans that read command and query
 * *names* deliberately use `ALL_CODE`, because there the string literal is the thing under test.
 */
export const IDENTIFIERS = ALL_CODE.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");

const MIGRATIONS_ROOT = join(process.cwd(), '..', '..', '..', 'prisma', 'migrations');

/**
 * Every migration this module owns, as SQL.
 *
 * Scanned as well as the TypeScript because a column is added in SQL first. A `days_outstanding` that
 * existed in the table and in no type would be invisible to every scan above.
 */
export const ASSETS_MIGRATION_SQL = readdirSync(MIGRATIONS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.includes('assets'))
  .map((entry) => readFileSync(join(MIGRATIONS_ROOT, entry.name, 'migration.sql'), 'utf8'))
  .join('\n');
