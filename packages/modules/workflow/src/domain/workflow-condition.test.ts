import { describe, expect, it } from 'vitest';

import {
  conditionIsWellFormed,
  evaluateAllOf,
  evaluateCondition,
  type BranchCondition,
} from './condition.js';
import { CONDITION_OPERATORS } from './workflow-vocabulary.js';

/**
 * The closed condition form, and the two things it refuses rather than guesses.
 *
 * **A missing key is a refusal.** Half of this file exists for that one rule. A condition that
 * evaluated an absent operand as `false` would route an approval somewhere — quietly skipping the
 * finance director because a requesting module spelled a key differently — and the failure would
 * look like a correctly-working process to everybody involved.
 *
 * **A type mismatch is a refusal too.** `'50000' === 50000` has an answer in JavaScript and no answer
 * in a business rule, and picking one would be inventing a coercion nobody approved.
 */

const held = (condition: BranchCondition, context: Record<string, unknown>): boolean | string => {
  const result = evaluateCondition(condition, context);

  return result.ok ? result.value : result.error.reason;
};

describe('the operators', () => {
  it('compares equality on strings and on whole numbers', () => {
    expect(held({ key: 'kind', operator: 'equals', value: 'capital' }, { kind: 'capital' })).toBe(
      true,
    );
    expect(held({ key: 'kind', operator: 'equals', value: 'capital' }, { kind: 'revenue' })).toBe(
      false,
    );
    expect(held({ key: 'n', operator: 'equals', value: 5 }, { n: 5 })).toBe(true);
    expect(held({ key: 'n', operator: 'not-equals', value: 5 }, { n: 6 })).toBe(true);
  });

  it('orders whole numbers, strictly', () => {
    expect(held({ key: 'n', operator: 'greater-than', value: 100 }, { n: 101 })).toBe(true);
    expect(held({ key: 'n', operator: 'greater-than', value: 100 }, { n: 100 })).toBe(false);
    expect(held({ key: 'n', operator: 'less-than', value: 100 }, { n: 99 })).toBe(true);
    expect(held({ key: 'n', operator: 'less-than', value: 100 }, { n: 100 })).toBe(false);
  });

  it('tests membership of a list', () => {
    const condition: BranchCondition = { key: 'unit', operator: 'in', value: ['a', 'b'] };

    expect(held(condition, { unit: 'a' })).toBe(true);
    expect(held(condition, { unit: 'c' })).toBe(false);
  });

  it('has exactly five, and no combinator but all-of', () => {
    expect([...CONDITION_OPERATORS]).toStrictEqual([
      'equals',
      'not-equals',
      'greater-than',
      'less-than',
      'in',
    ]);
  });
});

describe('a missing operand refuses, and never evaluates to false', () => {
  /**
   * The rule this file exists for, asserted for every operator rather than for a representative one:
   * a per-operator implementation could easily get four right and one wrong.
   */
  it.each(CONDITION_OPERATORS)('refuses a missing key under %s', (operator) => {
    const condition = {
      key: 'absent',
      operator,
      value: operator === 'in' ? ['x'] : 1,
    } as BranchCondition;

    expect(held(condition, { present: 1 })).toBe('condition-key-missing');
  });

  /** A key that is present and explicitly `undefined` is present. The check is about the key. */
  it('distinguishes an absent key from a key holding an unusable value', () => {
    expect(held({ key: 'k', operator: 'equals', value: 1 }, {})).toBe('condition-key-missing');
    expect(held({ key: 'k', operator: 'equals', value: 1 }, { k: undefined })).toBe(
      'condition-operand-unsupported',
    );
    expect(held({ key: 'k', operator: 'equals', value: 1 }, { k: { nested: true } })).toBe(
      'condition-operand-unsupported',
    );
    expect(held({ key: 'k', operator: 'equals', value: 1 }, { k: 1.5 })).toBe(
      'condition-operand-unsupported',
    );
  });
});

describe('a type mismatch refuses, and never coerces', () => {
  it('refuses a string against a number and a number against a string', () => {
    expect(held({ key: 'n', operator: 'equals', value: 50_000 }, { n: '50000' })).toBe(
      'condition-operand-mismatched',
    );
    expect(held({ key: 's', operator: 'equals', value: 'x' }, { s: 1 })).toBe(
      'condition-operand-mismatched',
    );
  });

  it('refuses an ordering comparison against text', () => {
    expect(held({ key: 's', operator: 'greater-than', value: 1 }, { s: 'many' })).toBe(
      'condition-operand-mismatched',
    );
  });

  it('refuses a list whose entries are not the kind the context holds', () => {
    expect(held({ key: 'n', operator: 'in', value: ['1', '2'] }, { n: 1 })).toBe(
      'condition-operand-mismatched',
    );
  });
});

