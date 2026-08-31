import { describe, expect, it } from 'vitest';
import assetsAr from '@work/assets/locales/ar.json';
import assetsEn from '@work/assets/locales/en.json';

import { assetsTranslator, nameIn } from './locale';

/**
 * The catalogue's shape, and the resolver that reads it.
 *
 * The Attendance slice found five keys stored **flat and containing dots** — the literal string
 * `"boundary.employment"` nested under `attendance.label`. The gate flattens a catalogue by
 * *joining* nested names with a dot, so it saw the key as present and passed; this resolver
 * *splits* the requested key on a dot and walks segment by segment, found no nested `boundary`
 * object, and returned the key. Five raw keys reached customers in both languages past a green
 * gate.
 *
 * The gate now rejects any key whose own name contains a dot. These assertions are the second half:
 * they hold for Assets' catalogue specifically, so the defect cannot be reintroduced here by
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

describe('the assets catalogue', () => {
  it('holds no key whose own name contains a dot', () => {
    for (const catalogue of [assetsEn, assetsAr]) {
      expect(names(catalogue).filter((name) => name.includes('.'))).toEqual([]);
    }
  });

  it('holds exactly the same keys in both languages', () => {
    expect(paths(assetsEn)).toEqual(paths(assetsAr));
  });

  it('holds no empty string in either language', () => {
    for (const catalogue of [assetsEn, assetsAr]) {
      expect(JSON.stringify(catalogue)).not.toContain('""');
    }
  });
});

describe('the resolver', () => {
  /**
   * Every key these screens ask for, asserted to resolve in both languages.
   *
   * A missing key renders as itself — `assets.label.custody` on the page — which is unmistakable
   * once somebody looks, and invisible until they do. This is the list that makes "somebody looked"
   * a property of the build.
   */
  const KEYS = [
    'assets.label.inventory',
    'assets.label.registered',
    'assets.label.catalogue',
    'assets.label.category',
    'assets.label.asset',
    'assets.label.assetTag',
    'assets.label.serialNumber',
    'assets.label.description',
    'assets.label.locationNote',
    'assets.label.purchaseReference',
    'assets.label.status',
    'assets.label.custody',
    'assets.label.custodyHistory',
    'assets.label.currentHolder',
    'assets.label.employment',
    'assets.label.issuedOn',
    'assets.label.returnedOn',
    'assets.label.issueNote',
    'assets.label.returnNote',
    'assets.label.custodyState',
    'assets.label.daysOutstanding',
    'assets.label.daysHeld',
    'assets.label.outstanding',
    'assets.label.openCount',
    'assets.label.oldestIssuedOn',
    'assets.label.longestDaysOutstanding',
    'assets.label.asAt',
    'assets.label.code',
    'assets.label.name',
    'assets.label.sequence',
    'assets.label.active',
    'assets.label.boundaries',
    'assets.label.backToAssets',
    'assets.label.nothingReadable',
    'assets.empty.inventory',
    'assets.empty.catalogue',
    'assets.empty.custody',
    'assets.empty.noHolder',
    'assets.empty.nothingOut',
    'assets.withheld.assetRead',
    'assets.withheld.categoryRead',
    'assets.withheld.custodyRead',
    'assets.withheld.assetNotFound',
    'assets.active.yes',
    'assets.active.no',
    'assets.status.registered',
    'assets.status.available',
    'assets.status.under_repair',
    'assets.status.retired',
    'assets.custodyState.open',
    'assets.custodyState.returned',
    'assets.note.statusIsService',
    'assets.note.noValuation',
    'assets.note.employmentNotPerson',
    'assets.note.catalogueIsTenant',
    'assets.note.tagIsIdentity',
    'assets.note.oneHolder',
    'assets.note.noTransfer',
    'assets.note.noAcknowledgement',
    // Resolved from the portal's own catalogue rather than the module's.
    'admin.notice.sectionWithheld',
    'admin.notice.eachSectionIsItsOwnPermission',
  ] as const;

  it('resolves every key these screens ask for, in both languages', () => {
    for (const language of ['en', 'ar'] as const) {
      const t = assetsTranslator(language);
      const raw = KEYS.filter((key) => t(key) === key);

      expect(raw).toEqual([]);
    }
  });

  it('returns the key itself when there is none, so a gap is visible rather than blank', () => {
    expect(assetsTranslator('en')('assets.label.thereIsNoSuchKey')).toBe(
      'assets.label.thereIsNoSuchKey',
    );
  });

  it('reads a bilingual name in the language being read', () => {
    const name = { en: 'Laptop', ar: 'حاسوب محمول' };

    expect(nameIn(name, 'en')).toBe('Laptop');
    expect(nameIn(name, 'ar')).toBe('حاسوب محمول');
    expect(nameIn(undefined, 'ar')).toBeUndefined();
  });
});
