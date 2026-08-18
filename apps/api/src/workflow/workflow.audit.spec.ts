import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';

import { LAYERS, PRODUCTION, ROOT, codeOf, textOf } from './workflow-audit.fixture.js';

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
 * The test estate has its own suite beside this one — `workflow-audit.hygiene.spec.ts` — because no
 * `.only`, no skipped test and no disabled lint rule are claims about the *suites* rather than about
 * the module, and they are how an audit passes without auditing.
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
        // `escalate` and `escalation` left this list in Phase 16D, by authorization rather than by
        // attrition (D-16D-02, D-16D-05), exactly as three names left it in 16C. What remains
        // forbidden is the half nobody approved: escalation that fires **on its own**. A human
        // adding one approver to a stuck branch is built and is asserted present below; a delay
        // after which the product acts by itself is not, and there is nothing in this repository
        // that could run it.
        'escalateAfter',
        'autoEscalat',
        'escalationTimer',
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
  it('implements the capabilities 16C and 16D authorized, in named files', () => {
    for (const [file, built] of [
      ['domain/manager.ts', 'resolveManager'],
      ['domain/manager.ts', 'resolutionDateOf'],
      ['domain/service-level.ts', 'dueAt'],
      ['domain/service-level.ts', 'serviceLevelState'],
      ['application/workflow-reporting-line.ts', 'managerOf'],
      ['application/instance-snapshot.ts', 'snapshotManager'],
      // Phase 16D. The act, the duplicate identity it is judged on, and the marker that keeps the
      // snapshotted denominator countable after somebody has been added to it.
      ['domain/escalation.ts', 'escalateBranch'],
      ['domain/escalation.ts', 'escalationIdentity'],
      ['domain/branch.ts', 'escalatedAt'],
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
    // Phase 16D's, approved by name in the second half of D-16D-02. Implied by nothing, which the
    // application suite asserts one permission at a time.
    'workflow.approval.escalate',
    'workflow.group.read',
    'workflow.group.manage',
  ];

  it('is exactly the ten the phase declares', () => {
    expect([...ALL_WORKFLOW_PERMISSIONS].sort()).toStrictEqual([...EXPECTED].sort());
  });

  /**
   * Ten literals, and no way to hold one without being granted it.
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
    expect(new Set(ALL_WORKFLOW_PERMISSIONS).size).toBe(10);
  });

  it('declares no permission for a capability the phase does not have', () => {
    for (const absent of [
      'role',
      'manager',
      'team',
      'sla',
      // `escalation` left this list when D-16D-02 approved `workflow.approval.escalate` by name.
      // What must never become a permission is the automatic half — nothing grants a right to have
      // the product act on its own.
      'auto-escalate',
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
