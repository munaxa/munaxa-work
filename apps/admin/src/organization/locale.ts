import ar from '@work/organization/locales/ar.json';
import en from '@work/organization/locales/en.json';

/**
 * The organization screens' text, in both first-class languages.
 *
 * The catalogues are the module's own — the same files `scripts/check-localization.mjs` gates —
 * rather than a second copy kept in the portal. A portal with its own strings is a portal whose
 * Arabic falls behind the module's on the first change nobody remembers to mirror.
 *
 * Organization *names* are not here and never will be. "Riyadh Operations" is the customer's
 * word, not a string this product ships, so it arrives from the API as `LocalizedText` and is
 * resolved by `textIn` below.
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
 * choice and survives review, whereas `organization.label.governingLegalEntity` on the screen is
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
 * Tenant-authored text in the reader's language, falling back to the other one.
 *
 * The fallback exists because a *closed* unit created before the bilingual constraint could
 * legitimately be missing a language, and a blank cell in an org chart is worse than a name in
 * the wrong script. New records cannot reach that state: the domain and the database both
 * refuse a name missing either language.
 */
export const textIn = (
  text: Readonly<Record<string, string>> | undefined,
  language: Language,
): string => {
  if (text === undefined) return '';
  return text[language] ?? text[language === 'ar' ? 'en' : 'ar'] ?? '';
};
