import { describe, expect, it } from 'vitest';

import { escalationContext, occurrenceOf, windowStart } from './escalation.js';
import type { ViolationRecord } from './violation.js';

/**
 * The window arithmetic, asserted at every boundary rather than sampled near the middle.
 *
 * A repeat count is the input to a disciplinary decision, so an off-by-one here is an off-by-one in
 * somebody's disciplinary record. The boundary cases below are the ones a person would dispute.
 */

const EMPLOYMENT = '01940000-0000-7000-8000-0000000000e1';
const OTHER_EMPLOYMENT = '01940000-0000-7000-8000-0000000000e2';
const CATEGORY = '01940000-0000-7000-8000-0000000000c1';
const OTHER_CATEGORY = '01940000-0000-7000-8000-0000000000c2';

const violation = (
  id: string,
  occurredOn: string,
  overrides: Partial<ViolationRecord> = {},
): ViolationRecord => ({
  violationId: id,
  employmentId: EMPLOYMENT,
  violationCategoryId: CATEGORY,
  categoryCode: 'unauthorized-absence',
  severity: 'major',
  occurredOn,
  reportedBy: 'user:officer',
  description: 'Absent without notice.',
  state: 'reported',
  recordedAt: new Date('2026-08-23T09:00:00Z'),
  version: 1,
  ...overrides,
});

const contextOf = (violations: readonly ViolationRecord[], windowDays: number, asAt: string) =>
  escalationContext({
    employmentId: EMPLOYMENT,
    violationCategoryId: CATEGORY,
    windowDays,
    asAt,
    violations,
  });

describe('the window', () => {
  it('is closed at both ends and spans exactly the configured days', () => {
    // 180 days back from 2026-08-23 is 2026-02-24, and that day is *inside* the window.
    expect(windowStart('2026-08-23', 180)).toBe('2026-02-24');
    expect(windowStart('2026-08-23', 0)).toBe('2026-08-23');
    expect(windowStart('2026-08-23', 1)).toBe('2026-08-22');
  });

  /**
   * Crossing a daylight-saving boundary must not move the window by an hour and therefore a day.
   * The arithmetic is UTC on a date-only value, so a European spring-forward has no effect.
   */
  it('does not drift across a daylight-saving boundary', () => {
    // 2026-03-29 is the European clock change; 30 days back must be exactly 2026-02-27.
    expect(windowStart('2026-03-29', 30)).toBe('2026-02-27');
    // …and across a leap-year February.
    expect(windowStart('2028-03-01', 1)).toBe('2028-02-29');
  });
});

describe('counting occurrences', () => {
  it('counts none when there are none', () => {
    const context = contextOf([], 180, '2026-08-23');

    expect(context.occurrences).toBe(0);
    expect(context.violationIds).toStrictEqual([]);
    expect(context.windowFrom).toBe('2026-02-24');
    expect(context.windowDays).toBe(180);
  });

  it('counts one, and counts many', () => {
    expect(contextOf([violation('a', '2026-08-01')], 180, '2026-08-23').occurrences).toBe(1);
    expect(
      contextOf(
        [violation('a', '2026-08-01'), violation('b', '2026-07-01'), violation('c', '2026-06-01')],
        180,
        '2026-08-23',
      ).occurrences,
    ).toBe(3);
  });

  /** The assertion a dispute turns on: the first day of the window counts, the day before does not. */
  it('includes the exact first day of the window and excludes the day before it', () => {
    const onBoundary = violation('on', '2026-02-24');
    const dayBefore = violation('before', '2026-02-23');
    const context = contextOf([onBoundary, dayBefore], 180, '2026-08-23');

    expect(context.violationIds).toStrictEqual(['on']);
  });

  it('includes a violation on the reference date itself', () => {
    expect(contextOf([violation('today', '2026-08-23')], 180, '2026-08-23').occurrences).toBe(1);
  });

  it('excludes a violation after the reference date', () => {
    expect(contextOf([violation('later', '2026-08-24')], 180, '2026-08-23').occurrences).toBe(0);
  });

  /** A zero window is the reference day alone — not "no window", and not "every violation ever". */
  it('treats a zero-day window as the reference date alone', () => {
    const context = contextOf(
      [violation('today', '2026-08-23'), violation('yesterday', '2026-08-22')],
      0,
      '2026-08-23',
    );

    expect(context.violationIds).toStrictEqual(['today']);
  });

  it('counts same-day violations separately, ordered by identifier', () => {
    const context = contextOf(
      [violation('b2', '2026-08-01'), violation('a1', '2026-08-01')],
      180,
      '2026-08-23',
    );

    expect(context.occurrences).toBe(2);
    // Deterministic: the ordinal of a same-day pair never depends on which arrived first.
    expect(context.violationIds).toStrictEqual(['a1', 'b2']);
  });

  it('orders oldest first regardless of the order supplied', () => {
    const newest = violation('n', '2026-08-01');
    const oldest = violation('o', '2026-03-01');

    expect(contextOf([newest, oldest], 180, '2026-08-23').violationIds).toStrictEqual(['o', 'n']);
    expect(contextOf([oldest, newest], 180, '2026-08-23').violationIds).toStrictEqual(['o', 'n']);
  });

  it('counts only this category and only this employment', () => {
    const context = contextOf(
      [
        violation('mine', '2026-08-01'),
        violation('other-category', '2026-08-02', { violationCategoryId: OTHER_CATEGORY }),
        violation('other-employment', '2026-08-03', { employmentId: OTHER_EMPLOYMENT }),
      ],
      180,
      '2026-08-23',
    );

    expect(context.violationIds).toStrictEqual(['mine']);
  });

  it('publishes the window it applied, so the answer is checkable', () => {
    const context = contextOf([], 90, '2026-08-23');

    expect(context).toMatchObject({
      employmentId: EMPLOYMENT,
      violationCategoryId: CATEGORY,
      asAt: '2026-08-23',
      windowDays: 90,
      windowFrom: '2026-05-25',
    });
  });

  /** No conclusion is drawn anywhere in the result — D-5.2-20 is still open. */
  it('reports a count and nothing that resembles a decision', () => {
    const context = contextOf([violation('a', '2026-08-01')], 180, '2026-08-23');

    for (const forbidden of ['isRepeat', 'escalationLevel', 'breached', 'action', 'penalty']) {
      expect(Object.keys(context)).not.toContain(forbidden);
    }
  });
});

describe('the ordinal of one violation', () => {
  const first = violation('first', '2026-01-10');
  const second = violation('second', '2026-03-10');
  const third = violation('third', '2026-06-10');
  const all = [first, second, third];

  it('numbers occurrences from one', () => {
    expect(occurrenceOf(first, 180, all)).toBe(1);
    expect(occurrenceOf(second, 180, all)).toBe(2);
    expect(occurrenceOf(third, 180, all)).toBe(3);
  });

  /**
   * The ordinal is measured from the violation's own date, so it does not change as time passes.
   * Counting back from today instead would silently renumber history every night.
   */
  it('does not change meaning as the reference date moves', () => {
    expect(occurrenceOf(second, 180, all)).toBe(2);
    // A fourth violation years later changes nothing about the second's ordinal.
    expect(occurrenceOf(second, 180, [...all, violation('fourth', '2030-01-01')])).toBe(2);
  });

  it("excludes earlier violations that fall outside this one's own window", () => {
    // 30-day window: only `third` itself is inside its own window.
    expect(occurrenceOf(third, 30, all)).toBe(1);
  });

  it('refuses to number a violation it was not given', () => {
    expect(occurrenceOf(violation('absent', '2026-06-10'), 180, all)).toBeUndefined();
  });
});
