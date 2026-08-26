import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import performanceAr from '@work/performance/locales/ar.json';
import performanceEn from '@work/performance/locales/en.json';

import type { Language, Translate } from '../shell/locale';

export type { Language, Translate };
export { directionOf, isLanguage } from '../shell/locale';

/**
 * The performance screens' text: Performance's own catalogue, and the portal's for the frame.
 *
 * The module's catalogue is the one `scripts/check-localization.mjs` gates, rather than a second
 * copy kept in the portal. A portal with its own strings is a portal whose Arabic falls behind the
 * module's on the first change nobody remembers to mirror.
 *
 * **A code is never translated.** A cycle code, a competency code, a goal category code and a
 * calibration session code are tenant values, so the screen renders what the customer stored rather
 * than looking it up in a list this product ships. A **status**, a **rating outcome**, an
 * **exclusion reason** and a **reviewer role** are different: those are this module's own closed
 * vocabularies, and somebody reading `not_applicable` in English on an Arabic screen is a
 * translation this product owes them.
 *
 * The keys this slice adds are nested, never flat-and-dotted. The Attendance slice found five keys
 * stored as the literal string `"boundary.employment"` under `attendance.label`: the gate joins
 * nested names with a dot and saw them as present, while this resolver splits the requested key on
 * a dot and found nothing, so five raw keys reached customers past a green gate. The gate now
 * rejects any key whose own name contains a dot, and a test in this folder asserts the shape.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [adminEn, performanceEn],
  ar: [adminAr, performanceAr],
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
 * choice and survives review, whereas `performance.label.goals` on the screen is unmistakably a
 * missing translation.
 */
export const performanceTranslator =
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

/**
 * A person's name, in the reader's language.
 *
 * Employment publishes `personName` as an open `Record<string, string>` rather than as a closed
 * `{ en, ar }`, because the set of languages a tenant stores a name in is the tenant's. This narrows
 * it without asserting a shape it does not have: it asks for the reader's language, falls back to
 * the other first-class one, and otherwise returns nothing so the caller can render the identifier
 * instead of a blank.
 *
 * **Absent is meaningful.** `personName` is present only when the caller may read the person, so a
 * missing name here is a permission boundary rather than a person with no name.
 */
export const personIn = (
  name: Readonly<Record<string, string>> | undefined,
  language: Language,
): string | undefined => {
  if (name === undefined) return undefined;
  const other = language === 'ar' ? 'en' : 'ar';

  return name[language] ?? name[other];
};
