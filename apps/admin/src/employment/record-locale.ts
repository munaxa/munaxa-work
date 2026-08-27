import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import assetsAr from '@work/assets/locales/ar.json';
import assetsEn from '@work/assets/locales/en.json';
import attendanceAr from '@work/attendance/locales/ar.json';
import attendanceEn from '@work/attendance/locales/en.json';
import careerAr from '@work/career/locales/ar.json';
import careerEn from '@work/career/locales/en.json';
import documentsAr from '@work/documents/locales/ar.json';
import documentsEn from '@work/documents/locales/en.json';
import employmentAr from '@work/employment/locales/ar.json';
import employmentEn from '@work/employment/locales/en.json';
import learningAr from '@work/learning/locales/ar.json';
import learningEn from '@work/learning/locales/en.json';
import leaveAr from '@work/leave/locales/ar.json';
import leaveEn from '@work/leave/locales/en.json';
import lettersAr from '@work/letters/locales/ar.json';
import lettersEn from '@work/letters/locales/en.json';
import peopleAr from '@work/people/locales/ar.json';
import peopleEn from '@work/people/locales/en.json';
import relationsAr from '@work/relations/locales/ar.json';
import relationsEn from '@work/relations/locales/en.json';

import type { Language, Translate } from '../shell/locale';

/**
 * The employee record's text: every module's own catalogue, and the portal's own for the frame.
 *
 * A record spanning eleven modules needs eleven vocabularies, and taking them from the modules is
 * the only version of this that stays correct. Every key is already namespaced by its owner —
 * `leave.label.available`, `assets.label.custody`, `relations.label.violations` — so merging the
 * catalogues cannot collide, and the merge is shallow for the same reason: one top-level key per
 * module, and this file adds none of its own.
 *
 * What a *screen* is called, on the other hand, belongs to no module — "Employee record", "Identity",
 * "What this record does not show" — and those come from the portal's catalogue under `admin.`.
 *
 * A tenant's own value is still never translated here. An employment type, a contract type, a
 * document title, a violation's severity and a letter's reference are the customer's words or the
 * country pack's, and looking one up in a list this product ships would be inventing a meaning the
 * domain refuses to hold.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [
    adminEn,
    assetsEn,
    attendanceEn,
    careerEn,
    documentsEn,
    employmentEn,
    learningEn,
    leaveEn,
    lettersEn,
    peopleEn,
    relationsEn,
  ],
  ar: [
    adminAr,
    assetsAr,
    attendanceAr,
    careerAr,
    documentsAr,
    employmentAr,
    learningAr,
    leaveAr,
    lettersAr,
    peopleAr,
    relationsAr,
  ],
};

const lookup = (catalogue: unknown, path: readonly string[]): string | undefined => {
  let value: unknown = catalogue;

  for (const segment of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value : undefined;
};

/**
 * Looks a key up across the merged catalogues, returning the key itself if no catalogue has it.
 *
 * Returning the key rather than an empty string is deliberate: a blank label looks like a design
 * choice and survives review, whereas `assets.label.custody` on the screen is unmistakably a missing
 * translation. The localization gate makes this unreachable in a merged build.
 */
export const recordTranslator =
  (language: Language): Translate =>
  (key: string): string => {
    const path = key.split('.');

    for (const catalogue of CATALOGUES[language]) {
      const found = lookup(catalogue, path);

      if (found !== undefined) return found;
    }
    return key;
  };

/** A civil date as stored. Never reformatted — the reader's calendar is the kernel's business. */
export const dayOf = (value: Date | string | undefined): string =>
  value === undefined ? '—' : new Date(value).toISOString().slice(0, 10);

/** An identifier, shortened for a cell. Never a name this screen does not own. */
export const short = (value: string | undefined): string =>
  value === undefined ? '—' : `${value.slice(0, 8)}…`;

/**
 * A bilingual value in the reader's language, falling back to the other one.
 *
 * The parameter is the shape every module publishes for one — `LocalizedName`, `LocalizedNameView`,
 * `LocalizedTextView` are all `{ en, ar }` — rather than an open record, so a caller cannot pass a
 * map of something else and get a language out of it. A person's name arrives as an open record
 * from Employment, and `nameIn` in this module's own locale file handles that one.
 *
 * Both languages are required by every domain that publishes one, so the fallback should never
 * fire; it is here because a screen that rendered nothing for a value the API did return would be a
 * blank cell nobody could explain.
 */
export const textIn = (
  text: { readonly en: string; readonly ar: string } | undefined,
  language: Language,
): string | undefined => {
  if (text === undefined) return undefined;
  return text[language] || text[language === 'ar' ? 'en' : 'ar'];
};
