import { describe, expect, it } from 'vitest';

import { Translator, directionOf } from './catalogue.js';

const catalogues = new Map([
  [
    'en',
    {
      'leave.approved': 'Your leave request was approved.',
      'leave.balance': 'You have {days} days remaining.',
      'leave.rejected': 'Your leave request was rejected.',
    },
  ],
  [
    'ar',
    {
      'leave.approved': 'تمت الموافقة على طلب الإجازة.',
      'leave.balance': 'لديك {days} يوماً متبقياً.',
    },
  ],
]);

describe('Translator', () => {
  const translator = new Translator(catalogues, 'en');

  it('translates into the requested language', () => {
    expect(translator.translate('leave.approved', 'ar')).toBe('تمت الموافقة على طلب الإجازة.');
  });

  it('interpolates variables in either language', () => {
    expect(translator.translate('leave.balance', 'en', { days: 15 })).toBe(
      'You have 15 days remaining.',
    );
    expect(translator.translate('leave.balance', 'ar', { days: 15 })).toContain('15');
  });

  it('falls back rather than showing nothing', () => {
    expect(translator.translate('leave.rejected', 'ar')).toBe('Your leave request was rejected.');
  });

  it('returns the key for an unknown string, so the gap is visible rather than blank', () => {
    expect(translator.translate('nothing.here', 'en')).toBe('nothing.here');
  });

  it('reports missing keys so CI can fail on an incomplete language', () => {
    expect(translator.missingKeys('ar')).toEqual(['leave.rejected']);
    expect(translator.missingKeys('en')).toEqual([]);
  });

  it('leaves an unsupplied variable visible instead of printing undefined', () => {
    expect(translator.translate('leave.balance', 'en')).toBe('You have {days} days remaining.');
  });
});

describe('directionOf', () => {
  it('follows the language', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('ar-SA')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('en-GB')).toBe('ltr');
  });
});
