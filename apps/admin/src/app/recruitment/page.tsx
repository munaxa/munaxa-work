import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Page, PageHeader, Stack } from '@munaxa/ui';

import { loadHiring } from '../../recruitment/api';
import { directionOf, hiringTranslator, isLanguage, type Language } from '../../recruitment/locale';
import {
  HiringOverview,
  NothingReadable,
  RequisitionsSection,
  VacanciesSection,
  WorkspaceBoundaries,
  answeredNothing,
} from '../../recruitment/workspace';
import {
  ApplicationsSection,
  CandidatesSection,
  PipelineSection,
} from '../../recruitment/pipeline';

/**
 * Hiring, as work rather than as three lists.
 *
 * The screen this replaced showed requisitions, vacancies and candidates as three unrelated tables,
 * none of whose rows opened, with nothing anywhere saying how many people were in a pipeline — three
 * of Recruitment's twelve published read routes, behind a module of forty-two. The order here is the
 * hiring process's own: headcount is authorized, an opening is created against it, people apply, and
 * the pipeline is what a recruiter actually looks at.
 *
 * **Every figure is the server's.** The four totals are counted in the database and the pipeline
 * counts come from an aggregate query the module wrote so that a vacancy with forty thousand
 * applications is never loaded to be counted. Nothing here sums, averages or percentages any of it.
 *
 * **Refused, empty and populated are three answers.** Each section stands on its own permission, so
 * a caller may be shown the requisitions and refused the candidates, and the screen says which. In
 * this deployment, where Platform's authentication adapter is absent, refusal is the ordinary state.
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **It offers no control.** Every movement through the pipeline is a write, and a request from this
 * portal carries no principal, so a button here would post unauthenticated and answer 401.
 */

export const metadata: Metadata = { title: 'Hiring' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const RecruitmentPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = hiringTranslator(language);
  const hiring = await loadHiring();

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={t('recruitment.label.hiring')}
          description={t('recruitment.label.hiringLead')}
        />

        {answeredNothing(hiring) ? (
          <NothingReadable t={t} />
        ) : (
          <>
            <HiringOverview t={t} hiring={hiring} />

            <Stack gap={8}>
              <RequisitionsSection t={t} language={language} requisitions={hiring.requisitions} />
              <VacanciesSection t={t} language={language} vacancies={hiring.vacancies} />
              <PipelineSection t={t} language={language} pipelines={hiring.pipelines} />
              <ApplicationsSection t={t} language={language} applications={hiring.applications} />
              <CandidatesSection t={t} language={language} candidates={hiring.candidates} />
            </Stack>
          </>
        )}

        <WorkspaceBoundaries t={t} />
      </Page>
    </div>
  );
};

export default RecruitmentPage;
