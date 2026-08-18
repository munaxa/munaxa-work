import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cancellationHistory, decisionHistory, startHistory } from './history.js';
import { decide } from './decision.js';
import { cancelInstance } from './instance.js';
import { AT, must, startedInstance } from './workflow-fixtures.js';
import {
  APPROVER_KINDS,
  WORKFLOW_HISTORY_EVENTS,
  isPositiveWhole,
  isSubjectType,
} from './workflow-vocabulary.js';

/**
 * What this module deliberately does not contain, asserted against the source rather than assumed.
 *
 * **Prose is not implementation.** `workflow-vocabulary.ts` has to name `role`, `sla` and `escalate`
 * in order to explain why none of them exists, so a bare string search over this package would fail
 * against its own documentation. Comments and string literals are stripped before the search, which
 * leaves the code — an identifier, a property, a type — and that is what a capability would actually
 * be written in.
 */
const DOMAIN = join(process.cwd(), 'src', 'domain');

/** Source with block comments, line comments and string literals removed. */
const codeOf = (file: string): string =>
  readFileSync(join(DOMAIN, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

const sources = readdirSync(DOMAIN).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.includes('fixtures'),
);
const code = sources.map((file) => codeOf(file)).join('\n');

/**
 * The boundary this suite guards **moved in Phase 16B, and it moved by authorization rather than by
 * drift.**
 *
 * Until 16B this asserted that tallies, parallel approval, branching and groups were absent. They
 * are present now, each built against parameters that were approved one by one — so those rows were
 * *rewritten* to assert what replaced them rather than deleted, which would have removed the guard
 * instead of moving it.
 *
 * **It moved again in Phase 16C, on the same terms.** The requester's manager is now an approver kind
 * and a step may carry an elapsed-time target — both against parameters approved one at a time
 * (D-16C-04, D-16C-05, P-1 to P-6). So those two rows were rewritten to assert *what is still absent
 * around them*, which is narrower and therefore harder to satisfy by accident: manager routing exists
 * but only one level from the requester along the primary line, and a target exists but nothing
 * measures it in business days and nothing turns it into a state.
 *
 * What remains deferred is Phase 16D and later, and every fragment below would appear in the code if
 * any of it had been started.
 */
describe('what is still not present', () => {
  /**
   * Each entry is a capability 16C owns, and a fragment that would appear in the *code* if it had
   * been built. Deliberately narrow: `sla` rather than `s`, `escalat` rather than `level`, so an
   * ordinary word cannot trip them.
   */
  const deferred: readonly (readonly [string, readonly string[]])[] = [
    // A target is elapsed time and nothing else: no calendar, and no state it turns into. `breach`
    // and `expired` are the words a written terminal state would arrive under, and D-16C-06 refused
    // one — a step is *read* as overdue and never stored that way.
    ['business days or a breach state', ['sla', 'businessDay', 'workingDay', 'breach', 'expired']],
    // `escalat` left this list in Phase 16D **by authorization, not by attrition** (D-16D-02,
    // D-16D-05), exactly as `managerOf` and `slaDue` left it in 16C. What replaced it is narrower and
    // sharper: escalation exists, and the *automatic* half of it still does not. The companion test
    // below asserts the capability **present**, so a fragment removed from this list can never pass
    // for a capability quietly abandoned.
    ['automatic escalation', ['escalateAfter', 'autoEscalat', 'escalationTimer', 'sweep']],
    ['scheduling', ['JobPort', 'cron', 'schedule', 'enqueue']],
    // Manager routing exists; walking a hierarchy does not. One level, from the requester, along the
    // primary line (P-1 to P-4) — so a chain, a depth or a functional line would all be new.
    ['manager chains beyond one level', ['reportsTo', 'reportingLine', 'functional', 'levelsUp']],
    ['role and external approvers', ['roleId', 'permissionHolder', 'externalApprover']],
    ['notification', ['notify', 'notification', 'recipient', 'reminder']],
    ['analytics', ['analytic', 'aggregate', 'distribution', 'percentile']],
  ];

  for (const [capability, fragments] of deferred) {
    it(`has no ${capability} in its code`, () => {
      const present = fragments.filter((fragment) =>
        new RegExp(fragment, 'i').test(code.replace(/\s+/g, ' ')),
      );

      expect(present).toStrictEqual([]);
    });
  }

  /**
   * The three approver kinds this module ships, and the two it does not.
   *
   * A `group` is a list Workflow keeps and resolves once, at instance start. A `manager` is the
   * requester's immediate manager, resolved once at the same moment. Neither is a directory: `role`
   * would need one, and this repository has committed never to build it.
   */
  it('knows exactly three kinds of approver', () => {
    expect([...APPROVER_KINDS]).toStrictEqual(['membership', 'group', 'manager']);
    for (const absent of ['role', 'external', 'dynamic']) {
      expect([absent, [...APPROVER_KINDS].includes(absent as never)]).toEqual([absent, false]);
    }
  });

  /**
   * No weight and no percentage: every tally is an integer count over an integer denominator.
   *
   * Anchored to word boundaries, because `ratio` is a substring of `configuration` and `operation`
   * and an unanchored search reports the arithmetic this module refuses to do wherever it happens to
   * name a configuration. The same lesson the 16A scope audit learned about `group` and `sla`.
   */
  it('has no weighted or proportional arithmetic', () => {
    for (const fragment of ['weight', 'percent', 'ratio', 'toFixed', 'parseFloat', 'Math.round']) {
      expect([fragment, new RegExp(`\\b${fragment.replace('.', '\\.')}`, 'i').test(code)]).toEqual([
        fragment,
        false,
      ]);
    }
  });

  /**
   * The control on every row above: what 16C *did* build is present.
   *
   * A negative suite alone cannot tell "refused" from "forgotten". These four fragments would be
   * missing if the manager rule or the elapsed-time target had quietly not been written, and the
   * rows above would then pass for the wrong reason.
   */
  it('does contain the manager rule and the elapsed-time target it was approved to build', () => {
    for (const built of ['resolveManager', 'resolutionDateOf', 'serviceLevelTarget', 'dueAt']) {
      expect([built, new RegExp(`\\b${built}\\b`).test(code)]).toEqual([built, true]);
    }
  });

  /**
   * And the same control for Phase 16D's one capability.
   *
   * `escalat` left the deferred list above by authorization; this is what stops that from being a
   * hole. Escalation exists as a rule, the denominator is a set the tally can tell from its
   * additions, the identity a duplicate is judged on is written down, and the history event is named
   * — all four would be missing if the row above had simply been deleted.
   *
   * **Identifiers only.** The refusal names are string literals and this scanner strips those, on
   * purpose: what it searches is code. That the `unanimous` refusal fires by its own name is asserted
   * where it can be — against the function, in `workflow-escalation.test.ts`.
   */
  it('does contain the escalation rule Phase 16D was approved to build', () => {
    for (const built of [
      'escalateBranch',
      'escalationIdentity',
      'escalatedAt',
      'ESCALATION_EVENT',
    ]) {
      expect([built, new RegExp(`\\b${built}\\b`).test(code)]).toEqual([built, true]);
    }
  });

  it('places no upper bound on the number of steps (AD-004)', () => {
    expect(isPositiveWhole(1)).toBe(true);
    expect(isPositiveWhole(2_147_483_000)).toBe(true);
    expect(isPositiveWhole(0)).toBe(false);
    expect(isPositiveWhole(1.5)).toBe(false);
  });
});

describe('no business vocabulary leaked in (AD-001)', () => {
  it('names no business module and no business concept', () => {
    const business = [
      'leave',
      'requisition',
      'payroll',
      'attendance',
      'compensation',
      'onboarding',
      'salary',
      'amount',
      'employee',
    ];
    const present = business.filter((word) => new RegExp(`\\b${word}`, 'i').test(code));

    expect(present).toStrictEqual([]);
  });

  it('validates a subject type by shape alone, holding no list of them', () => {
    expect(isSubjectType('recruitment.requisition')).toBe(true);
    expect(isSubjectType('a-module-nobody-has-written.a-subject')).toBe(true);
    expect(isSubjectType('norealsubject')).toBe(false);
    expect(isSubjectType('Recruitment.Requisition')).toBe(false);
  });
});

describe('history records routing and not business facts', () => {
  it('has a closed event list with no business word in it', () => {
    expect([...WORKFLOW_HISTORY_EVENTS]).toStrictEqual([
      'instance-started',
      'step-awaiting',
      'step-approved',
      'step-rejected',
      'step-skipped',
      // Phase 16D's ninth, added with the database constraint in the same migration rather than
      // before it. It says an approver was **added** to a branch, and it is deliberately not one of
      // the three decision events above: recording an escalation as an approval, a rejection or a
      // skip would put an answer in the timeline that nobody gave.
      'step-escalated',
      'instance-completed',
      'instance-rejected',
      'instance-cancelled',
    ]);
  });

  it('writes the instance and the first assignment when an instance starts', () => {
    const started = startedInstance(2);
    const entries = startHistory(started, ['history-1', 'history-2']);

    expect(entries.map((history) => history.event)).toStrictEqual([
      'instance-started',
      'step-awaiting',
    ]);
    expect(entries[1]?.ordinal).toBe(1);
    expect(entries[0]?.actorMembershipId).toBe('membership-requester');
  });

  it('records the delegate and the authority, and carries no comment', () => {
    const started = startedInstance(1);
    const first = started.steps[0];

    if (first === undefined) throw new Error('The fixture has no first step.');

    const decided = must(
      decide(started.instance, first, started.steps, {
        decisionId: 'd',
        decision: 'approved',
        decidedByMembershipId: 'membership-deputy',
        authority: 'delegated',
        onBehalfOfMembershipId: first.approverMembershipId,
        at: AT,
        comment: 'Agreed, with reservations about the timing.',
      }),
      'a delegated approval',
    );
    const entries = decisionHistory(decided, ['history-1', 'history-2']);

    expect(entries.map((history) => history.event)).toStrictEqual([
      'step-approved',
      'instance-completed',
    ]);
    expect(entries[0]?.actorMembershipId).toBe('membership-deputy');
    expect(entries[0]?.onBehalfOfMembershipId).toBe(first.approverMembershipId);
    // The comment lives on the decision, where a permission decides who may read it.
    expect(JSON.stringify(entries)).not.toContain('reservations');
  });

  it('explains every abandoned step on a rejection', () => {
    const started = startedInstance(3);
    const first = started.steps[0];

    if (first === undefined) throw new Error('The fixture has no first step.');

    const decided = must(
      decide(started.instance, first, started.steps, {
        decisionId: 'd',
        decision: 'rejected',
        decidedByMembershipId: first.approverMembershipId,
        authority: 'assigned',
        at: AT,
      }),
      'a rejection',
    );
    const entries = decisionHistory(decided, ['h1', 'h2', 'h3', 'h4']);

    expect(entries.map((history) => history.event)).toStrictEqual([
      'step-rejected',
      'step-skipped',
      'step-skipped',
      'instance-rejected',
    ]);
  });

  it('drops entries the caller supplied no identifier for rather than inventing one', () => {
    const started = startedInstance(3);
    const cancelled = must(
      cancelInstance(started.instance, started.steps, { by: 'u', reason: 'stopped', at: AT }),
      'a cancellation',
    );

    expect(cancellationHistory(cancelled, AT, ['h1', 'h2', 'h3', 'h4'])).toHaveLength(4);
    expect(cancellationHistory(cancelled, AT, ['h1'])).toHaveLength(1);
    expect(cancellationHistory(cancelled, AT, [])).toStrictEqual([]);
  });
});

describe('a decision is append-only', () => {
  it('exposes no way to change one', () => {
    const forbidden = ['amendDecision', 'updateDecision', 'retractDecision', 'deleteDecision'];
    const present = forbidden.filter((name) => code.includes(name));

    expect(present).toStrictEqual([]);
  });

  it('exposes no way to set an instance status directly', () => {
    // Terminal states are reached by deciding a step or cancelling, never assigned by a caller.
    expect(code).not.toContain('setStatus');
    expect(code).not.toContain('setInstanceStatus');
  });
});
