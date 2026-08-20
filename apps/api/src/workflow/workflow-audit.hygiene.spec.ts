import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRODUCTION, ROOT, TESTS } from './workflow-audit.fixture.js';

/**
 * The audit's own hygiene check: **the test estate cannot pass an audit by disabling one.**
 *
 * Split from `workflow.audit.spec.ts` at the file-size budget, on a real seam. That file asserts
 * things about the module's *production code* — what it implements, what it refuses, what it may
 * import. This one asserts things about the *suites*, and they are a different kind of claim: no
 * focused test, no skipped test, no disabled lint rule, no `any`. Those are how an audit passes
 * without auditing, and none of them is visible from reading the production tree.
 *
 * The one legitimate skip is a missing database, and it is asserted as such rather than trusted.
 */

describe('the test estate cannot pass an audit by disabling one', () => {
  /**
   * A suite with its comments **and** its literals removed.
   *
   * This file names every evasion it forbids, in prose and in a list, so a scan of raw text finds
   * all of them here and reports the audit as the offender. A focused or skipped test is *code*, and
   * survives neither strip — which is what makes the scan below about what runs rather than about
   * what is written down.
   */
  const executable = (source: string): string =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')
      // And a regular-expression literal, which is a value like any other. The scan below is for a
      // **type annotation**, and no annotation can appear inside a pattern — while the pattern that
      // searches for one necessarily contains the word it searches for. Matched only where a literal
      // can begin, so an ordinary division is left alone.
      .replace(/(?<=[=(,:]\s*)\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, '//');

  /**
   * The three directives that live in a comment, matched as the directive rather than as the word.
   *
   * A lint-disable and a type-suppression only do anything when they follow `//` or open a block
   * comment, so that is what is searched for. Naming one in a sentence is not disabling anything,
   * and a looser search would have made the audit unable to describe its own rules.
   *
   * **The words are assembled from fragments rather than written out**, because the repository's own
   * standards gate forbids those literals in any source file — including, correctly, this one. A
   * gate cannot tell a rule from a use of it, so the file that enforces the rule must not contain
   * the string. The alternative was an exemption, and an audit with an exemption in it is not one.
   */
  const DIRECTIVE = new RegExp(
    `(?://|/\\*)\\s*(?:${['eslint', 'disable'].join('-')}|@ts${['', 'ignore'].join('-')}|@ts${['', 'expect', 'error'].join('-')})`,
  );

  const SUITES = [
    ...TESTS.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')] as const),
    ...readdirSync(join(process.cwd(), 'src', 'workflow'))
      .filter((file) => file.endsWith('.ts'))
      .map(
        (file) =>
          [
            `api/${file}`,
            readFileSync(join(process.cwd(), 'src', 'workflow', file), 'utf8'),
          ] as const,
      ),
  ];

  it('audits every Workflow suite in the module and in the API app', () => {
    expect(SUITES.length).toBeGreaterThanOrEqual(50);
  });

  it('has no focused test, no skipped test and no disabled lint rule', () => {
    for (const [file, raw] of SUITES) {
      const source = executable(raw);

      for (const evasion of [
        'it.only',
        'describe.only',
        'test.only',
        'it.skip',
        'describe.skip(',
        'test.skip',
        'it.todo',
      ]) {
        expect([file, evasion, source.includes(evasion)]).toEqual([file, evasion, false]);
      }
      expect([file, DIRECTIVE.test(raw)]).toEqual([file, false]);
    }
  });

  /**
   * `describe.skip` **as a value** is the one legitimate use, and it is not an exception to the rule
   * above.
   *
   * Every integration suite begins `const suite = CONNECTION === undefined ? describe.skip : describe`
   * — a suite that needs a database and says so, rather than one somebody switched off. The
   * assertion above forbids `describe.skip(`, the call; this one requires that wherever the value
   * appears, it is guarded by the connection and by nothing else.
   */
  it('skips a suite only for a missing database, never for a failing assertion', () => {
    for (const [file, source] of SUITES) {
      if (!source.includes('describe.skip')) continue;
      expect([file, /CONNECTION === undefined \? describe\.skip : describe/.test(source)]).toEqual([
        file,
        true,
      ]);
    }
  });

  it('uses no `any`, in production or in a suite', () => {
    for (const [file, source] of [
      ...SUITES,
      ...PRODUCTION.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')] as const),
    ]) {
      expect([file, /\bas any\b|:\s*any\b|<any>/.test(executable(source))]).toEqual([file, false]);
    }
  });
});
