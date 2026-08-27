import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Page, PageHeader, Stack } from '@munaxa/ui';

import { loadPayslip } from '../../../../payroll/api';
import {
  directionOf,
  isLanguage,
  payrollTranslator,
  type Language,
} from '../../../../payroll/locale';
import { Isolated } from '../../../../payroll/frame';
import {
  DeductionLinesSection,
  EarningsSection,
  PayslipBoundaries,
  PayslipSummary,
  PayslipTotals,
} from '../../../../payroll/payslip';

/**
 * One employment's payroll result, opened.
 *
 * The screen this replaced showed `results.items[0]` — whichever result happened to be first in a
 * page — under a heading that said "Payslip data", so an operator could not look at anybody else's
 * and had nothing telling them whose they were looking at. This one is addressed by its own
 * identifier.
 *
 * **The route is flat rather than nested under a run, and that is deliberate.** `payroll.payslip` is
 * keyed on the result alone and `PayslipView` carries no run identifier, so a
 * `/payroll/runs/x/results/y` route would put a run in the address that nothing could confirm the
 * result belonged to. The period the payslip does publish — its code, its dates and its payment date
 * — is the context a reader of a payslip actually needs, and it comes from the read itself.
 *
 * **One read carries the whole page**: the period, the currency, the three frozen totals and both
 * line sets, returned together so a screen cannot show one line set from one state beside a total
 * from another.
 */

export const metadata: Metadata = { title: 'Payroll result' };

interface PageProps {
  readonly params: Promise<{ readonly payrollResultId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const PayrollResultPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { payrollResultId } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = payrollTranslator(language);

  const payslip = await loadPayslip(payrollResultId);

  // A result the API will not resolve — or will not show this caller the figures for — is a page
  // that cannot be rendered honestly, so it is not rendered.
  if (payslip === undefined) notFound();

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
              {t('payroll.label.result')} <Isolated>{payslip.periodCode}</Isolated>
            </>
          }
          description={t('payroll.label.payslip')}
        />

        <PayslipTotals t={t} payslip={payslip} />

        <PayslipSummary t={t} payslip={payslip} />

        <Stack gap={8}>
          <EarningsSection t={t} earnings={payslip.earnings} />
          <DeductionLinesSection t={t} deductions={payslip.deductions} />
        </Stack>

        <PayslipBoundaries t={t} />
      </Page>
    </div>
  );
};

export default PayrollResultPage;
