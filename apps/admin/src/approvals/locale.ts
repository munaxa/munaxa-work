import adminAr from '../../locales/ar.json';
import adminEn from '../../locales/en.json';
import workflowAr from '@work/workflow/locales/ar.json';
import workflowEn from '@work/workflow/locales/en.json';

import type { Language, Translate } from '../shell/locale';

/**
 * The approvals screens' text: Workflow's own catalogue, and the portal's for the frame.
 *
 * Every word an approval is described by belongs to Workflow — its instance statuses, its step
 * statuses, its decisions, its two authorities, its approver kinds, its history events, its branch
 * rules and outcomes, its condition operators, its service-level units and states — and all of them
 * already ship in both languages. **This slice adds no module string**, because there was nothing
 * left for it to say that the module does not already say.
 *
 * What a *screen* is called belongs to no module — "Approvals", "Waiting for you", "What you
 * decided" — and those come from the portal's own catalogue under `admin.`.
 *
 * A **code** and a **subject type** are never translated. A workflow's code is a tenant value and
 * `recruitment.requisition` is the owning module's own word for what is being decided; looking
 * either up in a list this product ships would be inventing a meaning Workflow does not hold.
 */

const CATALOGUES: Record<Language, readonly unknown[]> = {
  en: [adminEn, workflowEn],
  ar: [adminAr, workflowAr],
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
 * choice and survives review, whereas `workflow.label.pending` on the screen is unmistakably a
 * missing translation. The localization gate makes this unreachable in a merged build.
 */
export const approvalsTranslator =
  (language: Language): Translate =>
  (key: string): string => {
    const path = key.split('.');

    for (const catalogue of CATALOGUES[language]) {
      const found = lookup(catalogue, path);

      if (found !== undefined) return found;
    }
    return key;
  };
