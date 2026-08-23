import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as vocabulary from '../domain/relations-vocabulary.js';

/**
 * The negative space Checkpoint 2 added: what the **case lifecycle** deliberately does not contain.
 *
 * A second file rather than more of `relations-boundaries.test.ts`, which reached the 400-line
 * budget the standards set. The split is by subject — that file asserts what the module as a whole
 * does not build, this one asserts the shape of the lifecycle specifically — rather than by
 * whichever assertions happened to be last.
 *
 * The scans read the module's own source with comments stripped, for the reason its sibling gives:
 * these files explain at length what they deliberately do not do, and a scan that could not tell
 * prose from code would force those explanations out of the files that most need them.
 */

const SOURCE_ROOT = join(process.cwd(), 'src');

const sourceFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
    if (
      entry.name.includes('.test.') ||
      entry.name.includes('test-harness') ||
      entry.name.includes('.fixture.')
    ) {
      return [];
    }
    return [path];
  });

const codeOf = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const ALL_CODE = sourceFiles(SOURCE_ROOT).map(codeOf).join('\n');

const { CASE_STATES, PERMITTED_CASE_TRANSITIONS } = vocabulary;

describe('what the case lifecycle is not', () => {
  /**
   * The lifecycle stops where the built capabilities stop.
   *
   * The specification's lifecycle continues through acknowledged, appealed, upheld, annulled,
   * expired and archived. **None of those states is nameable anywhere in this module**, because
   * nothing here can produce one — and a vocabulary that listed them would be a promise the code
   * cannot keep.
   *
   * **`action_issued` left this list when Checkpoint 4 built the capability that reaches it**, and
   * `pending_approval` stayed: approval is Workflow's, and no Workflow integration is authorized.
   * The protection is replaced rather than dropped — the assertion below pins the exact reachable
   * set, so a state appearing without a capability behind it still fails.
   */
  it.each([
    'pending_approval',
    'acknowledged',
    'appealed',
    'upheld',
    'annulled',
    'expired',
    'archived',
  ])('cannot name the later lifecycle state %s', (absent) => {
    expect([absent, ALL_CODE.includes(absent)]).toStrictEqual([absent, false]);
  });

  /**
   * The reachable set, pinned exactly — the replacement for `action_issued` leaving the list above.
   *
   * Every state here has a capability that produces it: a violation is `reported`, an inquiry makes
   * it `under_investigation`, concluding makes it `findings`, and issuing an action makes it
   * `action_issued`. A fifth appearing without one would fail this.
   */
  it('names exactly the states a built capability can reach', () => {
    expect(CASE_STATES).toStrictEqual([
      'reported',
      'under_investigation',
      'findings',
      'action_issued',
    ]);
    expect(PERMITTED_CASE_TRANSITIONS.action_issued).toStrictEqual([]);
  });

  /**
   * No state-machine engine, no event-sourcing library, no workflow engine (D-5.2-16).
   *
   * The whole state machine is one map of nine lines in the vocabulary. A registry, a generic
   * transition framework or a second approval system would each be the thing the approval named and
   * forbade, and each would be easier to add than to remove.
   */
  it.each([
    'StateMachine',
    'stateMachine',
    'TransitionRegistry',
    'eventSourc',
    'Saga',
    'Aggregate',
    'projection',
  ])('builds no generic lifecycle machinery: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /**
   * `EventStore` as a thing of its own, which is event sourcing — **not** as the tail of
   * `CaseEventStore` or `AccessEventStore`, which are ordinary persistence ports.
   *
   * The first draft of this assertion matched the substring and failed on those two ports. Made
   * exact rather than deleted: the boundary it guards is real, and a scan that cannot tell an
   * event-sourcing library from a store called `…EventStore` guards nothing.
   */
  it('builds no event store', () => {
    expect(ALL_CODE).not.toMatch(/(?<![A-Za-z])EventStore/);
    // …and the two ports whose names end that way are still exactly what they claim to be.
    expect(ALL_CODE).toContain('interface CaseEventStore');
    expect(ALL_CODE).toContain('interface AccessEventStore');
  });

  /**
   * The current state is derived and never stored (D-5.2-16).
   *
   * A stored copy is a second thing that can disagree with the history, which is precisely what
   * ADR-0070 warns about. There is no `current_state` column, no `currentState` field on a domain
   * record, and no cached state anywhere — `CaseHistoryView.currentState` is computed by
   * `caseHistoryView` at the moment it is read, from the history it publishes beside it.
   */
  it('stores no copy of the derived case state', () => {
    // No column, anywhere: not in a mapper, not in a values map, not in a query.
    expect(ALL_CODE).not.toContain('current_state');
    expect(ALL_CODE).not.toContain('cachedState');

    // No field on anything persisted. Scoped to the layers that describe rows, because the *view*
    // legitimately carries a `currentState` — that is the derived answer being published, and an
    // assertion that forbade the word everywhere would forbid publishing the derivation at all.
    const persisted = sourceFiles(join(SOURCE_ROOT, 'domain'))
      .concat(sourceFiles(join(SOURCE_ROOT, 'infrastructure')))
      .map(codeOf)
      .join('\n');

    expect(persisted).not.toContain('currentState');

    // And the view's copy is computed at read time by the same function the handlers validate
    // against, so what a screen shows and what the server enforces cannot drift.
    const views = codeOf(join(SOURCE_ROOT, 'application', 'relations-views.ts'));

    expect(views).toContain('currentState: currentCaseState(history)');
  });

  /**
   * Nothing schedules anything, and nothing is delivered.
   *
   * The Platform runner is D-16E-03's, and notification delivery is Phase 17's. Building either here
   * to make a capability look finished is the failure this list exists to prevent.
   */
  it.each([
    'JobPort',
    'setInterval',
    'setTimeout',
    'cron',
    'Scheduler',
    'Worker',
    'Outbox',
    'Broker',
    'Queue',
    'NotificationPort',
    'Smtp',
    'Email',
    'Sms',
  ])('contains no %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });
});

/**
 * The boundaries Checkpoint 4 could most plausibly have crossed, asserted rather than promised.
 *
 * A disciplinary ladder is exactly the feature that tempts a module into other people's tables: a
 * suspension into Employment, a deduction into Payroll, an approval into Workflow. None of them
 * happens, and these are the assertions that keep it that way — scans of this module's own source,
 * with comments stripped, so the files that explain at length what they do *not* do still pass.
 */
describe('what a disciplinary action never does', () => {
  /** Employment owns `suspended` and `ended`. This module recommends; it does not execute (AD-005). */
  it.each([
    'EmploymentPort',
    'employment.suspend',
    'employment.end-employment',
    'employment.change-status',
    'suspendEmployment',
    'terminateEmployment',
  ])('never mutates Employment: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /** Payroll is pull-oriented. Relations instructs it in no direction. */
  it.each([
    'PayrollPort',
    'payroll.record-adjustment',
    'payroll.adjust',
    'recordDeduction',
    'calculateDeduction',
    'deductionAmount',
  ])('never writes to Payroll: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /** No second approval mechanism, and no Workflow subject registered from here. */
  it.each([
    'WorkflowPort',
    'workflow.start-instance',
    'workflow.approval',
    'subjectType',
    'ApprovalPort',
    'autoApprove',
  ])('never reaches Workflow: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /**
   * Nothing punishes anybody automatically — the property D-5.2-20 turns on.
   *
   * Issuing is a command a human sends. Nothing observes a violation being recorded, nothing reacts
   * to a threshold being crossed, and there is no path from the evaluation to the issue.
   */
  it.each([
    'autoIssue',
    'automaticAction',
    'onViolationRecorded',
    'eventHandlers',
    'subscribe',
    'trigger(',
  ])('issues nothing automatically: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /** Still no scheduler, no expiry, and no synthetic actor — Checkpoint 4 added none of them. */
  it.each([
    'JobPort',
    'setInterval',
    'Scheduler',
    'expiredAt',
    'expires_at',
    'markExpired',
    'sweep',
    'systemActor',
    'machineActor',
  ])('schedules and expires nothing: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /** No jurisdiction is named, and no statutory limit is asserted (D-5.2-06). */
  it.each([
    'Jordan',
    'Saudi',
    'maxWarnings',
    'statutoryLimit',
    'mandatorySuspension',
    'legallyPermitted',
  ])('invents no labour law: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });

  /** Evidence stays deferred: no storage adapter, no bytes, no URL (D-5.2-08). */
  it.each(['StoragePort', 'signedUrl', 'bucket', 'attachment'])(
    'stores no evidence: %s',
    (forbidden) => {
      expect([forbidden, ALL_CODE.toLowerCase().includes(forbidden.toLowerCase())]).toStrictEqual([
        forbidden,
        false,
      ]);
    },
  );

  /** No repeat state is persisted — Checkpoint 3's rule, restated where a ladder would break it. */
  it.each([
    'repeat_count',
    'repeatCount',
    'is_repeat',
    'isRepeat',
    'escalation_level',
    'escalationLevel',
  ])('persists no repeat counter: %s', (forbidden) => {
    expect([forbidden, ALL_CODE.includes(forbidden)]).toStrictEqual([forbidden, false]);
  });
});
