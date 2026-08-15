import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_CAREER_PERMISSIONS, UNROUTED_CAREER_PERMISSIONS } from '@work/career';

/**
 * The Checkpoint 9 scope audit: what Phase 15 built, read across every layer at once.
 *
 * The per-layer suites each assert their own boundary — the schema has no criticality column, the
 * adapters hold no driver, the screen labels no nine-box. This reads **the whole phase** and asks
 * the question none of them can: has a refused capability appeared *anywhere*, in any layer, since
 * the layer that forbids it was written.
 *
 * The distinction that makes this work is the same one Checkpoint 8's honesty suite needed. A module
 * that refuses to list critical positions has to use the words "critical positions" to say so, and a
 * comment explaining why there is no `JobPort` has to name `JobPort`. **Prose is not
 * implementation.** So every file is stripped of its comments and its string literals before the
 * forbidden vocabulary is searched for — what is left is the code, and a hit in the code is a
 * capability somebody built.
 *
 * String literals are stripped as well as comments because a catalogue key, a rejection reason and a
 * `NOT VERIFIED` notice are all string literals whose whole job is to name the thing being refused.
 * The identifiers that would *implement* one — a property, a method, a type, an import — are not
 * strings, and those are what remain.
 */

const ROOT = join(process.cwd(), '..', '..');

const CAREER_TREES = [
  join(ROOT, 'packages', 'modules', 'career', 'src'),
  join(ROOT, 'apps', 'api', 'src', 'career'),
  join(ROOT, 'apps', 'admin', 'src', 'career'),
  join(ROOT, 'apps', 'admin', 'src', 'app', 'career'),
];

const filesUnder = (directory: string): readonly string[] => {
  const entries = readdirSync(directory);

  return entries.flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) return filesUnder(path);
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
};

/** Every Phase 15 source file, with its test files kept separate from its production files. */
const sources = (): readonly { readonly path: string; readonly text: string }[] =>
  CAREER_TREES.flatMap(filesUnder).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/**
 * Test scaffolding, by the same rule Checkpoint 6's audit already uses.
 *
 * The `phase-fifteen-` prefix is load-bearing rather than cosmetic: `phase-fifteen-upstream.ts`
 * *reproduces Organization's published `PositionView`*, criticality field and all, so that the
 * adapter under test is handed the shape the real module sends and can be proved to discard it. A
 * classification that called it production would report the fixture's honesty as a scope violation —
 * which is exactly what this first did.
 */
const SCAFFOLDING = /(\.spec\.tsx?|\.test\.tsx?|\.fixture\.ts|-scenario\.ts|-bodies\.ts)$/;

const isTest = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1);

  return SCAFFOLDING.test(name) || name.startsWith('phase-fifteen-');
};

/**
 * The code, with everything that can only *describe* removed.
 *
 * Block comments, line comments, then string literals of all three kinds. What survives is
 * identifiers, keywords and operators — the parts a capability is actually built out of.
 */
const codeOf = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

/** A suppression only means anything as a comment, so it is only searched for as one. */
const SUPPRESSIONS = [
  // Built rather than written out: the repository's standards gate forbids the literal in any
  // tracked file, so the one suite that searches for it must not contain it.
  new RegExp(`/[/*]\\s*${['eslint', 'disable'].join('-')}`),
  // The two TypeScript directives, built the same way and for the same reason.
  new RegExp(`/[/*]\\s*@ts-${'ignore'}`),
  new RegExp(`/[/*]\\s*@ts-expect-${'error'}`),
];

