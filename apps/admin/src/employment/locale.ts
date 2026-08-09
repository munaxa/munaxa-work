import ar from '@work/employment/locales/ar.json';
import en from '@work/employment/locales/en.json';

/**
 * The employment screens' text, in both first-class languages.
 *
 * The catalogues are the module's own — the same files `scripts/check-localization.mjs` gates —
 * rather than a second copy kept in the portal. A portal with its own strings is a portal whose
 * Arabic falls behind the module's on the first change nobody remembers to mirror.
 *
 * A *code* is never translated here. Employment type, end reason and contract type are tenant or
 * country-pack values (00B), so the screen renders what the customer stored rather than looking it
 * up in a list this product ships — which is the same reason the domain refuses to interpret them.
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
 * choice and survives review, whereas `employment.label.manager` on the screen is unmistakably a
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
 * A person's name in the reader's language, falling back to the other one.
 *
 * Absent rather than blank when the API withheld it: a caller who may not read people receives an
 * employment with no name, and the screen says so instead of rendering an empty cell that reads as
 * missing data.
 */
export const nameIn = (
  text: Readonly<Record<string, string>> | undefined,
  language: Language,
): string | undefined => {
  if (text === undefined) return undefined;
  return text[language] || text[language === 'ar' ? 'en' : 'ar'];
};

/** A civil date as stored. Never reformatted here — the reader's calendar is the kernel's business. */
export const dateOf = (value: Date | string | undefined): string =>
  value === undefined ? '—' : new Date(value).toISOString().slice(0, 10);
