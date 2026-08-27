import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import recruitmentAr from '@work/recruitment/locales/ar.json';
import recruitmentEn from '@work/recruitment/locales/en.json';

import type { Language, Translate } from '../shell/locale';

export type { Language, Translate };
export { directionOf, isLanguage } from '../shell/locale';

/**
 * The hiring screens' text: Recruitment's own catalogue, and the portal's for the frame.
 *
 * Every word a requisition, a vacancy, a candidate, an application, an interview, an offer and a
 * hire are described by belongs to Recruitment — six closed status vocabularies and the panel's
 * five recommendations — and all of them already ship in both languages. What a *screen* is called
 * belongs to no module and comes from the portal's own catalogue under `admin.`.
 *
 * A **code** is never translated. A source code, a reason code, a priority code, an interview mode
 * and a publication channel are tenant or country-pack values, so the screen renders what the
 * customer stored rather than looking it up in a list this product ships — the same reason the
 * domain refuses to interpret them.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [adminEn, recruitmentEn],
  ar: [adminAr, recruitmentAr],
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
 * choice and survives review, whereas `recruitment.label.pipeline` on the screen is unmistakably a
 * missing translation. The localization gate makes this unreachable in a merged build.
 */
export const hiringTranslator =
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
export const textIn = (
  text: { readonly en: string; readonly ar: string } | undefined,
  language: Language,
): string => {
  if (text === undefined) return '—';
  return text[language] || text[language === 'ar' ? 'en' : 'ar'] || '—';
};

/**
 * A person's name in the reader's language, or nothing when Employment withheld it.
 *
 * Absent rather than blank when the API withheld it: a caller who may not read people receives an
 * employment with no name, and the screen shows the identifier instead of an empty cell that reads
 * as missing data.
 */
export const nameIn = (
  text: Readonly<Record<string, string>> | undefined,
  language: Language,
): string | undefined => {
  if (text === undefined) return undefined;
  return text[language] || text[language === 'ar' ? 'en' : 'ar'];
};

/**
 * The order Recruitment's own application statuses are declared in.
 *
 * Read from the module's catalogue rather than written out here, because the order a pipeline reads
 * in is the module's decision and not this screen's: `received` before `screening` before
 * `shortlisted` is the shape of the process, and a screen that sorted the stages by how many people
 * were in each would redraw the funnel every time somebody applied. Any status the server reports
 * that this list does not name is still shown, after the named ones and in the server's own order —
 * hiding a count because the catalogue had not heard of it would be the one failure worse than an
 * unfamiliar word.
 */
export const APPLICATION_STATUS_ORDER: readonly string[] = Object.keys(
  (recruitmentEn as { recruitment: { status: { application: Record<string, string> } } })
    .recruitment.status.application,
);

/** The statuses the server reported for one vacancy, in the module's own declared order. */
export const orderedStatuses = (counts: Readonly<Record<string, number>>): readonly string[] => {
  const reported = Object.keys(counts);
  const known = APPLICATION_STATUS_ORDER.filter((status) => reported.includes(status));

  return [...known, ...reported.filter((status) => !APPLICATION_STATUS_ORDER.includes(status))];
};
