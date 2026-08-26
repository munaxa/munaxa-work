import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadRequest, loadRequestDetail } from '../../../../leave/api';
import { directionOf, isLanguage, leaveTranslator, type Language } from '../../../../leave/locale';
import { Isolated, Term } from '../../../../leave/frame';
import { day } from '../../../../leave/exact';
import {
  DaysSection,
  RequestBoundaries,
  RequestNarrative,
  RequestSummary,
} from '../../../../leave/request';
import { ApprovalSection } from '../../../../leave/approval';
import { REQUEST_TONE } from '../../../../leave/tones';

/**
 * One leave request, opened.
 *
 * **A 404 and a 403 are different answers here, and the route acts on the difference.** Leave
 * returns 404 rather than 403 for a request in another tenant, because "forbidden" on a leave
 * request identifier would confirm that somebody in this system asked for leave — and on a
 * sick-leave request that is close to a health disclosure. So a missing request renders Next's
 * not-found page, and a refused one renders the withheld state on this page rather than claiming
 * the request does not exist.
 *
 * **The request is asked for first and on its own.** Asking for three more things about a request
 * that may not exist would be three requests spent to render nothing.
 *
 * **`?lang=` switches language and direction together**, as everywhere else.
 */

export const metadata: Metadata = { title: 'Leave request' };

interface PageProps {
  readonly params: Promise<{ readonly leaveRequestId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const LeaveRequestPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { leaveRequestId } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = leaveTranslator(language);

  const answer = await loadRequest(leaveRequestId);

  if (answer.kind === 'missing') notFound();

  const back = (
    <a
      href={`/leave?lang=${language}`}
      className="text-xs text-muted-foreground underline underline-offset-4"
    >
      {t('leave.label.backToLeave')}
    </a>
  );

  if (answer.kind === 'refused') {
    return (
      <div dir={directionOf(language)} lang={language}>
        <Page width="wide">
          <PageHeader above={back} title={t('leave.label.request')} />
          <EmptyState
            title={t('admin.notice.sectionWithheld')}
            description={t('leave.notice.unauthenticated')}
          />
          <RequestBoundaries t={t} />
        </Page>
      </div>
    );
  }

  const detail = await loadRequestDetail(answer.value);
  const { request } = detail;

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={back}
          title={
            <>
              {t('leave.label.request')}{' '}
              <Isolated>{`${day(request.fromDate)} — ${day(request.toDate)}`}</Isolated>
            </>
          }
          description={t('leave.label.requestLead')}
          actions={
            <Term t={t} group="state" value={request.state} tone={REQUEST_TONE[request.state]} />
          }
        />

        <RequestSummary t={t} language={language} detail={detail} />

        <Stack gap={8}>
          <DaysSection t={t} request={request} />
          <ApprovalSection t={t} language={language} approvals={detail.approvals} />
          <RequestNarrative t={t} language={language} request={request} />
        </Stack>

        <RequestBoundaries t={t} />
      </Page>
    </div>
  );
};

export default LeaveRequestPage;
