import ar from '@work/people/locales/ar.json';
import en from '@work/people/locales/en.json';

/**
 * The people screens' text, in both first-class languages.
 *
 * The catalogues are the module's own — the same files `scripts/check-localization.mjs` gates —
 * rather than a second copy kept in the portal. A portal with its own strings is a portal whose
 * Arabic falls behind the module's on the first change nobody remembers to mirror.
 *
 * A person's *name* is not here and never will be. It is the person's own name, not a string this
 * product ships, so it arrives from the API as bilingual text and is resolved by `textIn` below.
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
 * choice and survives review, whereas `people.label.emergencyContacts` on the screen is
 * unmistakably a missing translation. The gate makes this unreachable in a merged build.
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
 * A person's name in the reader's language, falling back to the other one.
 *
 * The fallback exists because a record migrated from an older system could legitimately be missing
 * a language, and a blank name in a register is worse than a name in the wrong script. New records
 * cannot reach that state: the domain and the database both refuse a name missing either language.
 */
export const textIn = (
  text: { readonly en: string; readonly ar: string } | undefined,
  language: Language,
): string => {
  if (text === undefined) return '';
  return text[language] || text[language === 'ar' ? 'en' : 'ar'];
};
