import type { ReactNode } from 'react';
import { Page, PageHeader } from '@munaxa/ui';

import { loadWorkforce } from '../../employment/api';
import { directionOf, isLanguage, translator, type Language } from '../../employment/locale';
import { BoundariesSection, WorkforceSection } from '../../employment/sections';

/**
 * The employment administration screen.
 *
 * Presentation only: it consumes the module's published contracts and the API, and holds no
 * business logic of its own — no rule about which transitions are permitted, no idea what makes an
 * assignment primary. Those live in the domain and the application service, and a screen that
 * reimplemented them would be a second, weaker answer to a question the API already decided.
 *
 * Three things on this page are the phase's claims made visible:
 *
 * **`?asOf=`** renders the workforce as at a date — each employment's department and manager as
 * they stood then, not as they stand now. That is the whole of effective dating, on a screen.
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is
 * never a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **It is read-only**, consistent with the organization and people screens. Every mutation goes
 * through the API; the write screens are Phase 18/19's, and building them only here would make
 * Employment the one module with them.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const EmploymentPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const asOf = single(parameters['asOf']);
  const t = translator(language);
  const workforce = await loadWorkforce(asOf);

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={t('employment.label.workforce')}
          description={t('employment.hint.everyRowOpens')}
        />

        <WorkforceSection
          t={t}
          language={language}
          employments={workforce.employments}
          unavailable={workforce.unavailable}
          asOf={asOf}
        />
        <BoundariesSection t={t} language={language} />
      </Page>
    </div>
  );
};

export default EmploymentPage;
