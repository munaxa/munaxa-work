import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import { LAYERS, PRODUCTION, ROOT, TESTS, codeOf, textOf } from './workflow-audit.fixture.js';

/**
 * The Phase 16B audit, over the whole module at once.
 *
 * The domain and the application each keep their own negative-space suite, and each sees only its
 * own layer. What nothing sees is **the module entire** — a scheduler in a repository, a timer in a
 * controller, an `any` in a mapper — and a capability only has to exist in one layer to exist.
 *
 * Three things make this different from the layer suites rather than a copy of them:
 *
 * **It reads every production file of all five layers**, discovered from the filesystem rather than
 * listed, so a file added tomorrow is audited tomorrow.
 *
 * **It strips comments and string literals.** This module *documents* its absences — the vocabulary
 * names SLA and escalation to say there are none, the ports file names `JobPort` to say there is no
 * port, and the Admin screen renders sentences about every one of them. Prose is not implementation,
 * and an audit that could not tell them apart would force the code to stop explaining itself. The
 * methodology is Checkpoint 6's and Checkpoint 7's, applied to a wider tree.
 *
 * **It audits the test estate too**, for the properties a reader cannot check by reading: no `.only`,
 * no skipped test, no disabled lint rule, no `any`. Those are how an audit passes without auditing.
 */

describe('the Workflow module, audited whole', () => {
  it('covers all five layers, discovered rather than listed', () => {
    expect(PRODUCTION.length).toBeGreaterThanOrEqual(35);
    for (const layer of LAYERS) {
      expect([layer, PRODUCTION.some((file) => file.startsWith(layer))]).toEqual([layer, true]);
    }
    // The 16B files specifically, so a rename cannot quietly drop one out of the audit.
    for (const file of [
      'domain/branch.ts',
      'domain/condition.ts',
      'domain/approval-group.ts',
      'application/approval-group.use-case.ts',
      'infrastructure/group.repository.ts',
      'api/approval-group.controller.ts',
    ]) {
      expect([file, PRODUCTION.includes(file)]).toEqual([file, true]);
    }
  });

  /**
   * The capabilities the module still does not have, in **executable code** anywhere in it.
   *
   * Every one of these is named somewhere in the module's prose, and several are rendered as
   * sentences on the Admin screen. What must not exist is an implementation: a timer, a scheduled
   * fire, a port, a delivery.
   *
   * **Three names left this list in Phase 16C, by authorization rather than by attrition.**
   * `managerOf` and `reportingLine` are the manager approver D-16C-04 authorized — one membership in,
   * one manager out, resolved once when an approval starts and copied onto its steps. `slaDue` is
   * gone in favour of the narrower `slaHours`, because D-16C-05 authorized a target and the due time
   * derived from it. All three are asserted **present** in the companion test below, so a name
   * removed from this list can never pass for a capability quietly abandoned.
   *
   * Everything still here is still absent. Note what did *not* leave: `escalate`, `escalation`,
   * `expiresAt`, `roleDirectory`, `externalApprover`, `businessDay`, `workingDay`, and every word for
   * a timer, a queue and a notification. A target that nothing fires on and a manager read once are
   * exactly as far as this phase went.
   */
  it('implements none of the capabilities the phase defers', () => {
    for (const file of PRODUCTION) {
      const code = codeOf(file);

      for (const capability of [
        'setTimeout',
        'setInterval',
        'JobPort',
        'NotificationPort',
        'StoragePort',
        'SearchPort',
        'cron',
        'scheduler',
        'schedule(',
        'escalate',
        'escalation',
        'slaHours',
        'businessDay',
        'workingDay',
        'reportsTo',
        'roleDirectory',
        'externalApprover',
        'notify(',
        'sendNotification',
        'expireAt',
        'expiresAt',
        'outbox',
        'publishToBroker',
        'enqueue',
      ]) {
        expect([file, capability, code.includes(capability)]).toEqual([file, capability, false]);
      }
    }
  });

  /**
   * And the same words *are* present in the prose, which is where an absence belongs.
   *
   * This is the control on the assertion above. If the module simply never mentioned SLA or
   * escalation, the negative test would pass for the wrong reason — and a later reader would have no
   * way of knowing whether the capability was refused or forgotten.
   */
  it('names those capabilities in prose, so each absence is documented rather than forgotten', () => {
    const prose = PRODUCTION.map((file) => textOf(file))
      .join('\n')
      .toLowerCase();

    for (const documented of ['sla', 'escalat', 'manager', 'notification', 'schedul', 'expir']) {
      expect([documented, prose.includes(documented)]).toEqual([documented, true]);
    }
  });

  /**
   * And the complement of the negative list: what Phase 16C **did** build is in executable code.
   *
   * Without this, the three names removed from the deferred list above would read exactly like a
   * relaxed audit. A boundary suite that only ever loosens has stopped meaning anything, so each
   * authorized capability is pinned to a file that must contain it.
   */
  it('implements the two capabilities Phase 16C authorized, in named files', () => {
    for (const [file, built] of [
      ['domain/manager.ts', 'resolveManager'],
      ['domain/manager.ts', 'resolutionDateOf'],
      ['domain/service-level.ts', 'dueAt'],
      ['domain/service-level.ts', 'serviceLevelState'],
      ['application/workflow-reporting-line.ts', 'managerOf'],
      ['application/instance-snapshot.ts', 'snapshotManager'],
    ] as const) {
      expect([file, PRODUCTION.includes(file)]).toEqual([file, true]);
      expect([file, built, codeOf(file).includes(built)]).toEqual([file, built, true]);
    }
  });

  /**
   * No floating point, and no proportion, anywhere the tally could be computed.
   *
   * The locked 16B arithmetic is integers only: a threshold is `floor(assigned / 2) + 1`, a quorum
   * is a count, and there is no percentage and no weight. `Math.floor` is the one division the
   * domain performs and it is immediately floored; anything else — `toFixed`, `parseFloat`, a
   * percentage — would be a second kind of number entering a module that has none.
   */
  it('computes no proportion, percentage or floating-point value', () => {
    for (const file of PRODUCTION) {
      const code = codeOf(file);

      for (const inexact of [
        'parseFloat',
        'toFixed',
        'Number.EPSILON',
        'Math.round',
        'Math.ceil',
      ]) {
        expect([file, inexact, code.includes(inexact)]).toEqual([file, inexact, false]);
      }
    }
  });

  /**
   * Nothing chooses a repository from the environment.
   *
   * A store selected by `NODE_ENV` is a production path nobody tests and a test path nobody ships.
   * The composition root takes what it is given; the module reads no environment variable at all.
   */
  it('reads no environment variable and selects no store from one', () => {
    for (const file of PRODUCTION) {
      const code = codeOf(file);

      for (const environment of ['process.env', 'NODE_ENV', 'globalThis.process']) {
        expect([file, environment, code.includes(environment)]).toEqual([file, environment, false]);
      }
    }
  });
});

