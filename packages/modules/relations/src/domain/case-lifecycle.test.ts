import { describe, expect, it } from 'vitest';

import {
  currentCaseState,
  nextSequence,
  recordTransition,
  REASON_LIMIT,
  type CaseEventState,
} from './case-event.js';
import {
  concludeInvestigation,
  openInvestigation,
  FINDINGS_LIMIT,
  RECOMMENDATION_LIMIT,
  SUBJECT_LIMIT,
  type InvestigationRecord,
} from './investigation.js';
import {
  CASE_STATES,
  INITIAL_CASE_STATE,
  INVESTIGATION_STATES,
  PERMITTED_CASE_TRANSITIONS,
  permitsTransition,
} from './relations-vocabulary.js';

/**
 * The lifecycle rules, tested where they are decided.
 *
 * Nothing here touches a database, a dispatcher or a clock. These are the statements the approval
 * made — which transitions exist, where a case is, what a conclusion must carry — and they are true
 * or false independently of how anything is stored.
 */

const VIOLATION = '01940000-0000-7000-8000-0000000000v1';
const ACTOR = 'user:relations-officer';
const AT = new Date('2026-08-23T09:00:00Z');

const event = (overrides: Partial<CaseEventState> = {}): CaseEventState => ({
  caseEventId: '01940000-0000-7000-8000-0000000000e1',
  violationId: VIOLATION,
  sequence: 1,
  fromState: 'reported',
  toState: 'under_investigation',
  reason: 'The supervisor asked for the absences to be looked into.',
  actor: ACTOR,
  occurredAt: AT,
  correlationId: '01940000-0000-7000-8000-0000000000c1',
  ...overrides,
});

const transition = (
  history: readonly CaseEventState[],
  overrides: Record<string, unknown> = {},
): ReturnType<typeof recordTransition> =>
  recordTransition({
    caseEventId: '01940000-0000-7000-8000-0000000000e9',
    violationId: VIOLATION,
    history,
    toState: 'under_investigation',
    reason: 'Opening an inquiry.',
    actor: ACTOR,
    occurredAt: AT,
    correlationId: '01940000-0000-7000-8000-0000000000c9',
    ...overrides,
  });

describe('where a case is', () => {
  it('is reported when nothing has happened to it', () => {
    expect(currentCaseState([])).toBe('reported');
    expect(INITIAL_CASE_STATE).toBe('reported');
  });

  it('is the destination of the highest-numbered transition', () => {
    const history = [
      event(),
      event({ sequence: 2, fromState: 'under_investigation', toState: 'findings' }),
    ];

    expect(currentCaseState(history)).toBe('findings');
  });

  /**
   * The derivation must not depend on the order rows arrive in.
   *
   * The repository orders by `sequence`, but a derivation that silently returned the wrong state
   * when an ordering changed would be a derivation that fails quietly — and quietly returning
   * `under_investigation` for a concluded case would let a transition through that should be refused.
   */
  it('does not depend on the order the history arrives in', () => {
    const first = event();
    const second = event({ sequence: 2, fromState: 'under_investigation', toState: 'findings' });

    expect(currentCaseState([second, first])).toBe('findings');
    expect(currentCaseState([first, second])).toBe('findings');
  });

  it('numbers the next transition one past the highest so far', () => {
    expect(nextSequence([])).toBe(1);
    expect(nextSequence([event()])).toBe(2);
    expect(nextSequence([event({ sequence: 7 }), event({ sequence: 3 })])).toBe(8);
  });
});

