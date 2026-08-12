import { describe, expect, it } from 'vitest';

import {
  currentOccurrenceKey,
  defineRule,
  occurrenceDueOn,
  retireRule,
  type MandatoryRuleState,
} from './mandatory-rule.js';

/**
 * Recurrence without a scheduler (ADR-0071, approved as D-10).
 *
 * Nothing in this repository can make anything happen on a Tuesday — `JobPort` has no adapter. So a
 * recurring requirement is a **computation**, and these are the cases that decide whether it is a
 * correct one: the same day computes the same key twice, an elapsed interval computes the next one,
 * and a key survives the month-length clamp that would otherwise drift a February anniversary.
 *
 * The key is what a partial unique index is built on, so "computes the same string twice" is not a
 * cosmetic property — it is the whole of the idempotency guarantee.
 */

const NAME = { en: 'Fire safety', ar: 'السلامة من الحرائق' };
const AT = new Date('2026-03-01T09:00:00.000Z');

const rule = (over: Partial<Parameters<typeof defineRule>[0]> = {}): MandatoryRuleState => {
  const result = defineRule({
    mandatoryRuleId: 'rule-1',
    courseId: 'course-1',
    name: NAME,
    kind: 'safety',
    audience: 'everybody',
    effectiveFrom: '2024-01-01',
    recurrenceMonths: 12,
    dueWithinDays: 30,
    ...over,
  });

  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};

const refuses = (over: Partial<Parameters<typeof defineRule>[0]>): boolean =>
  !defineRule({
    mandatoryRuleId: 'rule-2',
    courseId: 'course-1',
    name: NAME,
    kind: 'compliance',
    audience: 'everybody',
    effectiveFrom: '2024-01-01',
    recurrenceMonths: 12,
    dueWithinDays: 30,
    ...over,
  }).ok;

describe('defining a mandatory rule', () => {
  it('refuses an audience that names nobody it claims to name', () => {
    expect(refuses({ audience: 'organization_unit' })).toBe(true);
    expect(refuses({ audience: 'position' })).toBe(true);
    expect(refuses({ audience: 'position', positionId: 'position-1' })).toBe(false);
  });

  it('refuses a recurrence that is not a whole number of months in a plausible range', () => {
    expect(refuses({ recurrenceMonths: 1.5 })).toBe(true);
    expect(refuses({ recurrenceMonths: -1 })).toBe(true);
    expect(refuses({ recurrenceMonths: 9000 })).toBe(true);
    expect(refuses({ dueWithinDays: -1 })).toBe(true);
    expect(refuses({ effectiveFrom: '01-01-2024' })).toBe(true);
  });

  it('retires rather than deletes, and leaves what it already asked of people alone', () => {
    const retired = retireRule(rule(), AT, 'user-admin');

    expect(retired.ok).toBe(true);
    if (!retired.ok) return;
    expect(retired.value.active).toBe(false);
    expect(retireRule(retired.value, AT, 'user-admin').ok).toBe(false);
  });
});

describe('the occurrence a person is currently in', () => {
  it('is nothing at all before the rule takes effect', () => {
    expect(currentOccurrenceKey(rule(), undefined, '2023-12-31')).toBeUndefined();
  });

  it('is the rule anchor for somebody who has never done it, however long ago that was', () => {
    expect(currentOccurrenceKey(rule(), undefined, '2026-03-01')).toBe('2024-01-01');
  });

  it('is nothing while a completion is still inside its interval', () => {
    expect(currentOccurrenceKey(rule(), '2026-01-15', '2026-03-01')).toBeUndefined();
    expect(currentOccurrenceKey(rule(), '2025-03-02', '2026-03-01')).toBeUndefined();
  });

  it('opens the day the interval elapses, and not the day before', () => {
    expect(currentOccurrenceKey(rule(), '2025-03-01', '2026-02-28')).toBeUndefined();
    expect(currentOccurrenceKey(rule(), '2025-03-01', '2026-03-01')).toBe('2026-03-01');
  });

  it('computes the same key twice on the same day — the whole of the idempotency guarantee', () => {
    const first = currentOccurrenceKey(rule(), '2025-03-01', '2026-06-14');
    const second = currentOccurrenceKey(rule(), '2025-03-01', '2026-06-14');

    expect(first).toBe(second);
    expect(first).toBe('2026-03-01');
  });

  it('moves to the next key once another interval elapses, with no counter kept anywhere', () => {
    expect(currentOccurrenceKey(rule(), '2020-05-10', '2026-03-01')).toBe('2025-05-10');
    expect(currentOccurrenceKey(rule(), '2020-05-10', '2026-05-10')).toBe('2026-05-10');
  });

  it('holds the anniversary steady across the month-length clamp', () => {
    const twoYearly = rule({ recurrenceMonths: 24 });

    expect(currentOccurrenceKey(twoYearly, '2024-02-29', '2026-03-01')).toBe('2026-02-28');
    expect(currentOccurrenceKey(twoYearly, '2024-02-29', '2026-02-27')).toBeUndefined();
  });

  it('treats a rule that never repeats as satisfied forever by one completion', () => {
    const once = rule({ recurrenceMonths: 0 });

    expect(currentOccurrenceKey(once, undefined, '2026-03-01')).toBe('2024-01-01');
    expect(currentOccurrenceKey(once, '2024-02-01', '2099-01-01')).toBeUndefined();
  });

  it('handles a short interval over a long gap without drifting', () => {
    const quarterly = rule({ recurrenceMonths: 3 });

    expect(currentOccurrenceKey(quarterly, '2024-01-31', '2026-03-01')).toBe('2026-01-31');
    expect(currentOccurrenceKey(quarterly, '2024-01-31', '2026-05-01')).toBe('2026-04-30');
  });
});

describe('when an occurrence is due', () => {
  it('is the occurrence start plus the tenant’s own window, as a civil date', () => {
    expect(occurrenceDueOn(rule(), '2026-03-01')).toBe('2026-03-31');
    expect(occurrenceDueOn(rule({ dueWithinDays: 0 }), '2026-03-01')).toBe('2026-03-01');
  });
});
