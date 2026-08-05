import { describe, expect, it } from 'vitest';

import { DomainException } from '../errors/domain-exception.js';

import { formatServicePeriod, serviceBetween } from './service-period.js';

const at = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe('serviceBetween', () => {
  it('counts whole years, months and days', () => {
    const period = serviceBetween(at('2022-11-09'), at('2026-08-05'));

    // 2022-11-09 plus 44 whole months is 2026-07-09, and 2026-08-05 is 27 days after that.
    expect(period.years).toBe(3);
    expect(period.months).toBe(8);
    expect(period.days).toBe(27);
  });

  it('formats the way a service card reads', () => {
    expect(formatServicePeriod(serviceBetween(at('2022-11-09'), at('2026-08-05')))).toBe(
      '03y - 08m - 27d',
    );
  });

  it('borrows days from the preceding calendar month, not from an average month', () => {
    // 31 January to 1 March is one month and one day in 2025, because February has 28 days.
    const period = serviceBetween(at('2025-01-31'), at('2025-03-01'));

    expect(period.years).toBe(0);
    expect(period.months).toBe(1);
    expect(period.days).toBe(1);
  });

  it('handles a leap day start', () => {
    const period = serviceBetween(at('2024-02-29'), at('2025-02-28'));

    expect(period.years).toBe(0);
    expect(period.months).toBe(11);
    expect(period.days).toBe(30);
  });

  it('reports total elapsed days for per-day accrual', () => {
    expect(serviceBetween(at('2026-01-01'), at('2026-01-31')).totalDays).toBe(30);
  });

  it('is zero on the first day', () => {
    const period = serviceBetween(at('2026-08-05'), at('2026-08-05'));

    expect(period).toMatchObject({ years: 0, months: 0, days: 0, totalDays: 0 });
  });

  it('computes a longer service on the Hijri calendar, because its year is shorter', () => {
    const gregorian = serviceBetween(at('2000-01-01'), at('2026-01-01'), 'gregorian');
    const hijri = serviceBetween(at('2000-01-01'), at('2026-01-01'), 'hijri');

    expect(gregorian.years).toBe(26);
    expect(hijri.years).toBe(26 + 0);
    expect(hijri.years * 12 + hijri.months).toBeGreaterThan(
      gregorian.years * 12 + gregorian.months,
    );
    expect(hijri.calendar).toBe('hijri');
  });

  it('refuses a period that ends before it starts', () => {
    expect(() => serviceBetween(at('2026-08-05'), at('2026-08-04'))).toThrow(DomainException);
  });
});