describe('which transitions exist', () => {
  it('names four states and no more', () => {
    expect(CASE_STATES).toStrictEqual([
      'reported',
      'under_investigation',
      'findings',
      'action_issued',
    ]);
    expect(INVESTIGATION_STATES).toStrictEqual(['open', 'concluded']);
  });

  it('permits exactly three moves', () => {
    expect(PERMITTED_CASE_TRANSITIONS).toStrictEqual({
      reported: ['under_investigation'],
      under_investigation: ['findings'],
      findings: ['action_issued'],
      action_issued: [],
    });
  });

  /**
   * Every pair, stated exhaustively rather than sampled.
   *
   * Sixteen combinations, three permitted, thirteen refused — including every self-transition,
   * because a move that changes nothing is not a move, and including everything that leaves
   * `action_issued`, because acknowledging, appealing, upholding and annulling are all capabilities
   * nothing here builds.
   */
  it.each(
    CASE_STATES.flatMap((from) =>
      CASE_STATES.map((to) => ({
        from,
        to,
        permitted: PERMITTED_CASE_TRANSITIONS[from].includes(to),
      })),
    ),
  )('$from → $to is permitted: $permitted', ({ from, to, permitted }) => {
    expect(permitsTransition(from, to)).toBe(permitted);
  });
});

describe('recording a transition', () => {
  it('derives the from-state from history rather than accepting one', () => {
    const accepted = transition([]);

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.fromState).toBe('reported');
    expect(accepted.value.toState).toBe('under_investigation');
    expect(accepted.value.sequence).toBe(1);
  });

  /**
   * The request has no field that could name a from-state, and this proves it structurally rather
   * than by trusting the interface: a caller-supplied `fromState` is ignored, so a future field
   * added by accident could not steer the validation.
   */
  it('ignores a from-state a caller tries to supply', () => {
    const history = [event()];
    const attempted = transition(history, { fromState: 'reported', toState: 'findings' });

    expect(attempted.ok).toBe(true);
    if (!attempted.ok) return;
    // Derived from the history — `under_investigation` — not the `reported` the caller claimed.
    expect(attempted.value.fromState).toBe('under_investigation');
  });

  it('refuses a move the state it is actually in does not allow', () => {
    const refused = transition([], { toState: 'findings' });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.reason).toBe('transition_not_permitted');
    expect(refused.error.messageKey).toBe('relations.rejection.transition_not_permitted');
    // The refusal names both states and nothing about the person.
    expect(refused.error.detail).toStrictEqual({ from: 'reported', to: 'findings' });
  });

  it('refuses moving a case that has already had an action issued', () => {
    const history = [
      event(),
      event({ sequence: 2, fromState: 'under_investigation', toState: 'findings' }),
      event({ sequence: 3, fromState: 'findings', toState: 'action_issued' }),
    ];

    for (const toState of CASE_STATES) {
      const refused = transition(history, { toState });

      expect([toState, refused.ok]).toStrictEqual([toState, false]);
    }
  });

  it('requires a reason, and bounds it', () => {
    expect(transition([], { reason: '   ' })).toMatchObject({
      ok: false,
      error: { reason: 'transition_reason_missing' },
    });
    expect(transition([], { reason: 'x'.repeat(REASON_LIMIT + 1) })).toMatchObject({
      ok: false,
      error: { reason: 'transition_reason_too_long' },
    });
  });

  it('refuses a transition nobody is attributable for', () => {
    expect(transition([], { actor: '  ' })).toMatchObject({
      ok: false,
      error: { reason: 'transition_actor_unknown' },
    });
  });
});

const opened = (overrides: Record<string, unknown> = {}): ReturnType<typeof openInvestigation> =>
  openInvestigation({
    investigationId: '01940000-0000-7000-8000-0000000000i1',
    violationId: VIOLATION,
    investigatorMembershipId: '01940000-0000-7000-8000-0000000000m1',
    openedOn: '2026-08-21',
    subject: 'Three consecutive unnotified absences',
    today: '2026-08-23',
    ...overrides,
  });

const openRecord = (): InvestigationRecord => {
  const result = opened();

  if (!result.ok) throw new Error('the fixture must open');
  return result.value;
};

