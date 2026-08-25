import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import payrollAr from '@work/payroll/locales/ar.json';
import payrollEn from '@work/payroll/locales/en.json';

import type { Language, Translate } from '../shell/locale';

export type { Language, Translate };
export { directionOf, isLanguage } from '../shell/locale';

/**
 * The payroll screens' text: Payroll's own catalogue, and the portal's for the frame.
 *
 * Every word a run, a period, an approval and an exception are described by belongs to Payroll — its
 * eight run statuses, its period statuses and the twelve exception codes it can raise, each already
 * shipping in both languages. What a *screen* is called belongs to no module and comes from the
 * portal's own catalogue under `admin.`.
 *
 * A **code** is never translated. A run kind, a treatment code, a payment method, an account
 * reference, a rounding mode and a country-pack identifier are tenant or country-pack values, so the
 * screen renders what the customer stored rather than looking it up in a list this product ships.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [adminEn, payrollEn],
  ar: [adminAr, payrollAr],
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
 * choice and survives review, whereas `payroll.label.runs` on the screen is unmistakably a missing
 * translation. The localization gate makes this unreachable in a merged build.
 */
export const payrollTranslator =
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
 * A bilingual name in the reader's language, falling back to the other one.
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
