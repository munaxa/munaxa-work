import ar from '../../locales/ar.json';
import en from '../../locales/en.json';

/**
 * The portal's own chrome, in both first-class languages.
 *
 * Every other catalogue this application reads belongs to a module, and that is deliberate: a
 * portal that keeps a second copy of "leave request" is a portal whose Arabic falls behind the
 * module's on the first change nobody remembers to mirror.
 *
 * These strings belong to no module. "Skip to content", "Workforce", "Approvals" and the name of
 * each screen are decisions about *this portal* — which surfaces it has and how it groups them —
 * and there is no module that could own them. So the portal has one catalogue of its own, gated by
 * `scripts/check-localization.mjs` exactly like every other, and it holds nothing a module already
 * says.
 *
 * A screen's *content* still comes from the owning module's catalogue. Only the frame is here.
 */

export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];

export const isLanguage = (value: string | undefined): value is Language =>
  value === 'en' || value === 'ar';

/** Direction follows language. It is never a separate toggle — that is how they drift apart. */
export const directionOf = (language: Language): 'ltr' | 'rtl' =>
  language === 'ar' ? 'rtl' : 'ltr';

/** The other language, which is what a two-language switch offers. */
export const otherThan = (language: Language): Language => (language === 'ar' ? 'en' : 'ar');

const CATALOGUES: Record<Language, unknown> = { en, ar };

export type Translate = (key: string) => string;

/**
 * Looks a catalogue key up, returning the key itself if it is missing.
 *
 * Returning the key rather than an empty string is deliberate: a blank label looks like a design
 * choice and survives review, whereas `admin.nav.people` in the sidebar is unmistakably a missing
 * translation. The gate makes this unreachable in a merged build.
 */
export const translator =
  (language: Language): Translate =>
  (key: string): string => {
    const path = key.split('.');
    let value: unknown = CATALOGUES[language];

    for (const segment of path) {
      if (typeof value !== 'object' || value === null) return key;
      value = (value as Record<string, unknown>)[segment];
    }
    return typeof value === 'string' ? value : key;
  };
