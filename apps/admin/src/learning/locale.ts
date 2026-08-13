import ar from '@work/learning/locales/ar.json';
import en from '@work/learning/locales/en.json';

/**
 * The learning screens' text, in both first-class languages.
 *
 * The catalogues are the module's own — the same files `scripts/check-localization.mjs` gates —
 * rather than a second copy kept in the portal. A portal with its own strings is a portal whose
 * Arabic falls behind the module's on the first change nobody remembers to mirror.
 *
 * A *code* is never translated here. A course code, a path code and a category code are tenant
 * values, so the screen renders what the customer stored rather than looking it up in a list this
 * product ships. A **status**, a **delivery mode** and a **validity state** are different: those are
 * this module's own closed vocabularies, and somebody reading `expiring_soon` in English on an
 * Arabic compliance screen is a translation this product owes them.
 */

export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

export const isLanguage = (value: string | undefined): value is Language =>
  value === 'en' || value === 'ar';

/** Direction follows language. It is never a separate toggle — that is how they drift apart. */
export const directionOf = (language: Language): 'ltr' | 'rtl' =>
  language === 'ar' ? 'rtl' : 'ltr';

const CATALOGUES: Record<Language, unknown> = { en, ar };

/**
 * Looks a catalogue key up, returning the key itself if it is missing.
 *
 * Returning the key rather than an empty string is deliberate: a blank label looks like a design
 * choice and survives review, whereas `learning.label.courses` on the screen is unmistakably a
 * missing translation. The gate makes this unreachable in a merged build.
 */
export const translator =
  (language: Language) =>
  (key: string): string => {
    const path = key.split('.');
    let value: unknown = CATALOGUES[language];

    for (const segment of path) {
      if (typeof value !== 'object' || value === null) return key;
      value = (value as Record<string, unknown>)[segment];
    }
    return typeof value === 'string' ? value : key;
  };

/**
 * A bilingual value in the reader's language, falling back to the other one.
 *
 * Both languages are required by the domain, so the fallback should never fire — it is here because
 * a screen that rendered nothing for a value the API did have would be a blank cell nobody could
 * explain.
 */
export const textIn = (
  text: { readonly en: string; readonly ar: string } | undefined,
  language: Language,
): string => {
  if (text === undefined) return '—';
  return language === 'ar' ? text.ar || text.en : text.en || text.ar;
};
