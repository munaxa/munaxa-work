import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALL_CAREER_PERMISSIONS, CareerPermissions } from '@work/career';

/**
 * The audit that reads the code rather than running it.
 *
 * An adapter that reached for Prisma, or wrote SQL against `employment_*`, or quietly widened a
 * grant, would return the right answers and pass every behavioural suite in this directory. Nothing
 * observable would change. Reading the source is the only way to catch it — so these assertions are
 * about what is *written* in `career-sources.ts` and `career.composition.ts`.
 *
 * They need no database, which is why they run everywhere rather than only where one is configured:
 * a boundary that is only checked on a developer's machine with PostgreSQL installed is a boundary
 * nobody checks.
 */

describe('cross-module table access', () => {
  // `process.cwd()` is `apps/api` under vitest, and this package compiles as CommonJS — where
  // `import.meta` is not available. The path is the directory this file is in.
  const ADAPTERS = join(process.cwd(), 'src', 'career');

  /**
   * The production files in this directory — everything that is not test scaffolding.
   *
   * The exclusion is by shape rather than by name, so a *new* production file is audited the day it
   * is written, and the next assertion pins the resulting set so the rule cannot quietly start
   * swallowing one. That is what happened when the API layer arrived: `career.module.ts` appeared,
   * this list failed, and the file was audited rather than assumed harmless.
   */
  const SCAFFOLDING = /(\.spec\.ts|\.fixture\.ts|-scenario\.ts|-bodies\.ts)$|^phase-fifteen-/;

  const sources = (): readonly { readonly name: string; readonly text: string }[] =>
    readdirSync(ADAPTERS)
      .filter((name) => name.endsWith('.ts') && !SCAFFOLDING.test(name))
      .map((name) => ({ name, text: readFileSync(join(ADAPTERS, name), 'utf8') }));

  it('audits every production file in the directory', () => {
    expect(
      sources()
        .map((file) => file.name)
        .sort(),
    ).toEqual(['career-sources.ts', 'career.composition.ts', 'career.module.ts']);
  });

  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  /**
   * Zero direct access to any other module's tables, asserted from the source.
   *
   * An adapter reaching for Prisma or writing SQL against `employment_*` would return the right
   * answer and pass every behavioural test in this directory. Reading the code is the only way to
   * catch it — and this is where it would be written, so this is where the assertion belongs.
   *
   * The table names are matched **in the position SQL would put them** — after `from`, `join`,
   * `into`, `update` or `delete from` — rather than as bare substrings. People's table is called
   * `person`, and a bare substring search for it fails on the word "person" in a grant's stated
   * reason: an audit that forces the code to stop explaining itself is an audit that has started
   * measuring the wrong thing.
   */
  const UPSTREAM_TABLES = [
    'employment',
    'employment_assignment',
    'employment_contract',
    'employment_status_record',
    'job_position',
    'organization_unit',
    'learning_assignment',
    'learning_enrolment',
    'learning_course',
    'person',
    'person_name',
  ];

  it('names no upstream table where SQL would put one', () => {
    for (const { name, text } of sources()) {
      const code = withoutComments(text);

      for (const table of UPSTREAM_TABLES) {
        const inSqlPosition = new RegExp(
          `\\b(?:from|join|into|update|delete\\s+from|table)\\s+"?${table}\\b`,
          'i',
        );

        expect(inSqlPosition.test(code), `${name}: ${table}`).toBe(false);
      }
    }
  });

  /**
   * And no database handle to write such a statement with.
   *
   * Stronger than any token search: an adapter that imports neither a driver, nor Prisma, nor the
   * persistence package's `Repository` has nothing to issue a query *through*. The only way out of
   * this directory is the dispatcher.
   */
  it('holds no ORM, driver or repository', () => {
    for (const { name, text } of sources()) {
      const code = withoutComments(text);

      for (const forbidden of ['PrismaClient', '@prisma/client', "from 'pg'", 'Repository']) {
        expect(code, `${name}: ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  /**
   * The filter added to Organization for this checkpoint confirms; it never enumerates.
   *
   * `organization.list-positions` gained an optional `positionId`, and the risk that comes with it
   * is that Career starts *browsing* the catalogue through the same grant. Every call it makes
   * must therefore supply the identifier the caller already holds and ask for a single row — which
   * is strictly less than the same `organization.position.read` permission already allowed. D-4,
   * enumerating a tenant's critical positions, stays out of reach: there is no `criticality`
   * argument to pass and no call here that omits the identifier.
   */
  it('asks Organization for one named position and never for a page of them', () => {
    const adapters = sources().find((file) => file.name === 'career-sources.ts');
    const code = withoutComments(adapters?.text ?? '');
    const calls = [...code.matchAll(/queryName: 'organization\.list-positions',([\s\S]*?)\}\)/g)];

    expect(calls).toHaveLength(1);
    for (const [, body] of calls) {
      expect(body).toContain('positionId');
      expect(body).toContain('size: 1');
    }

    expect(code).not.toContain('criticality');
  });

  /** Every cross-module call names its permissions explicitly. No wildcard, no prefix. */
  it('grants an explicit permission list and never a wildcard or a prefix', () => {
    const adapters = sources().find((file) => file.name === 'career-sources.ts');

    expect(adapters).toBeDefined();

    const code = withoutComments(adapters?.text ?? '');
    const permits = [...code.matchAll(/permits:\s*\[([^\]]*)\]/g)].map((match) => match[1] ?? '');

    expect(permits.length).toBeGreaterThan(0);
    for (const permit of permits) {
      expect(permit).not.toContain('*');
      // Every entry is a named constant, and every constant is a full permission string.
      expect(permit.trim().length).toBeGreaterThan(0);
    }

    // The exact set, so a broadened grant is a failing test rather than a silent change.
    expect(
      [...new Set([...code.matchAll(/^const (\w+) = '([^']+)';$/gm)].map((m) => m[2]))].sort(),
    ).toEqual([
      'employment.employment.read',
      'learning.assignment.read',
      'learning.assignment.read-all',
      'organization.hierarchy.read',
      'organization.position.read',
    ]);
  });

  /** No adapter can write. Every method returns a boolean or a read model. */
  it('exposes no write on any adapter', () => {
    const adapters = sources().find((file) => file.name === 'career-sources.ts');
    const code = withoutComments(adapters?.text ?? '');

    expect(code).not.toContain('.send(');
    for (const forbidden of ['commandName', 'create-', 'update-', 'delete-']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  /** And the composition root wires the production classes, not doubles. */
  it('composes the production adapters and the PostgreSQL stores', () => {
    const composition = sources().find((file) => file.name === 'career.composition.ts');
    const code = withoutComments(composition?.text ?? '');

    expect(code).toContain('postgresCareerStores()');
    expect(code).toContain('new CareerEmployment(dispatcher)');
    expect(code).toContain('new CareerOrganization(dispatcher)');
    expect(code).toContain('new CareerLearning(dispatcher)');
    for (const forbidden of ['inMemoryCareerStores', 'Recording', 'AutoApproving', 'Fake']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  /** The module declares every permission, including the three that route nowhere. */
  it('declares the whole permission set on the module', () => {
    expect(ALL_CAREER_PERMISSIONS).toContain(CareerPermissions.planReadOwn);
    expect(ALL_CAREER_PERMISSIONS).toContain(CareerPermissions.planReadTeam);
    expect(ALL_CAREER_PERMISSIONS).toContain(CareerPermissions.developmentReadOwn);
  });
});
