import type { ReactNode } from 'react';

import { loadWorkforce } from '../../employment/api';
import { directionOf, isLanguage, translator, type Language } from '../../employment/locale';
import { BoundariesSection, TimelineSection, WorkforceSection } from '../../employment/sections';

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
    <main
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('employment.label.workforce')}</h1>
        <p className="text-sm opacity-70">
          {t('employment.label.asOf')}: {asOf ?? '—'}
        </p>
      </header>

      <WorkforceSection
        t={t}
        language={language}
        employments={workforce.employments}
        unavailable={workforce.unavailable}
        asOf={asOf}
      />
      <TimelineSection t={t} language={language} history={workforce.history} />
      <BoundariesSection t={t} language={language} />
    </main>
  );
};

export default EmploymentPage;
