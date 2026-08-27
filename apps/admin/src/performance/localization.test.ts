import { describe, expect, it } from 'vitest';
import performanceAr from '@work/performance/locales/ar.json';
import performanceEn from '@work/performance/locales/en.json';

import { nameIn, performanceTranslator, personIn } from './locale';

/**
 * The catalogue's shape, and the resolver that reads it.
 *
 * The Attendance slice found five keys stored **flat and containing dots** — the literal string
 * `"boundary.employment"` nested under `attendance.label`. The gate flattens a catalogue by
 * *joining* nested names with a dot, so it saw the key as present and passed; this resolver *splits*
 * the requested key on a dot and walks segment by segment, found no nested `boundary` object, and
 * returned the key. Five raw keys reached customers in both languages past a green gate.
 *
 * The gate now rejects any key whose own name contains a dot. These assertions are the second half:
 * they hold for Performance's catalogue specifically, so the defect cannot be reintroduced here by
 * somebody adding a key in the shape that used to pass.
 */

const paths = (value: unknown, prefix = ''): readonly string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, nested]) =>
        paths(nested, prefix ? `${prefix}.${key}` : key),
      )
    : [prefix];

const names = (value: unknown): readonly string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, nested]) => [key, ...names(nested)])
    : [];

describe('the performance catalogue', () => {
  it('holds no key whose own name contains a dot', () => {
    for (const catalogue of [performanceEn, performanceAr]) {
      const dotted = names(catalogue).filter((name) => name.includes('.'));

      expect(dotted).toEqual([]);
    }
  });

  it('holds exactly the same keys in both languages', () => {
    expect(paths(performanceEn)).toEqual(paths(performanceAr));
  });

  it('holds no empty string in either language', () => {
    for (const catalogue of [performanceEn, performanceAr]) {
      const flat = JSON.stringify(catalogue);

      expect(flat).not.toContain('""');
    }
  });

  it('resolves every key this slice added, in both languages', () => {
    const added = [
      'performance.label.openReview',
      'performance.label.backToPerformance',
      'performance.label.boundaries',
      'performance.label.participants',
      'performance.label.denominator',
      'performance.notice.scopedToCycle',
      'performance.notice.reviewNotReturned',
      'performance.notice.goalNotFound',
      'performance.notice.noProgress',
      'performance.withheld.reviews',
      'performance.withheld.goalRead',
      'performance.withheld.talent',
      'performance.vocabulary.inclusion.included',
      'performance.vocabulary.itemKind.goal',
      'performance.vocabulary.categoryStatus.active',
    ];

    for (const language of ['en', 'ar'] as const) {
      const t = performanceTranslator(language);

      for (const key of added) {
        expect([language, key, t(key)]).not.toEqual([language, key, key]);
      }
    }
  });

  it('falls through to the portal’s own catalogue for the frame', () => {
    const t = performanceTranslator('en');

    expect(t('admin.nav.performance')).not.toBe('admin.nav.performance');
  });

  it('returns the key itself for one nobody added, so a gap is visible rather than blank', () => {
    expect(performanceTranslator('en')('performance.label.nothingLikeThis')).toBe(
      'performance.label.nothingLikeThis',
    );
  });
});

describe('a bilingual value in the reader’s language', () => {
  it('prefers the reader’s language and falls back to the other', () => {
    expect(nameIn({ en: 'Annual', ar: 'سنوي' }, 'ar')).toBe('سنوي');
    expect(nameIn({ en: 'Annual', ar: '' }, 'ar')).toBe('Annual');
    expect(nameIn(undefined, 'en')).toBe('—');
  });

  /**
   * Employment publishes `personName` as an open map, not a closed `{ en, ar }`. Absent means the
   * caller may not read the person, which is a boundary rather than a person with no name.
   */
  it('narrows a person’s open name map without asserting a shape it does not have', () => {
    expect(personIn({ en: 'Layla Haddad', ar: 'ليلى حداد' }, 'ar')).toBe('ليلى حداد');
    expect(personIn({ en: 'Layla Haddad' }, 'ar')).toBe('Layla Haddad');
    expect(personIn({ fr: 'Layla Haddad' }, 'ar')).toBeUndefined();
    expect(personIn(undefined, 'en')).toBeUndefined();
  });
});
