import { describe, expect, it } from 'vitest';

import ar from '../../locales/ar.json' with { type: 'json' };
import en from '../../locales/en.json' with { type: 'json' };
import {
  CAREER_PATH_KINDS,
  CAREER_PATH_STATUSES,
  CAREER_PLAN_STATUSES,
  DEVELOPMENT_CATEGORIES,
  DEVELOPMENT_ITEM_KINDS,
  DEVELOPMENT_ITEM_STATUSES,
  DEVELOPMENT_PLAN_STATUSES,
  MOBILITY_KINDS,
  MOBILITY_STATUSES,
  SUCCESSION_PLAN_STATUSES,
  SUCCESSOR_STATUSES,
  TALENT_POOL_KINDS,
  TALENT_POOL_STATUSES,
} from './career-vocabulary.js';

/**
 * Every word this module owns is translated, in both languages.
 *
 * `check-localization.mjs` proves the two catalogues carry the *same* keys. It cannot prove they
 * carry *enough* — a vocabulary value added without a catalogue entry passes that gate and reaches a
 * screen as a raw enum. This closes the other half: every member of every closed vocabulary has a
 * label, and every label belongs to a member.
 */

const catalogue = (source: unknown, group: string): Readonly<Record<string, string>> => {
  const vocabularies = (
    source as { career: { vocabulary: Record<string, Record<string, string>> } }
  ).career.vocabulary;

  return vocabularies[group] ?? {};
};

const VOCABULARIES: readonly [string, readonly string[]][] = [
  ['careerPathKind', CAREER_PATH_KINDS],
  ['careerPathStatus', CAREER_PATH_STATUSES],
  ['careerPlanStatus', CAREER_PLAN_STATUSES],
  ['talentPoolKind', TALENT_POOL_KINDS],
  ['talentPoolStatus', TALENT_POOL_STATUSES],
  ['successionPlanStatus', SUCCESSION_PLAN_STATUSES],
  ['successorStatus', SUCCESSOR_STATUSES],
  ['developmentCategory', DEVELOPMENT_CATEGORIES],
  ['developmentItemKind', DEVELOPMENT_ITEM_KINDS],
  ['developmentPlanStatus', DEVELOPMENT_PLAN_STATUSES],
  ['developmentItemStatus', DEVELOPMENT_ITEM_STATUSES],
  ['mobilityKind', MOBILITY_KINDS],
  ['mobilityStatus', MOBILITY_STATUSES],
];

describe('the catalogues cover the vocabulary', () => {
  it('translates every member of every closed vocabulary, in both languages', () => {
    for (const [group, members] of VOCABULARIES) {
      for (const language of [en, ar]) {
        const labels = catalogue(language, group);

        expect([group, [...members].sort()]).toEqual([group, Object.keys(labels).sort()]);
        for (const member of members) {
          expect([group, member, (labels[member] ?? '').length > 0]).toEqual([group, member, true]);
        }
      }
    }
  });

  it('translates the derived mobility standing, which no row ever stores', () => {
    // `expired` is computed on read and never written (D-13). A screen still has to render the
    // word, so the catalogue carries it even though no column ever holds it.
    expect(catalogue(en, 'mobilityStatus')['expired']).toBeDefined();
    expect(catalogue(ar, 'mobilityStatus')['expired']).toBeDefined();
  });

  it('says "agreed" rather than "accepted" for a decided recommendation', () => {
    // A deliberate wording choice, not an oversight. `accepted` in the data means a human agreed
    // with a suggestion and nothing happened (ADR-0072); an English screen reading "Accepted" beside
    // a promotion recommendation invites the reader to think a promotion was actioned.
    expect(catalogue(en, 'mobilityStatus')['accepted']).toBe('Agreed');
  });
});