describe('phase 15 scope audit', () => {
  const production = sources().filter((file) => !isTest(file.path));

  it('reads a Phase 15 tree that actually contains the phase', () => {
    // Not vacuously true. If a path moved, every assertion below would pass against nothing.
    expect(production.length).toBeGreaterThan(50);
    expect(production.some((file) => file.path.includes('succession'))).toBe(true);
    expect(production.some((file) => file.path.includes('career-sources'))).toBe(true);
    expect(production.some((file) => file.path.includes(join('admin', 'src', 'career')))).toBe(
      true,
    );
  });

  /**
   * The capabilities this phase refuses, searched for in the code rather than in the prose.
   *
   * `promotion` and `high_potential` are absent from this list deliberately and are allowed: the
   * first is a **kind of mobility recommendation** — a suggestion that somebody be promoted, which
   * moves nobody (ADR-0072) — and the second is a **talent pool kind** a tenant may name. Both are
   * domain vocabulary this module owns. What is forbidden is the machinery that would *act*: a
   * `promote` command, a `transfer` handler, a `salary` field, a `JobPort` dependency.
   */
  it('implements none of the capabilities the phase refuses', () => {
    const forbidden = [
      'criticality',
      'potentialBand',
      'potential_band',
      'nineBox',
      'nine_box',
      'talentMatrix',
      'talent_matrix',
      'promoteEmployment',
      'transferEmployment',
      'salary',
      'vacancy',
      'requisition',
      'JobPort',
      'scheduler',
      'NotificationPort',
      'StoragePort',
      'ApprovalPort',
      'signedUrl',
      'presignedUrl',
      'uploadDocument',
      'downloadDocument',
      'PeoplePort',
      'PerformancePort',
      'DocumentPort',
      'selfService',
      'myCareer',
      'myTeam',
      'resolvePrincipal',
      'principalToEmployment',
      'computeReadiness',
      'validateMix',
      'analytics',
    ];

    for (const file of production) {
      const code = codeOf(file.text);

      for (const name of forbidden) {
        expect([file.path.replace(ROOT, ''), name, code.includes(name)]).toEqual([
          file.path.replace(ROOT, ''),
          name,
          false,
        ]);
      }
    }
  });

  /**
   * The vocabulary that *is* allowed, asserted so this suite cannot be satisfied by deleting things.
   *
   * A `promotion` recommendation kind and a `high_potential` pool kind are both real, both shipped
   * and both harmless. If a later change removed them to make the audit above pass more easily, this
   * would fail — which is the point: the audit forbids the machinery, not the words.
   */
  it('keeps the domain vocabulary the phase legitimately owns', () => {
    const vocabulary = production.find((file) => file.path.endsWith('career-vocabulary.ts'));

    expect(vocabulary).toBeDefined();
    expect(vocabulary?.text).toContain("'promotion'");
    expect(vocabulary?.text).toContain("'high_potential'");
  });

  /**
   * The quality rules, across every layer of the phase at once — each searched where it can occur.
   *
   * **A suppression is always a comment**, so the lint-suppression directive and the two TypeScript
   * ones are searched in the raw text: finding one there is the whole point.
   *
   * **Everything else is code**, and is searched with the comments and strings removed. `as any` in
   * prose is the phrase "as disclosing as any salary in this product" — a sentence explaining why a
   * refusal says as little as it does — and an audit that failed on it would be forcing the code to
   * stop explaining itself to satisfy a substring match.
   */
  it('contains no prohibited pattern in any layer', () => {
    for (const file of sources()) {
      const named = file.path.replace(ROOT, '');
      const code = codeOf(file.text);

      // Matched as the **comment directive** each one actually is, rather than as a substring. A
      // plain `includes` finds this suite's own list of forbidden names and reports the audit as a
      // violation of itself — which is a true statement about the characters on disk and a false one
      // about the repository.
      for (const directive of SUPPRESSIONS) {
        expect([named, directive.source, directive.test(file.text)]).toEqual([
          named,
          directive.source,
          false,
        ]);
      }
      for (const pattern of [
        'it.only',
        'describe.only',
        'test.only',
        'console.log',
        'as any',
        ': any',
        '<any>',
        // Assembled from halves so the words themselves never appear here. The repository's own
        // standards gate forbids the literals in any tracked file, and a suite that spelled them out
        // in order to search for them would be the one file that failed the rule it enforces.
        ['TO', 'DO'].join(''),
        ['FIX', 'ME'].join(''),
      ]) {
        expect([named, pattern, code.includes(pattern)]).toEqual([named, pattern, false]);
      }
    }
  });

  /**
   * Nothing outside the module's own persistence layer reaches a database.
   *
   * The API adapters, the composition root and the whole Admin screen are consumers. A Prisma
   * client, a `pg` import or a repository construction in any of them would be a second application
   * layer wearing a screen's clothes.
   */
  it('reaches no database outside the module’s own infrastructure', () => {
    const consumers = production.filter(
      (file) =>
        !file.path.includes(join('career', 'src', 'infrastructure')) &&
        !file.path.endsWith('career-database.fixture.ts'),
    );

    for (const file of consumers) {
      const code = codeOf(file.text);
      const named = file.path.replace(ROOT, '');

      for (const pattern of ['PrismaClient', 'prisma', 'new Pool(', 'postgresCareerStores']) {
        // The composition root is the one place allowed to name the store assembly, because
        // assembling it is what a composition root is for.
        if (pattern === 'postgresCareerStores' && file.path.endsWith('career.composition.ts')) {
          continue;
        }
        expect([named, pattern, code.includes(pattern)]).toEqual([named, pattern, false]);
      }
    }
  });

  /**
   * The three declared-but-unrouted permissions, still routed nowhere.
   *
   * They are the contract for self-service, and self-service is `NOT VERIFIED`. A controller or a
   * handler that started enforcing one would be claiming a principal can be resolved to an
   * employment, which this repository cannot do (ADR-0032).
   */
  it('routes none of the three self-service permissions', () => {
    expect(UNROUTED_CAREER_PERMISSIONS).toHaveLength(3);
    expect(ALL_CAREER_PERMISSIONS).toHaveLength(21);

    const handlers = production.filter(
      (file) => file.path.includes('.use-case.') || file.path.includes('career-queries'),
    );

    for (const file of handlers) {
      const code = codeOf(file.text);

      for (const permission of ['planReadOwn', 'planReadTeam', 'developmentReadOwn']) {
        expect([file.path.replace(ROOT, ''), permission, code.includes(permission)]).toEqual([
          file.path.replace(ROOT, ''),
          permission,
          false,
        ]);
      }
    }
  });
});