describe('what a version may be published with', () => {
  it('accepts the five operators with values of the right kind', () => {
    expect(conditionIsWellFormed({ key: 'k', operator: 'equals', value: 'a' }).ok).toBe(true);
    expect(conditionIsWellFormed({ key: 'k', operator: 'greater-than', value: 5 }).ok).toBe(true);
    expect(conditionIsWellFormed({ key: 'k', operator: 'in', value: [1, 2] }).ok).toBe(true);
  });

  const reasonOf = (condition: BranchCondition): string => {
    const checked = conditionIsWellFormed(condition);

    return checked.ok ? 'accepted' : checked.error.reason;
  };

  it('refuses an empty key and an unknown operator', () => {
    expect(reasonOf({ key: '  ', operator: 'equals', value: 1 })).toBe('condition-key-required');
    expect(reasonOf({ key: 'k', operator: 'matches' as never, value: 1 })).toBe(
      'condition-operator-invalid',
    );
  });

  /**
   * Two different mistakes, and they get two different reasons.
   *
   * `'big'` is a legal condition *value* — text is — and illegal as an ordering bound, so the reason
   * names the comparison. `1.5` is not a legal value at all, whatever the operator, so it is refused
   * before the operator is consulted. Asserting the more specific reason for both would have been
   * asserting the wrong thing about the second.
   */
  it('refuses an ordering comparison against text, and a fractional bound outright', () => {
    expect(reasonOf({ key: 'k', operator: 'greater-than', value: 'big' })).toBe(
      'condition-comparison-requires-a-number',
    );
    expect(reasonOf({ key: 'k', operator: 'less-than', value: 1.5 })).toBe(
      'condition-value-invalid',
    );
  });

  it('refuses a list that is empty, mixed, or not a list at all', () => {
    expect(reasonOf({ key: 'k', operator: 'in', value: [] })).toBe('condition-in-requires-a-list');
    expect(reasonOf({ key: 'k', operator: 'in', value: 'a' })).toBe('condition-in-requires-a-list');
    expect(reasonOf({ key: 'k', operator: 'in', value: ['a', 1] })).toBe('condition-value-invalid');
  });

  it('refuses a list for an operator that takes one value', () => {
    expect(reasonOf({ key: 'k', operator: 'equals', value: ['a'] })).toBe(
      'condition-value-invalid',
    );
  });

  /** No fractions anywhere: a condition compares whole numbers or text, and nothing else. */
  it('refuses a fractional bound', () => {
    expect(reasonOf({ key: 'k', operator: 'equals', value: 1.5 })).toBe('condition-value-invalid');
  });
});

describe('all-of', () => {
  const context = { amount: 50_000, kind: 'capital' };

  it('holds only when every condition holds', () => {
    const all = evaluateAllOf(
      [
        { key: 'amount', operator: 'greater-than', value: 10_000 },
        { key: 'kind', operator: 'equals', value: 'capital' },
      ],
      context,
    );

    expect(all).toStrictEqual({ ok: true, value: true });
  });

  it('is false when any one does not hold', () => {
    const all = evaluateAllOf(
      [
        { key: 'amount', operator: 'greater-than', value: 10_000 },
        { key: 'kind', operator: 'equals', value: 'revenue' },
      ],
      context,
    );

    expect(all).toStrictEqual({ ok: true, value: false });
  });

  /** One unevaluable condition refuses the lot: a partial answer is the thing being avoided. */
  it('refuses when any one cannot be evaluated, even beside conditions that hold', () => {
    const all = evaluateAllOf(
      [
        { key: 'amount', operator: 'greater-than', value: 10_000 },
        { key: 'absent', operator: 'equals', value: 'x' },
      ],
      context,
    );

    expect(all.ok).toBe(false);
  });

  /** No condition means the branch always runs, which is exactly what every 16A step was. */
  it('holds for an empty list', () => {
    expect(evaluateAllOf([], {})).toStrictEqual({ ok: true, value: true });
  });
});
