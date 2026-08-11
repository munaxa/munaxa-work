import type { ReactNode } from 'react';

import { loadHiring } from '../../recruitment/api';
import { directionOf, isLanguage, translator, type Language } from '../../recruitment/locale';
import {
  BoundariesSection,
  CandidatesSection,
  RequisitionsSection,
  VacanciesSection,
} from '../../recruitment/sections';

/**
 * The recruitment administration screen.
 *
 * Presentation only: it consumes the module's published contracts and the API, and holds no business
 * logic of its own — no rule about which transitions are permitted, no idea what makes a requisition
 * approved. Those live in the domain and the application service, and a screen that reimplemented
 * them would be a second, weaker answer to a question the API already decided.
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **It is read-only**, consistent with the organization, people and employment screens. Every
 * mutation goes through the API; the write screens are Phase 18/19's, and building them only here
 * would make Recruitment the one module with them.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const RecruitmentPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const hiring = await loadHiring();

  return (
    <main
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('recruitment.label.hiring')}</h1>
      </header>

      <RequisitionsSection
        t={t}
        language={language}
        requisitions={hiring.requisitions}
        unavailable={hiring.unavailable}
      />
      <VacanciesSection t={t} language={language} vacancies={hiring.vacancies} />
      <CandidatesSection t={t} language={language} candidates={hiring.candidates} />
      <BoundariesSection t={t} language={language} />
    </main>
  );
};

export default RecruitmentPage;
