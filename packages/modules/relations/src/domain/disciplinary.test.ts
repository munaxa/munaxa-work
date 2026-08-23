import { describe, expect, it } from 'vitest';

import {
  amendDisciplinaryRule,
  applicableRule,
  defineDisciplinaryRule,
  type DisciplinaryRuleState,
} from './disciplinary-ladder.js';
import { issueDisciplinaryAction } from './disciplinary-action.js';
import { DISCIPLINARY_ACTIONS, PERMITTED_CASE_TRANSITIONS } from './relations-vocabulary.js';

/**
 * The ladder's rules and the action's, tested where they are decided.
 *
 * The question this file exists to answer is the one D-5.2-20 turns on: **does anything here invent
 * a disciplinary outcome?** Every assertion about an absent rule is an assertion that it does not.
 */

const CATEGORY = '01940000-0000-7000-8000-0000000000c1';

const rule = (overrides: Partial<DisciplinaryRuleState> = {}): DisciplinaryRuleState => ({
  disciplinaryRuleId: '01940000-0000-7000-8000-0000000000r1',
  violationCategoryId: CATEGORY,
  minOccurrence: 1,
  action: 'verbal_warning',
  sequence: 10,
  active: true,
  version: 1,
  ...overrides,
});

describe('the action vocabulary', () => {
  it('is five values, and each is one this module can represent', () => {
    expect(DISCIPLINARY_ACTIONS).toStrictEqual([
      'verbal_warning',
      'written_warning',
      'final_warning',
      'suspension_recommendation',
      'termination_recommendation',
    ]);
  });

  /**
   * The two most serious are recommendations, and the naming is the module boundary made
   * unmisreadable: Employment owns `suspended` and `ended` (AD-005), and a value called
   * `termination` would promise something Relations must never do.
   */
  it('names no action this module could not honestly perform', () => {
    expect(DISCIPLINARY_ACTIONS).not.toContain('suspension');
    expect(DISCIPLINARY_ACTIONS).not.toContain('termination');
    expect(DISCIPLINARY_ACTIONS).not.toContain('dismissal');
    expect(DISCIPLINARY_ACTIONS).not.toContain('payroll_deduction');
    expect(DISCIPLINARY_ACTIONS).not.toContain('fine');
  });

  it('adds one lifecycle edge and leaves the case terminal after it', () => {
    expect(PERMITTED_CASE_TRANSITIONS.findings).toStrictEqual(['action_issued']);
    // Acknowledged, appealed, upheld, annulled are all later capabilities.
    expect(PERMITTED_CASE_TRANSITIONS.action_issued).toStrictEqual([]);
  });
});

describe('defining a rung', () => {
  const defined = (overrides: Record<string, unknown> = {}) =>
    defineDisciplinaryRule({
      disciplinaryRuleId: '01940000-0000-7000-8000-0000000000r9',
      violationCategoryId: CATEGORY,
      minOccurrence: 3,
      action: 'final_warning',
      sequence: 30,
      ...overrides,
    });

  it('accepts a well-formed rule and starts it active', () => {
    const result = defined();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ minOccurrence: 3, action: 'final_warning', active: true });
  });

  it('refuses a threshold below one', () => {
    // A threshold of zero would apply to a violation that has not happened.
    expect(defined({ minOccurrence: 0 })).toMatchObject({
      ok: false,
      error: { reason: 'rule_occurrence_invalid' },
    });
    expect(defined({ minOccurrence: 1.5 })).toMatchObject({ ok: false });
  });

  it('refuses an action outside the vocabulary', () => {
    expect(defined({ action: 'public_flogging' })).toMatchObject({
      ok: false,
      error: { reason: 'rule_action_unknown' },
    });
    // Including the ones that would imply a cross-module write.
    expect(defined({ action: 'termination' })).toMatchObject({ ok: false });
  });

  it('refuses a negative sequence', () => {
    expect(defined({ sequence: -1 })).toMatchObject({
      ok: false,
      error: { reason: 'rule_sequence_invalid' },
    });
  });
});

