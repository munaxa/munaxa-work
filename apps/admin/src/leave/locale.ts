import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import leaveAr from '@work/leave/locales/ar.json';
import leaveEn from '@work/leave/locales/en.json';

import type { Language, Translate } from '../shell/locale';

export type { Language, Translate };
export { directionOf, isLanguage } from '../shell/locale';

/**
 * The leave screens' text: Leave's own catalogue, and the portal's for the frame.
 *
 * Every word a request, a ledger movement, a policy and an entitlement are described by belongs to
 * Leave — its nine request states, eight ledger kinds, five ledger sources, four day portions, two
 * duration bases, six accrual methods and four carry-over methods, each now shipping in both
 * languages. What a *screen* is called belongs to no module and comes from the portal's own
 * catalogue under `admin.`.
 *
 * A **code** is never translated. A reason code, a paid-treatment code, a statutory source, a leave
 * type code and a policy code are tenant or country-pack values (00B), so the screen renders what
 * the customer stored rather than looking it up in a list this product ships — the same reason the
 * domain refuses to interpret them.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [adminEn, leaveEn],
  ar: [adminAr, leaveAr],
};

/**
 * One segment at a time, never a flat lookup.
 *
 * Attendance's catalogue stores five of its keys *flat and containing dots* — the literal string
 * `"boundary.employment"` nested under `attendance.label` — which the localization gate accepts
 * because it flattens by joining with a dot, and which this resolver cannot find because it splits
 * on one. The result is a raw catalogue key rendered to a customer past a green gate. Leave's
 * catalogue is nested throughout and a test in this folder asserts it stays that way.
 */
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
 * choice and survives review, whereas `leave.label.ledger` on the screen is unmistakably a missing
 * translation. Tests in this folder assert that no key reaches the markup in **either** language,
 * because a key missing from Arabic alone is the one a reviewer reading English never sees.
 */
export const leaveTranslator =
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
