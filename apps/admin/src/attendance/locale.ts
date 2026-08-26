import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import attendanceAr from '@work/attendance/locales/ar.json';
import attendanceEn from '@work/attendance/locales/en.json';

import type { Language, Translate } from '../shell/locale';

export type { Language, Translate };
export { directionOf, isLanguage } from '../shell/locale';

/**
 * The attendance screens' text: Attendance's own catalogue, and the portal's for the frame.
 *
 * **This resolver is where a shipped defect lived.** The catalogue used to store five of its keys
 * *flat and containing dots* — the literal string `"boundary.employment"` nested under
 * `attendance.label`. `scripts/check-localization.mjs` flattens a catalogue by **joining** nested
 * names with a dot, so it saw `attendance.label.boundary.employment` as present and passed. This
 * resolver does the opposite: it **splits** the requested key on a dot and walks segment by
 * segment, so it looked for a nested `boundary` object, found none, and returned the key. Five raw
 * catalogue keys reached customers, in English and in Arabic, past a green gate.
 *
 * Both halves are fixed in this slice. The keys are nested, and the gate now rejects any key whose
 * own name contains a dot — which is what makes its flattening and this splitting mean the same
 * thing. A test in this folder asserts the catalogue's shape so the defect cannot return.
 *
 * A **code** is never translated. A shift code, a schedule code, a reason code and a device
 * reference are tenant or country-pack values (00B), so the screen renders what the customer stored
 * rather than looking it up in a list this product ships.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [adminEn, attendanceEn],
  ar: [adminAr, attendanceAr],
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
 * choice and survives review, whereas `attendance.label.days` on the screen is unmistakably a
 * missing translation. That property is what made the defect above *visible* once somebody looked
 * at the rendered page — and tests here now assert no key reaches the markup in either language.
 */
export const attendanceTranslator =
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
 * Both languages are required by the domain, so the fallback should never fire — it is here because
 * a screen that rendered nothing for a value the API did have would be a blank cell nobody could
 * explain.
 */
export const nameIn = (
  text: { readonly en: string; readonly ar: string } | undefined,
  language: Language,
): string => {
  if (text === undefined) return '—';
  return text[language] || text[language === 'ar' ? 'en' : 'ar'] || '—';
};
