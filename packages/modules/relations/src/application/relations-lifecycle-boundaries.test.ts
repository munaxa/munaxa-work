import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

describe('what the case lifecycle is not', () => {
  /**
   * The lifecycle stops where Checkpoint 2's capability stops.
   *
   * The specification's lifecycle continues through pending-approval, action-issued, acknowledged,
   * appealed, upheld, annulled, expired and archived. **None of those states is nameable anywhere in
   * this module**, because nothing here can produce one — and a vocabulary that listed them would be
   * a promise the code cannot keep. This is the same restraint `VIOLATION_STATES` showed at one
   * value, asserted at three.
   */
  it.each([
    'pending_approval',
    'action_issued',
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
