import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Page, PageHeader, Stack } from '@munaxa/ui';

import { directionOf, isLanguage, type Language } from '../../shell/locale';
import { loadApprovals } from '../../approvals/api';
import { approvalsTranslator } from '../../approvals/locale';
import {
  BoundariesNote,
  DecidedSection,
  QueueSummary,
  WaitingSection,
} from '../../approvals/queue';

/**
 * Approvals, as work rather than as configuration.
 *
 * The queues themselves are not new — Workflow has published them since Phase 16A, and one section
 * of the workflow administration screen has read them. What was missing is that they were the
 * thirteenth and fourteenth sections of a page about *configuring* approval processes, below the
 * definitions and the groups, with nothing anywhere saying how many were waiting. An approval that a
 * person has to go and look for, at the bottom of a settings screen, is not work.
 *
 * **Whose queue this is was decided by the request.** Neither read carries an identity of any kind,
 * and this screen offers no way to supply one: the API resolves the caller from the authenticated
 * request and answers a request that resolved nobody with nothing.
 *
 * **Refused, empty and populated are three different answers and the screen says which.** The
 * pipeline checks the permission before the handler runs, so a caller who does not hold
 * `workflow.approval.read-own` is refused; one who holds it but resolves no membership gets an empty
 * page. "Nothing is waiting for you" is a statement this screen must never make on a refusal.
 *
 * **It offers no control.** Deciding is a write and no request from this portal carries a principal,
 * so a decide button would post unauthenticated and answer 401. The capability is named instead.
 */

export const metadata: Metadata = { title: 'Approvals' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const ApprovalsPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = approvalsTranslator(language);
  const approvals = await loadApprovals();

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader title={t('admin.approvals.title')} description={t('admin.approvals.lead')} />

        <QueueSummary t={t} pending={approvals.pending} decided={approvals.decided} />

        <Stack gap={8}>
          <WaitingSection t={t} language={language} pending={approvals.pending} />
          <DecidedSection t={t} language={language} decided={approvals.decided} />
        </Stack>

        <BoundariesNote t={t} />
      </Page>
    </div>
  );
};

export default ApprovalsPage;
