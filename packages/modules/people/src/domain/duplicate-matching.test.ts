import { describe, expect, it } from 'vitest';

import { matchAgainst, normalizeName, type MatchSubject } from './duplicate-matching.js';

/**
 * The matcher, tested in **Arabic first**.
 *
 * A duplicate-detection suite written in English would pass for an implementation that never
 * normalizes Arabic at all — and this product's first markets are exactly where the two
 * duplicate-producing spellings of one name come from.
 */

const subject = (over: Partial<MatchSubject> = {}): MatchSubject => ({
  identifierKeys: [],
  contactValues: [],
  names: [],
  ...over,
});

const A = '01920000-0000-7000-8000-0000000000a1';

describe('normalizing a name', () => {
  it('treats the alef forms as one letter, because they are one keyboard away from each other', () => {
    expect(normalizeName('أحمد')).toBe(normalizeName('احمد'));
    expect(normalizeName('إبراهيم')).toBe(normalizeName('ابراهيم'));
  });

  it('strips the diacritics a keyboard may or may not produce', () => {
    expect(normalizeName('مُحَمَّد')).toBe(normalizeName('محمد'));
  });

  it('treats the two final yaa forms and the taa marbuta as one letter each', () => {
    expect(normalizeName('مصطفى')).toBe(normalizeName('مصطفي'));
    expect(normalizeName('فاطمة')).toBe(normalizeName('فاطمه'));
  });

  it('collapses case, punctuation and runs of whitespace in Latin script', () => {
    expect(normalizeName('  Sara   AL-AMRI ')).toBe('sara al amri');
  });

  it('does not collapse two genuinely different names', () => {
    expect(normalizeName('سارة العامري')).not.toBe(normalizeName('سارة العمري'));
  });
});

describe('matching two records', () => {
  it('is strongest on a government identifier, which an authority made unique', () => {
    const match = matchAgainst(
      subject({ identifierKeys: ['digest:national-id:1234567890'] }),
      subject({ personId: A, identifierKeys: ['digest:national-id:1234567890'] }),
    );

    expect(match).toMatchObject({ personId: A, reason: 'government-identifier', confidence: 95 });
  });

  it('falls to a contact value when the identifiers do not meet', () => {
    const match = matchAgainst(
      subject({ contactValues: ['+966501234567'] }),
      subject({ personId: A, contactValues: ['+966501234567'] }),
    );

    expect(match?.reason).toBe('contact-value');
  });

  it('is weakest on a name with a date of birth, and never certain enough to act on alone', () => {
    const match = matchAgainst(
      subject({ names: ['أحمد الغامدي'], dateOfBirth: '1990-03-14' }),
      subject({ personId: A, names: ['احمد الغامدي'], dateOfBirth: '1990-03-14' }),
    );

    expect(match).toMatchObject({ reason: 'name-and-date-of-birth', confidence: 45 });
  });

  it('reports one reason per person, the strongest, rather than the same pair four times', () => {
    const match = matchAgainst(
      subject({
        identifierKeys: ['k'],
        contactValues: ['+966501234567'],
        names: ['أحمد'],
        dateOfBirth: '1990-03-14',
      }),
      subject({
        personId: A,
        identifierKeys: ['k'],
        contactValues: ['+966501234567'],
        names: ['احمد'],
        dateOfBirth: '1990-03-14',
      }),
    );

    expect(match?.reason).toBe('government-identifier');
  });

  it('does not match a shared name when only one side has a date of birth', () => {
    expect(
      matchAgainst(
        subject({ names: ['أحمد الغامدي'] }),
        subject({ personId: A, names: ['أحمد الغامدي'], dateOfBirth: '1990-03-14' }),
      ),
    ).toBeUndefined();
  });

  it('does not match two people who share a name and were born on different days', () => {
    expect(
      matchAgainst(
        subject({ names: ['أحمد الغامدي'], dateOfBirth: '1990-03-14' }),
        subject({ personId: A, names: ['أحمد الغامدي'], dateOfBirth: '1991-03-14' }),
      ),
    ).toBeUndefined();
  });

  it('never matches a person against themselves', () => {
    expect(
      matchAgainst(
        subject({ personId: A, identifierKeys: ['k'] }),
        subject({ personId: A, identifierKeys: ['k'] }),
      ),
    ).toBeUndefined();
  });

  it('ignores an empty value on either side, so two people with no identifier do not match', () => {
    expect(
      matchAgainst(
        subject({ identifierKeys: [''], contactValues: [''] }),
        subject({ personId: A, identifierKeys: [''], contactValues: [''] }),
      ),
    ).toBeUndefined();
  });
});
