import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Page, PageHeader, Stack } from '@munaxa/ui';

import { loadRequisition, loadRequisitionDetail } from '../../../../recruitment/api';
import {
  directionOf,
  hiringTranslator,
  isLanguage,
  type Language,
} from '../../../../recruitment/locale';
import { Isolated, Term } from '../../../../recruitment/frame';
import {
  DecisionsSection,
  Headcount,
  RequisitionBoundaries,
  RequisitionSummary,
  requisitionTone,
} from '../../../../recruitment/requisition';
import { PipelineSection } from '../../../../recruitment/pipeline';

/**
 * One requisition, opened.
 *
 * Until this route existed the product could show a requisition only as a row in a list: there was
 * no way to see who authorized the headcount, whether anybody reversed that decision, or what was
 * being recruited against it. A requisition whose row does not open is a report.
 *
 * **The subject is the requisition.** Its number and its status are the heading; the three headcount
 * figures are the first thing under it, because hiring authorized in advance is what this record is
 * for and what is *left* is the number somebody acts on.
 *
 * **Nothing is derived.** `headcountRemaining` is the module's own field and not `requested` minus
 * `filled`; the pipeline counts are the module's aggregate query; the decisions are appended rows
 * and a reversal is another one, so the table is the history rather than the current answer.
 *
 * **`?lang=` switches language and direction together**, as everywhere else.
 */

export const metadata: Metadata = { title: 'Requisition' };

interface PageProps {
  readonly params: Promise<{ readonly requisitionId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const RequisitionPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { requisitionId } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = hiringTranslator(language);

  const snapshot = await loadRequisition(requisitionId);

  // Asked first and on its own: an identifier the API will not resolve is a 404, not a page of
  // refusals about a requisition that may not exist.
  if (snapshot === undefined) notFound();

  const detail = await loadRequisitionDetail(snapshot);
  const requisition = snapshot.requisition;

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
          title={<Isolated>{requisition.requisitionNumber}</Isolated>}
          description={t('recruitment.label.requisition')}
          actions={
            <Term
              t={t}
              group="requisition"
              value={requisition.status}
              tone={requisitionTone(requisition.status)}
            />
          }
        />

        <Headcount t={t} requisition={requisition} />

        <RequisitionSummary t={t} language={language} detail={detail} />

        <Stack gap={8}>
          <DecisionsSection t={t} language={language} decisions={snapshot.decisions} />
          <PipelineSection t={t} language={language} pipelines={detail.pipelines} withStatus />
        </Stack>

        <RequisitionBoundaries t={t} />
      </Page>
    </div>
  );
};

export default RequisitionPage;
