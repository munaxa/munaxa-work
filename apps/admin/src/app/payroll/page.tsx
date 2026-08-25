import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadPayrollWorkspace } from '../../payroll/api';
import { directionOf, isLanguage, payrollTranslator, type Language } from '../../payroll/locale';
import {
  PayrollOverview,
  RunsSection,
  WorkspaceBoundaries,
  answeredNothing,
} from '../../payroll/workspace';
import { DefinitionsSection, GroupsSection, PeriodsSection } from '../../payroll/configuration';

/**
 * Payroll, as work rather than as eighteen cards.
 *
 * The screen this replaced stacked eighteen `Card`s down one column, and most of them described a
 * single run the composition had chosen by taking the first row of a page — so an operator could
 * not look at last month's payroll, and nothing told them they were not already. The order here is
 * the operator's own: what the tenant's payroll is doing, then every run they can open, then the
 * configuration those runs are calculated from.
 *
 * **Every figure is the server's.** The five overview figures are the dashboard's own counts and the
 * totals beside each section are `PagedResult.total`. Nothing here totals a column or works out
 * which run is current.
 *
 * **Refused, empty and populated are three answers.** Each section stands on its own read, and when
 * not one of them answered the whole workspace says so once rather than five times.
 *
 * **`?lang=ar`** switches language *and* direction together.
 *
 * **It offers no control.** Calculating, approving, finalizing and reversing are writes, and a
 * request from this portal carries no principal, so a button here would post unauthenticated and
 * answer 401.
 */

export const metadata: Metadata = { title: 'Payroll' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const PayrollPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = payrollTranslator(language);
  const workspace = await loadPayrollWorkspace();

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={t('payroll.label.payroll')}
          description={t('payroll.label.payrollLead')}
        />

        {answeredNothing(workspace) ? (
          <EmptyState
            title={t('payroll.label.nothingReadable')}
            description={t('payroll.notice.unauthenticated')}
          />
        ) : (
          <>
            <PayrollOverview t={t} dashboard={workspace.dashboard} />

            <Stack gap={8}>
              <RunsSection t={t} language={language} runs={workspace.runs} />
              <PeriodsSection t={t} periods={workspace.periods} />
              <GroupsSection t={t} language={language} groups={workspace.groups} />
              <DefinitionsSection
                t={t}
                language={language}
                definitions={workspace.definitions}
                group={workspace.definitionsGroup}
              />
            </Stack>
          </>
        )}

        <WorkspaceBoundaries t={t} />
      </Page>
    </div>
  );
};

export default PayrollPage;
