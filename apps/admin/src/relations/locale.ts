import type { ViolationCategoryView } from '@work/relations/contracts';

import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import relationsAr from '@work/relations/locales/ar.json';
import relationsEn from '@work/relations/locales/en.json';

import type { Language, Translate } from '../shell/locale';

export type { Language, Translate };
export { directionOf, isLanguage } from '../shell/locale';

/**
 * The relations screens' text: Relations' own catalogue, and the portal's for the frame.
 *
 * The module's catalogue is the one `scripts/check-localization.mjs` gates, rather than a second
 * copy kept in the portal. It carried 169 keys in both languages before this slice existed — every
 * label, four closed vocabularies, and the notices that say in the customer's own words what this
 * module refuses to do: issue nothing automatically, store no derived count, and treat a
 * recommendation as text.
 *
 * **A severity is never translated.** It is the tenant's own grading word, published as written;
 * a catalogue could only make it wrong. A violation **state**, an investigation **state** and an
 * **action type** are different: they are Relations' closed vocabularies, shipped in both
 * languages, and an Arabic reader meeting `under_investigation` in Latin is a translation this
 * product owes them.
 *
 * The keys this slice adds are nested, never flat-and-dotted. The Attendance slice found five keys
 * stored as the literal string `"boundary.employment"`: the gate joins nested names with a dot and
 * saw them as present, while this resolver splits the requested key on a dot and found nothing, so
 * five raw keys reached customers past a green gate.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [adminEn, relationsEn],
  ar: [adminAr, relationsAr],
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
 * Looks a key up across both catalogues, returning the key itself if neither has it.
 *
 * Returning the key rather than an empty string is deliberate: a blank label looks like a design
 * choice and survives review, whereas `relations.label.violations` on the screen is unmistakably a
 * missing translation.
 */
export const relationsTranslator =
  (language: Language): Translate =>
  (key: string): string => {
    const path = key.split('.');

    for (const catalogue of CATALOGUES[language]) {
      const found = lookup(catalogue, path);

      if (found !== undefined) return found;
    }
    return key;
  };

/**
 * A bilingual value in the reader's language, falling back to the other one.
 *
 * Both languages are required of a violation type by the domain — `category_name_incomplete` is a
 * rejection the module raises — so the fallback should never fire. It is here because a screen that
 * rendered nothing for a name the API did supply would be a blank cell nobody could explain.
 */
export const nameIn = (
  text: { readonly en: string; readonly ar: string } | undefined,
  language: Language,
): string | undefined => {
  if (text === undefined) return undefined;
  return language === 'ar' ? (text.ar ?? text.en) : (text.en ?? text.ar);
};

/**
 * The catalogue name for one violation type, in the reader's language.
 *
 * `undefined` when the catalogue was withheld or no longer carries the entry — the caller falls
 * back to the `categoryCode` frozen on the violation itself, which is what the record meant when it
 * was written. Honest either way: a name the tenant supplied, or the code they will recognise.
 */
export const categoryNamed = (
  categories: readonly ViolationCategoryView[] | undefined,
  violationCategoryId: string,
  language: Language,
): string | undefined =>
  nameIn(
    categories?.find((entry) => entry.violationCategoryId === violationCategoryId)?.name,
    language,
  );

/**
 * A person's name in the reader's language, from Employment's loosely-typed bilingual record.
 *
 * `EmploymentView.personName` is `Record<string, string>` rather than the `{ en, ar }` shape the
 * catalogue views use, so it gets its own accessor rather than a cast.
 */
export const personNamed = (
  name: Readonly<Record<string, string>> | undefined,
  language: Language,
): string | undefined => {
  if (name === undefined) return undefined;
  return name[language] ?? name[language === 'ar' ? 'en' : 'ar'];
};