describe('amending a rung', () => {
  it('changes the action, the order and whether it is in service', () => {
    const result = amendDisciplinaryRule({
      rule: rule(),
      action: 'written_warning',
      sequence: 20,
      active: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      action: 'written_warning',
      sequence: 20,
      active: false,
    });
  });

  /**
   * The rule's identity is what it applies to and when. An amendment cannot touch either, so an
   * action already issued under a rule cannot come to point at one that means something else.
   */
  it('cannot move a rule to a different category or threshold', () => {
    const result = amendDisciplinaryRule({ rule: rule(), action: 'final_warning' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.violationCategoryId).toBe(CATEGORY);
    expect(result.value.minOccurrence).toBe(1);
  });

  it('refuses an unknown action', () => {
    expect(amendDisciplinaryRule({ rule: rule(), action: 'exile' })).toMatchObject({
      ok: false,
      error: { reason: 'rule_action_unknown' },
    });
  });
});

describe('which rung applies', () => {
  const ladder = [
    rule({ disciplinaryRuleId: 'r-1', minOccurrence: 1, action: 'verbal_warning', sequence: 10 }),
    rule({ disciplinaryRuleId: 'r-3', minOccurrence: 3, action: 'written_warning', sequence: 30 }),
    rule({ disciplinaryRuleId: 'r-5', minOccurrence: 5, action: 'final_warning', sequence: 50 }),
  ];

  it('picks the most specific rung at or below the occurrence', () => {
    expect(applicableRule(ladder, 1)?.action).toBe('verbal_warning');
    expect(applicableRule(ladder, 2)?.action).toBe('verbal_warning');
    expect(applicableRule(ladder, 3)?.action).toBe('written_warning');
    expect(applicableRule(ladder, 4)?.action).toBe('written_warning');
    expect(applicableRule(ladder, 9)?.action).toBe('final_warning');
  });

  /**
   * **The assertion D-5.2-20 turns on.** A tenant that has configured nothing gets nothing — not a
   * default, not the lowest rung, not a guess. An undocumented default would be this product
   * choosing a customer's disciplinary policy.
   */
  it('prescribes nothing when the tenant has configured nothing', () => {
    expect(applicableRule([], 3)).toBeUndefined();
  });

  it('prescribes nothing when no rung reaches this occurrence', () => {
    expect(applicableRule([rule({ minOccurrence: 5 })], 2)).toBeUndefined();
  });

  it('ignores a rung taken out of service', () => {
    const retired = [rule({ disciplinaryRuleId: 'r-1', minOccurrence: 1, active: false })];

    expect(applicableRule(retired, 3)).toBeUndefined();
  });

  /** Deterministic, and never dependent on the order the rules arrived in. */
  it('breaks a tie by sequence, then by identifier', () => {
    const tied = [
      rule({ disciplinaryRuleId: 'b', minOccurrence: 2, sequence: 5, action: 'final_warning' }),
      rule({ disciplinaryRuleId: 'a', minOccurrence: 2, sequence: 5, action: 'written_warning' }),
      rule({ disciplinaryRuleId: 'c', minOccurrence: 2, sequence: 1, action: 'verbal_warning' }),
    ];

    // Lowest sequence wins the tie on threshold.
    expect(applicableRule(tied, 3)?.disciplinaryRuleId).toBe('c');
    expect(applicableRule([...tied].reverse(), 3)?.disciplinaryRuleId).toBe('c');

    const sameSequence = tied.filter((held) => held.sequence === 5);

    expect(applicableRule(sameSequence, 3)?.disciplinaryRuleId).toBe('a');
    expect(applicableRule([...sameSequence].reverse(), 3)?.disciplinaryRuleId).toBe('a');
  });
});

describe('issuing an action', () => {
  const issued = (overrides: Record<string, unknown> = {}) =>
    issueDisciplinaryAction({
      disciplinaryActionId: '01940000-0000-7000-8000-0000000000a1',
      violationId: '01940000-0000-7000-8000-0000000000v1',
      investigationId: '01940000-0000-7000-8000-0000000000i1',
      action: 'written_warning',
      occurrenceAtIssue: 3,
      reason: 'Three unnotified absences, confirmed by the inquiry.',
      issuedBy: 'user:relations-officer',
      issuedOn: '2026-08-23',
      issuedAt: new Date('2026-08-23T09:00:00Z'),
      correlationId: '01940000-0000-7000-8000-0000000000c9',
      today: '2026-08-23',
      ...overrides,
    });

  it('records what was issued, and freezes the occurrence it was based on', () => {
    const result = issued();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      action: 'written_warning',
      occurrenceAtIssue: 3,
      prescribedByRule: false,
      issuedBy: 'user:relations-officer',
    });
    expect(result.value.disciplinaryRuleId).toBeUndefined();
  });

  it('records that a rule prescribed it, and which', () => {
    const result = issued({ rule: rule({ disciplinaryRuleId: 'r-3', action: 'written_warning' }) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prescribedByRule).toBe(true);
    expect(result.value.disciplinaryRuleId).toBe('r-3');
  });

  /**
   * A human may issue an action the ladder did not prescribe — that is judgement, and refusing it
   * would be an automatic punishment engine in the opposite direction. What is refused is *claiming*
   * a rule prescribed something it did not.
   */
  it('refuses a rule that prescribes a different action from the one issued', () => {
    expect(issued({ rule: rule({ action: 'verbal_warning' }) })).toMatchObject({
      ok: false,
      error: { reason: 'action_rule_mismatch' },
    });
  });

  it('refuses an action outside the vocabulary', () => {
    expect(issued({ action: 'termination' })).toMatchObject({
      ok: false,
      error: { reason: 'action_unknown' },
    });
  });

  it('refuses an issue date in the future or malformed', () => {
    expect(issued({ issuedOn: '2026-08-24' })).toMatchObject({
      ok: false,
      error: { reason: 'issued_on_in_future' },
    });
    expect(issued({ issuedOn: '23-08-2026' })).toMatchObject({
      ok: false,
      error: { reason: 'issued_on_malformed' },
    });
  });

  it('requires a reason, and requires somebody to be accountable for it', () => {
    expect(issued({ reason: '  ' })).toMatchObject({
      ok: false,
      error: { reason: 'action_reason_missing' },
    });
    expect(issued({ reason: 'x'.repeat(2001) })).toMatchObject({
      ok: false,
      error: { reason: 'action_reason_too_long' },
    });
    expect(issued({ issuedBy: ' ' })).toMatchObject({
      ok: false,
      error: { reason: 'action_issuer_unknown' },
    });
  });

  it('refuses an occurrence that is not a positive whole number', () => {
    expect(issued({ occurrenceAtIssue: 0 })).toMatchObject({
      ok: false,
      error: { reason: 'action_occurrence_invalid' },
    });
  });
});
