import { describe, expect, it } from 'vitest';
import relationsAr from '@work/relations/locales/ar.json';
import relationsEn from '@work/relations/locales/en.json';

import { categoryNamed, nameIn, relationsTranslator } from './locale';
import { CATEGORY_LATENESS, aCatalogue } from './relations.fixture';

/**
 * The catalogue's shape, and the resolver that reads it.
 *
 * The Attendance slice found five keys stored **flat and containing dots** — the literal string
 * `"boundary.employment"` nested under a label group. The gate flattens a catalogue by *joining*
 * nested names with a dot, so it saw the key as present and passed; the resolver *splits* the
 * requested key on a dot, found no nested object, and returned the key — so five raw keys reached
 * customers past a green gate. These assertions hold the line for Relations' catalogue
 * specifically.
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

describe('the relations catalogue', () => {
  it('holds no key whose own name contains a dot', () => {
    for (const catalogue of [relationsEn, relationsAr]) {
      expect(names(catalogue).filter((name) => name.includes('.'))).toEqual([]);
    }
  });

  it('holds exactly the same keys in both languages', () => {
    expect(paths(relationsEn)).toEqual(paths(relationsAr));
  });

  it('holds no empty string in either language', () => {
    for (const catalogue of [relationsEn, relationsAr]) {
      expect(JSON.stringify(catalogue)).not.toContain('""');
    }
  });
});

describe('the resolver', () => {
  /**
   * Every key these screens ask for, asserted to resolve in both languages.
   *
   * A missing key renders as itself — `relations.label.violations` on the page — which is
   * unmistakable once somebody looks, and invisible until they do. This is the list that makes
   * "somebody looked" a property of the build.
   */
  const KEYS = [
    'relations.label.register',
    'relations.label.violation',
    'relations.label.violations',
    'relations.label.category',
    'relations.label.severity',
    'relations.label.state',
    'relations.label.occurredOn',
    'relations.label.recordedOn',
    'relations.label.occurrence',
    'relations.label.occurrences',
    'relations.label.description',
    'relations.label.employment',
    'relations.label.caseHistory',
    'relations.label.sequence',
    'relations.label.from',
    'relations.label.to',
    'relations.label.reason',
    'relations.label.actor',
    'relations.label.occurredAt',
    'relations.label.investigations',
    'relations.label.investigator',
    'relations.label.openedOn',
    'relations.label.concludedOn',
    'relations.label.subject',
    'relations.label.findings',
    'relations.label.recommendation',
    'relations.label.corrects',
    'relations.label.escalationContext',
    'relations.label.repeatWindowDays',
    'relations.label.windowFrom',
    'relations.label.asAt',
    'relations.label.applicableAction',
    'relations.label.action',
    'relations.label.minOccurrence',
    'relations.label.disciplinaryAction',
    'relations.label.issuedOn',
    'relations.label.issuedBy',
    'relations.label.occurrenceAtIssue',
    'relations.label.prescribedByRule',
    'relations.label.boundaries',
    'relations.label.backToRecord',
    'relations.label.backToRelations',
    'relations.label.openRelations',
    'relations.label.nothingReadable',
    'relations.empty.violations',
    'relations.empty.investigations',
    'relations.empty.history',
    'relations.empty.action',
    'relations.withheld.violationRead',
    'relations.withheld.caseNotFound',
    'relations.state.reported',
    'relations.state.under_investigation',
    'relations.state.findings',
    'relations.state.action_issued',
    'relations.investigationState.open',
    'relations.investigationState.concluded',
    'relations.actionType.verbal_warning',
    'relations.actionType.written_warning',
    'relations.actionType.final_warning',
    'relations.actionType.suspension_recommendation',
    'relations.actionType.termination_recommendation',
    'relations.prescribedByRule.yes',
    'relations.prescribedByRule.no',
    'relations.notice.audited',
    'relations.notice.immutable',
    'relations.notice.noLegalCheck',
    'relations.notice.derivedState',
    'relations.notice.occurrenceDerived',
    'relations.notice.findingsRestricted',
    'relations.notice.actionNotExecuted',
    'relations.notice.recommendationIsText',
    'relations.notice.noRuleNoAction',
    'relations.notice.ladderPrescribesOnly',
    'relations.notice.windowIsConfiguration',
    // Resolved from the portal's own catalogue rather than the module's.
    'admin.notice.sectionWithheld',
    'admin.record.notFound',
    'admin.record.backToDirectory',
  ] as const;

  it('resolves every key these screens ask for, in both languages', () => {
    for (const language of ['en', 'ar'] as const) {
      const t = relationsTranslator(language);
      const raw = KEYS.filter((key) => t(key) === key);

      expect(raw).toEqual([]);
    }
  });

  it('returns the key itself when there is none, so a gap is visible rather than blank', () => {
    expect(relationsTranslator('en')('relations.label.thereIsNoSuchKey')).toBe(
      'relations.label.thereIsNoSuchKey',
    );
  });

  it('reads a bilingual name in the language being read', () => {
    const name = { en: 'Repeated lateness', ar: 'التأخر المتكرر' };

    expect(nameIn(name, 'en')).toBe('Repeated lateness');
    expect(nameIn(name, 'ar')).toBe('التأخر المتكرر');
    expect(nameIn(undefined, 'ar')).toBeUndefined();
  });

  it('finds a category name by identifier, and admits when the catalogue cannot answer', () => {
    expect(categoryNamed(aCatalogue(), CATEGORY_LATENESS, 'ar')).toBe('التأخر المتكرر');
    expect(categoryNamed(undefined, CATEGORY_LATENESS, 'en')).toBeUndefined();
    expect(categoryNamed(aCatalogue(), 'no-such-category', 'en')).toBeUndefined();
  });
});
