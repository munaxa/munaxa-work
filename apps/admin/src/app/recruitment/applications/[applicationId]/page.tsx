import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Page, PageHeader, Stack } from '@munaxa/ui';

import { loadApplication, loadApplicationDetail } from '../../../../recruitment/api';
import {
  directionOf,
  hiringTranslator,
  isLanguage,
  type Language,
} from '../../../../recruitment/locale';
import { Isolated, Term } from '../../../../recruitment/frame';
import {
  ApplicationBoundaries,
  ApplicationSummary,
  HistorySection,
  applicationTone,
} from '../../../../recruitment/application';
import { InterviewsSection, OffersSection, PanelSection } from '../../../../recruitment/panel';

/**
 * One application, opened.
 *
 * Until this route existed the product showed no application at all — the hiring screen listed
 * requisitions, vacancies and candidates, and the thing that actually moves through a pipeline was
 * invisible. This is the record of one candidate's progress: how they got where they are, who saw
 * them, what the panel said, what was offered, and how far a hire got.
 *
 * **One read carries most of it.** `ApplicationSnapshot` returns the application, its history, its
 * interviews and its offers together, because answering in four round trips is four chances to show
 * an interview from one state beside a status from another. Two things are not in it and are asked
 * for separately: the candidate's name, which lives in Recruitment's candidate read, and the panel's
 * feedback, which sits behind its own permission.
 *
 * **Withheld is not empty.** A caller may read the application and be refused what the panel thought
 * of the candidate; that round says so rather than appearing to have had no feedback.
 *
 * **No figure is offered and none is computed.** An offer's proposed pay is opaque to this module
 * and absent from this screen; no score is averaged; no verdict is inferred.
 */

export const metadata: Metadata = { title: 'Application' };

interface PageProps {
  readonly params: Promise<{ readonly applicationId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const ApplicationPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { applicationId } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = hiringTranslator(language);

  const snapshot = await loadApplication(applicationId);

  // Asked first and on its own, for the same reason as a requisition.
  if (snapshot === undefined) notFound();

  const detail = await loadApplicationDetail(snapshot);
  const application = snapshot.application;

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={
            <a
              href={`/recruitment?lang=${language}`}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {t('recruitment.label.backToHiring')}
            </a>
          }
          title={<Isolated>{application.applicationNumber}</Isolated>}
          description={t('recruitment.label.application')}
          actions={
            <Term
              t={t}
              group="application"
              value={application.status}
              tone={applicationTone(application.status)}
            />
          }
        />

        <ApplicationSummary t={t} language={language} detail={detail} />

        <Stack gap={8}>
          <HistorySection t={t} language={language} history={snapshot.history} />
          <InterviewsSection t={t} language={language} interviews={snapshot.interviews} />
          <PanelSection
            t={t}
            language={language}
            interviews={snapshot.interviews}
            panels={detail.panels}
          />
          <OffersSection t={t} language={language} offers={snapshot.offers} />
        </Stack>

        <ApplicationBoundaries t={t} />
      </Page>
    </div>
  );
};

export default ApplicationPage;