describe('opening an investigation', () => {
  it('opens with nothing concluded', () => {
    const record = openRecord();

    expect(record.state).toBe('open');
    expect(record.findings).toBeUndefined();
    expect(record.recommendation).toBeUndefined();
    expect(record.concludedOn).toBeUndefined();
    expect(record.version).toBe(1);
  });

  it('refuses an opening date that is malformed or in the future', () => {
    expect(opened({ openedOn: '21-08-2026' })).toMatchObject({
      ok: false,
      error: { reason: 'opened_on_malformed' },
    });
    expect(opened({ openedOn: '2026-08-24' })).toMatchObject({
      ok: false,
      error: { reason: 'opened_on_in_future' },
    });
  });

  it('requires an investigator and a subject', () => {
    expect(opened({ investigatorMembershipId: ' ' })).toMatchObject({
      ok: false,
      error: { reason: 'investigator_unknown' },
    });
    expect(opened({ subject: '  ' })).toMatchObject({
      ok: false,
      error: { reason: 'subject_missing' },
    });
    expect(opened({ subject: 'x'.repeat(SUBJECT_LIMIT + 1) })).toMatchObject({
      ok: false,
      error: { reason: 'subject_too_long' },
    });
  });
});

const concluded = (
  overrides: Record<string, unknown> = {},
): ReturnType<typeof concludeInvestigation> =>
  concludeInvestigation({
    investigation: openRecord(),
    findings: 'The absences were unnotified and the shift log confirms them.',
    recommendation: 'A written warning.',
    concludedOn: '2026-08-23',
    today: '2026-08-23',
    ...overrides,
  });

describe('concluding an investigation', () => {
  it('records findings, a recommendation and a date, together', () => {
    const result = concluded();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe('concluded');
    expect(result.value.findings).toContain('shift log');
    expect(result.value.recommendation).toBe('A written warning.');
    expect(result.value.concludedOn).toBe('2026-08-23');
  });

  /**
   * The version passes through unchanged. The repository appends `version = version + 1`, so a
   * domain that incremented it would write the column twice in one statement — the failure
   * Checkpoint 1's integration suite found, kept out of this aggregate by an assertion rather than a
   * comment.
   */
  it('does not increment the version itself', () => {
    const result = concluded();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(1);
  });

  it('refuses to conclude one that already has', () => {
    const already = concluded();

    expect(already.ok).toBe(true);
    if (!already.ok) return;

    expect(
      concludeInvestigation({
        investigation: already.value,
        findings: 'Something else.',
        recommendation: 'Something else.',
        concludedOn: '2026-08-23',
        today: '2026-08-23',
      }),
    ).toMatchObject({ ok: false, error: { reason: 'investigation_already_concluded' } });
  });

  it('refuses a conclusion date that is malformed, in the future, or before it opened', () => {
    expect(concluded({ concludedOn: '23/08/2026' })).toMatchObject({
      ok: false,
      error: { reason: 'concluded_on_malformed' },
    });
    expect(concluded({ concludedOn: '2026-08-24' })).toMatchObject({
      ok: false,
      error: { reason: 'concluded_on_in_future' },
    });
    expect(concluded({ concludedOn: '2026-08-20' })).toMatchObject({
      ok: false,
      error: { reason: 'concluded_before_opened' },
    });
  });

  it('requires both halves of the conclusion, and bounds each', () => {
    expect(concluded({ findings: '   ' })).toMatchObject({
      ok: false,
      error: { reason: 'findings_missing' },
    });
    expect(concluded({ findings: 'x'.repeat(FINDINGS_LIMIT + 1) })).toMatchObject({
      ok: false,
      error: { reason: 'findings_too_long' },
    });
    expect(concluded({ recommendation: '' })).toMatchObject({
      ok: false,
      error: { reason: 'recommendation_missing' },
    });
    expect(concluded({ recommendation: 'x'.repeat(RECOMMENDATION_LIMIT + 1) })).toMatchObject({
      ok: false,
      error: { reason: 'recommendation_too_long' },
    });
  });
});
