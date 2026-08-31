import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import assetsAr from '@work/assets/locales/ar.json';
import assetsEn from '@work/assets/locales/en.json';

import type { Language, Translate } from '../shell/locale';

export type { Language, Translate };
export { directionOf, isLanguage } from '../shell/locale';

/**
 * The assets screens' text: Assets' own catalogue, and the portal's for the frame.
 *
 * The module's catalogue is the one `scripts/check-localization.mjs` gates, rather than a second
 * copy kept in the portal. It already carried ninety keys in both languages before this slice
 * existed — every label, both closed vocabularies, and twenty-two boundary notes that say in the
 * customer's own words what this release does not do. The footnotes on both screens are composed
 * from those notes rather than from sentences invented here.
 *
 * **An asset tag is never translated.** It is the label somebody wrote on the item and the string
 * they will search for; a catalogue could only make it wrong. A **status** and a **custody state**
 * are different: `available` and `under_repair`, `open` and `returned` are Assets' own closed
 * vocabularies, shipped in both languages, and an Arabic reader meeting `under_repair` in Latin is
 * a translation this product owes them.
 *
 * The keys this slice adds are nested, never flat-and-dotted. The Attendance slice found five keys
 * stored as the literal string `"boundary.employment"`: the gate joins nested names with a dot and
 * saw them as present, while this resolver splits the requested key on a dot and found nothing, so
 * five raw keys reached customers past a green gate.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [adminEn, assetsEn],
  ar: [adminAr, assetsAr],
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
 * choice and survives review, whereas `assets.label.custody` on the screen is unmistakably a
 * missing translation.
 */
export const assetsTranslator =
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
 * Both languages are required of an asset type by the domain — `category_name_incomplete` is a
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
