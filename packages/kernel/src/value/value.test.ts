import { describe, expect, it } from 'vitest';

import { DomainException } from '../errors/domain-exception.js';

import { isDeleted } from './audit.js';
import { DateRange } from './date-range.js';
import { LocalizedText } from './localized-text.js';
import { Quantity } from './quantity.js';

const at = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe('Quantity', () => {
  it('holds fractional leave balances exactly', () => {
    const balance = Quantity.parse('15.318', 3);

    expect(balance.toString()).toBe('15.318');
  });

  it('accumulates accruals without drift', () => {
    let balance = Quantity.zero(3);
    const monthly = Quantity.parse('2.083', 3);

    for (let month = 0; month < 12; month += 1) balance = balance.plus(monthly);

    expect(balance.toString()).toBe('24.996');
  });

  it('refuses to combine different scales rather than guessing', () => {
    expect(() => Quantity.parse('1.5', 1).plus(Quantity.parse('1.50', 2))).toThrow(DomainException);
  });

  it('supports a negative balance, which some policies permit', () => {
    expect(Quantity.parse('1.000', 3).minus(Quantity.parse('2.500', 3)).toString()).toBe('-1.500');
  });

  it('refuses more precision than its scale', () => {
    expect(() => Quantity.parse('1.5555', 3)).toThrow(DomainException);
  });
});

describe('DateRange', () => {
  it('is half open, so adjacent periods neither overlap nor gap', () => {
    const first = DateRange.of(at('2026-01-01'), at('2026-02-01'));
    const second = DateRange.of(at('2026-02-01'), at('2026-03-01'));

    expect(first.overlaps(second)).toBe(false);
    expect(first.isAdjacentTo(second)).toBe(true);
    expect(first.contains(at('2026-02-01'))).toBe(false);
    expect(second.contains(at('2026-02-01'))).toBe(true);
  });

  it('detects a genuine overlap', () => {
    const first = DateRange.of(at('2026-01-01'), at('2026-03-01'));
    const second = DateRange.of(at('2026-02-01'), at('2026-04-01'));

    expect(first.overlaps(second)).toBe(true);
  });

  it('treats an open range as extending forever', () => {
    const open = DateRange.startingAt(at('2026-01-01'));

    expect(open.contains(at('2099-01-01'))).toBe(true);
    expect(open.overlaps(DateRange.of(at('2030-01-01'), at('2031-01-01')))).toBe(true);
  });

  it('closes an open range, as an effective-dated change does to its predecessor', () => {
    const closed = DateRange.startingAt(at('2026-01-01')).closedAt(at('2026-06-01'));

    expect(closed.isOpenEnded()).toBe(false);
    expect(closed.contains(at('2026-06-01'))).toBe(false);
  });

  it('refuses a range that ends before it starts', () => {
    expect(() => DateRange.of(at('2026-02-01'), at('2026-01-01'))).toThrow(DomainException);
  });
});

describe('LocalizedText', () => {
  const both = LocalizedText.of({ en: 'Annual Leave', ar: 'إجازة سنوية' });

  it('returns the requested language', () => {
    expect(both.in('ar', 'en')).toBe('إجازة سنوية');
  });

  it('falls back rather than returning nothing', () => {
    expect(LocalizedText.of({ en: 'Annual Leave' }).in('ar', 'en')).toBe('Annual Leave');
  });

  it('reports which languages are missing, so publication can refuse', () => {
    const english = LocalizedText.of({ en: 'Annual Leave' });

    expect(english.isCompleteFor(['en', 'ar'])).toBe(false);
    expect(english.missingFrom(['en', 'ar'])).toEqual(['ar']);
    expect(both.isCompleteFor(['en', 'ar'])).toBe(true);
  });

  it('refuses to exist with no text at all', () => {
    expect(() => LocalizedText.of({ en: '   ' })).toThrow(DomainException);
  });
});

describe('audit', () => {
  const base = {
    createdAt: at('2026-01-01'),
    createdBy: 'user:a',
    updatedAt: at('2026-01-01'),
    updatedBy: 'user:a',
  };

  it('recognises a soft deleted record', () => {
    expect(isDeleted(base)).toBe(false);
    expect(isDeleted({ ...base, deletedAt: at('2026-02-01'), deletedBy: 'user:b' })).toBe(true);
  });
});
