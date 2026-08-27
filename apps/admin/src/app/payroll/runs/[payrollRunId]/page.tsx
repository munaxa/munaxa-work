import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Page, PageHeader, Stack } from '@munaxa/ui';

import { loadRun, loadRunDetail } from '../../../../payroll/api';
import {
  directionOf,
  isLanguage,
  payrollTranslator,
  type Language,
} from '../../../../payroll/locale';
import { Isolated, Term } from '../../../../payroll/frame';
import {
  ExceptionsSection,
  PostureSection,
  RunBoundaries,
  RunCounts,
  RunSummary,
  runTone,
} from '../../../../payroll/run';
import { ResultsSection } from '../../../../payroll/results';
import {
  AccountingSection,
  AdjustmentsSection,
  ApprovalsSection,
  PaymentsSection,
  ReconciliationSection,
} from '../../../../payroll/outputs';

/**
 * One payroll run, opened.
 *
 * Until this route existed the product could show a payroll run only by rendering the first row of
 * a page as though it were the run — there was no way to open the second, and therefore no way to
 * look at the payroll somebody was actually asking about. A run whose row does not open is a report.
 *
 * **The run is the subject.** Its number and its status are the heading; the four counts it reports
 * about itself are directly under it.
 *
 * **Seven reads, four permissions, four different refusals.** `payroll.read` answers the run, its
 * exceptions, its adjustments, its approval chain and its reconciliation; `payroll.read-result`
 * answers the figures; `payroll.accounting` answers the journal; `payroll.payment` answers the
 * instructions. Each section says which of those happened to it.
 *
 * **`?lang=` switches language and direction together**, as everywhere else.
 */

export const metadata: Metadata = { title: 'Payroll run' };

interface PageProps {
  readonly params: Promise<{ readonly payrollRunId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const PayrollRunPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { payrollRunId } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = payrollTranslator(language);

  const run = await loadRun(payrollRunId);

  // Asked first and on its own: an identifier the API will not resolve is a 404, not a page of
  // refusals about a payroll that may not exist.
  if (run === undefined) notFound();

  const detail = await loadRunDetail(run);

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={
            <a
              href={`/payroll?lang=${language}`}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              {t('payroll.label.backToPayroll')}
            </a>
          }
          title={
            <>
              {t('payroll.label.run')} <Isolated>{String(run.runSequence)}</Isolated>
            </>
          }
          description={<Isolated>{run.runKind}</Isolated>}
          actions={<Term t={t} group="status" value={run.status} tone={runTone(run.status)} />}
        />

        <RunCounts t={t} run={run} />

        <RunSummary t={t} language={language} run={run} />

        <Stack gap={8}>
          <PostureSection t={t} run={run} exceptions={detail.exceptions} />
          <ResultsSection t={t} language={language} results={detail.results} />
          <ExceptionsSection t={t} language={language} exceptions={detail.exceptions} />
          <ApprovalsSection t={t} language={language} approvals={detail.approvals} />
          <AdjustmentsSection t={t} language={language} adjustments={detail.adjustments} />
          <ReconciliationSection t={t} language={language} reconciliation={detail.reconciliation} />
          <AccountingSection t={t} accounting={detail.accounting} />
          <PaymentsSection t={t} payments={detail.payments} />
        </Stack>

        <RunBoundaries t={t} />
      </Page>
    </div>
  );
};

export default PayrollRunPage;
