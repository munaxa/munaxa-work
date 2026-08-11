import type { ReactNode } from 'react';

import { loadCompensation } from '../../compensation/api';
import { directionOf, isLanguage, translator, type Language } from '../../compensation/locale';
import {
  AdjustmentsSection,
  DashboardSection,
  OneTimeSection,
  RecurringSection,
} from '../../compensation/sections';
import {
  BoundariesSection,
  ComponentsSection,
  HistorySection,
  ImportsSection,
  PlansSection,
  StructuresSection,
} from '../../compensation/configuration';

/**
 * The compensation administration screen.
 *
 * Presentation only: it consumes the module's published contracts and the API, and holds no business
 * logic of its own — no rule about who may approve, no arithmetic on an amount, no percentage
 * resolved a second time. Those live in the domain and the application service, and a screen that
 * reimplemented them would be a second, weaker answer to a question the API already decided.
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **It is read-only**, consistent with every module screen before it. Every mutation goes through
 * the API; the write screens are Phase 18/19's, and building them only here would make Compensation
 * the one module with them.
 *
 * **There is no payroll here, no employee self-service and no manager self-service**, and no "give
 * a raise" button. Payroll is Phase 11's, the portals are Phase 18's, and a salary-change form on
 * an administrator's screen would be the beginning of one built in the wrong place.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const CompensationPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const compensation = await loadCompensation();

  return (
    <main
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('compensation.label.compensation')}</h1>
      </header>

      <DashboardSection
        t={t}
        language={language}
        dashboard={compensation.dashboard}
        unavailable={compensation.unavailable}
      />
      <RecurringSection t={t} language={language} recurring={compensation.recurring} />
      <OneTimeSection t={t} language={language} oneTime={compensation.oneTime} />
      <AdjustmentsSection t={t} language={language} adjustments={compensation.adjustments} />
      <PlansSection t={t} language={language} plans={compensation.plans} />
      <StructuresSection
        t={t}
        language={language}
        structures={compensation.structures}
        grades={compensation.grades}
        scales={compensation.scales}
        steps={compensation.steps}
      />
      <ComponentsSection t={t} language={language} components={compensation.components} />
      <HistorySection
        t={t}
        language={language}
        history={compensation.history}
        future={compensation.future}
      />
      <ImportsSection t={t} language={language} imports={compensation.imports} />
      <BoundariesSection t={t} language={language} />
    </main>
  );
};

export default CompensationPage;
