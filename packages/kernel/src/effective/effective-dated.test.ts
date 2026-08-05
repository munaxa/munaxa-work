import { describe, expect, it } from 'vitest';

import { DomainException } from '../errors/domain-exception.js';

import { Timeline } from './effective-dated.js';

const at = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe('Timeline', () => {
  const salary = Timeline.empty<number>()
    .change(5000, at('2024-01-01'))
    .change(6000, at('2025-01-01'))
    .change(7000, at('2026-01-01'));

  it('answers what applied on a date', () => {
    expect(salary.at(at('2024-06-01'))?.value).toBe(5000);
    expect(salary.at(at('2025-06-01'))?.value).toBe(6000);
    expect(salary.at(at('2026-06-01'))?.value).toBe(7000);
  });

  it('answers with nothing before the first period', () => {
    expect(salary.at(at('2023-12-31'))).toBeUndefined();
  });

  it('supersedes rather than rewrites, so a prior period stays answerable', () => {
    // The 2024 value is still there, closed, not edited away.
    expect(salary.all).toHaveLength(3);
    expect(salary.all[0]?.value).toBe(5000);
    expect(salary.all[0]?.effectiveTo).toEqual(at('2025-01-01'));
  });

  it('leaves exactly one period open', () => {
    expect(salary.all.filter((entry) => entry.effectiveTo === undefined)).toHaveLength(1);
  });

  it('accepts a back-dated correction and supersedes the period it lands in', () => {
    const corrected = salary.change(5500, at('2024-07-01'));

    expect(corrected.at(at('2024-06-01'))?.value).toBe(5000);
    expect(corrected.at(at('2024-08-01'))?.value).toBe(5500);
  });

  it('shows a scheduled future change before it takes effect', () => {
    const scheduled = salary.change(8000, at('2027-01-01'));

    expect(scheduled.at(at('2026-06-01'))?.value).toBe(7000);
    expect(scheduled.scheduledAfter(at('2026-06-01')).map((entry) => entry.value)).toEqual([8000]);
  });

  it('closes the open period, as a termination does', () => {
    const closed = salary.close(at('2026-09-01'));

    expect(closed.at(at('2026-10-01'))).toBeUndefined();
    expect(closed.at(at('2026-08-01'))?.value).toBe(7000);
  });

  it('refuses to hold two periods in force at once', () => {
    expect(() =>
      Timeline.from([
        { value: 1, effectiveFrom: at('2026-01-01'), version: 1 },
        { value: 2, effectiveFrom: at('2026-06-01'), version: 1 },
        { value: 3, effectiveFrom: at('2026-03-01'), effectiveTo: at('2026-09-01'), version: 1 },
      ]),
    ).toThrow(DomainException);
  });

  it('versions a period each time it is superseded', () => {
    expect(salary.all[0]?.version).toBe(2);
    expect(salary.all[2]?.version).toBe(1);
  });
});