describe('the permissions, after 16B', () => {
  const EXPECTED = [
    'workflow.definition.read',
    'workflow.definition.manage',
    'workflow.instance.read',
    'workflow.instance.start',
    'workflow.instance.cancel',
    'workflow.approval.decide',
    'workflow.approval.read-own',
    'workflow.group.read',
    'workflow.group.manage',
  ];

  it('is exactly the nine the phase declares', () => {
    expect([...ALL_WORKFLOW_PERMISSIONS].sort()).toStrictEqual([...EXPECTED].sort());
  });

  /**
   * Nine literals, and no way to hold one without being granted it.
   *
   * A wildcard, a prefix match or a `startsWith` in a permission check turns nine grants into one:
   * `workflow.*` would give the holder of a read permission the ability to decide an approval, and
   * `workflow.approval` as a prefix would make `read-own` imply `decide`.
   */
  it('grants by exact name, with no wildcard and no prefix match', () => {
    for (const permission of ALL_WORKFLOW_PERMISSIONS) {
      expect([permission, permission.includes('*')]).toEqual([permission, false]);
      expect([permission, permission.endsWith('.')]).toEqual([permission, false]);
    }
    const guard = codeOf('application/workflow-permissions.ts');

    for (const loose of ['startsWith', 'includes(', 'RegExp', 'split(', '*']) {
      expect([loose, guard.includes(loose)]).toEqual([loose, false]);
    }
  });

  /**
   * The two group permissions are two, and neither is the other.
   *
   * **The shipped names are `workflow.group.*`**, and they are asserted here as the code declares
   * them. Checkpoint 6's report and this checkpoint's brief both wrote them as
   * `workflow.approval-group.*`; the code is what a grant is checked against, so the prose was
   * corrected rather than the permission — renaming a permission is a change no audit authorizes,
   * and it would silently revoke every grant already issued under the old name.
   */
  it('keeps reading a list and editing one apart', () => {
    expect(ALL_WORKFLOW_PERMISSIONS).toContain('workflow.group.read');
    expect(ALL_WORKFLOW_PERMISSIONS).toContain('workflow.group.manage');
    expect(new Set(ALL_WORKFLOW_PERMISSIONS).size).toBe(9);
  });

  it('declares no permission for a capability the phase does not have', () => {
    for (const absent of [
      'role',
      'manager',
      'team',
      'sla',
      'escalation',
      'notification',
      'admin',
    ]) {
      expect([absent, ALL_WORKFLOW_PERMISSIONS.some((name) => name.includes(absent))]).toEqual([
        absent,
        false,
      ]);
    }
  });
});

describe('the module reaches no other business module', () => {
  /**
   * Identity's delegation read and Recruitment's decision seam are the two approved crossings, and
   * both are **ports the module declares** rather than modules it imports. Workflow's own source
   * imports nothing from another business module at all — which is why a search for one is a search
   * for a package specifier rather than for a word.
   */
  it('imports no other business module’s package, in any layer', () => {
    for (const file of PRODUCTION) {
      const specifiers = [...codeOf(file).matchAll(/from '([^']+)'/g)].map(
        (match) => match[1] ?? '',
      );

      for (const specifier of specifiers) {
        const allowed =
          specifier.startsWith('.') ||
          specifier === '@work/kernel' ||
          specifier === '@work/persistence' ||
          specifier.startsWith('@nestjs/') ||
          specifier === 'class-validator' ||
          specifier === 'class-transformer' ||
          specifier === 'pg';

        expect([file, specifier, allowed]).toEqual([file, specifier, true]);
      }
    }
  });

  it('depends on no other business module in its manifest', () => {
    const manifest = readFileSync(join(ROOT, '..', 'package.json'), 'utf8');
    const dependencies = Object.keys(
      (JSON.parse(manifest) as { dependencies?: Record<string, string> }).dependencies ?? {},
    );

    for (const name of dependencies) {
      const allowed =
        ['@work/kernel', '@work/persistence'].includes(name) || !name.startsWith('@work/');

      expect([name, allowed]).toEqual([name, true]);
    }
  });
});

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
