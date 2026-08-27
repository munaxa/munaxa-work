import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Page, PageHeader, Stack } from '@munaxa/ui';

import { directionOf, isLanguage, type Language } from '../../../shell/locale';
import { loadApproval, loadInstance } from '../../../approvals/api';
import { approvalsTranslator } from '../../../approvals/locale';
import { Isolated, Term } from '../../../approvals/frame';
import {
  ApprovalSummary,
  BranchesSection,
  ChainSection,
  DecisionsSection,
  DetailBoundaries,
  instanceTone,
} from '../../../approvals/detail';
import { PortStatusSection, TimelineSection } from '../../../approvals/timeline';

/**
 * One approval, opened.
 *
 * Until this route existed the product could show an approval instance only by rendering the *first*
 * row of a listing as an example: there was no way to open the second, and therefore no way to look
 * at the approval somebody was actually asking about. A queue whose rows do not open is a report.
 *
 * **Everything on it is published and nothing is derived.** The chain, the decisions, the branch
 * tallies, the timeline and the port's own view of the same approval are five separate reads' worth
 * of the server's own answers; this screen adds no total, no age, no due date and no outcome.
 *
 * **`?lang=` switches language and direction together**, as everywhere else.
 *
 * **It offers no control.** Deciding is `POST /workflow/approvals/:instanceId/decision` behind
 * `workflow.approval.decide`, and it is named here as the API capability it is.
 */

export const metadata: Metadata = { title: 'Approval' };

interface PageProps {
  readonly params: Promise<{ readonly instanceId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const ApprovalPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { instanceId } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = approvalsTranslator(language);

  const detail = await loadInstance(instanceId);

  // Asked first and on its own: an identifier the API will not resolve is a 404, not a page of
  // refusals about an approval that may not exist.
  if (detail === undefined) notFound();

  const approval = await loadApproval(detail);
  const instance = detail.instance;

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={
            <a
              href={`/approvals?lang=${language}`}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {t('admin.approvals.backToQueue')}
            </a>
          }
          title={<Isolated>{instance.subjectType}</Isolated>}
          description={
            <>
              {t('workflow.label.subjectId')}: <Isolated>{instance.subjectId}</Isolated>
            </>
          }
          actions={
            <Term
              t={t}
              group="instanceStatus"
              value={instance.status}
              tone={instanceTone(instance.status)}
            />
          }
        />

        <ApprovalSummary t={t} language={language} detail={detail} />

        <Stack gap={8}>
          <ChainSection t={t} language={language} steps={detail.steps} />
          <BranchesSection t={t} tallies={detail.tallies} />
          <DecisionsSection t={t} language={language} decisions={detail.decisions} />
          <TimelineSection t={t} language={language} history={approval.history} />
          <PortStatusSection t={t} language={language} status={approval.status} />
        </Stack>

        <DetailBoundaries t={t} />
      </Page>
    </div>
  );
};

export default ApprovalPage;
