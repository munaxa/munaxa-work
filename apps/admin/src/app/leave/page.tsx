import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadLeaveRegister, registerAnsweredNothing } from '../../leave/api';
import { directionOf, isLanguage, leaveTranslator, type Language } from '../../leave/locale';
import {
  BalancesSection,
  LeaveOverview,
  ReconciliationSection,
  RegisterBoundaries,
  RequestsSection,
} from '../../leave/register';
import { namesOf } from '../../leave/frame';
import { AccrualRunsSection, PoliciesSection, TypesSection } from '../../leave/configuration';

/**
 * Leave, as work rather than as eleven cards.
 *
 * The screen this replaced stacked eleven `Card`s down one column in the order the reads happened
 * to be issued, showed five rows of two hundred and sixty-eight requests with nothing saying so,
 * rendered every employment as the same eight truncated characters, and opened nothing at all. The
 * order here is an administrator's own: what leave is doing, what has been asked for, what the
 * balances behind it are, what is quietly not being recalculated, and only then the configuration
 * those balances are produced from.
 *
 * **Every figure is the server's.** The five overview figures are the dashboard's own counts, the
 * totals beside each section are `PagedResult.total`, and every duration is the minutes Leave
 * published.
 *
 * **Refused, empty and populated are three answers, and two permissions make the distinction
 * real.** The requests answer to `leave.read` and the balances to `leave.balance.read`, so a caller
 * holding one and not the other gets a page that says which half was withheld — and when not one
 * read answered, the page says so once rather than seven times.
 *
 * **`?lang=ar`** switches language *and* direction together.
 *
 * **It offers no control.** Raising, submitting, withdrawing, amending, approving, rejecting,
 * adjusting and recalculating are writes, and a request from this portal carries no principal, so a
 * button here would post unauthenticated and answer 401.
 */

export const metadata: Metadata = { title: 'Leave' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const LeavePage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = leaveTranslator(language);
  const register = await loadLeaveRegister();
  const names = namesOf(register.types, language);

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader title={t('leave.label.leave')} description={t('leave.label.leaveLead')} />

        {registerAnsweredNothing(register) ? (
          <EmptyState
            title={t('leave.label.nothingReadable')}
            description={t('leave.notice.unauthenticated')}
          />
        ) : (
          <>
            <LeaveOverview t={t} dashboard={register.dashboard} />

            <Stack gap={8}>
              <RequestsSection t={t} language={language} requests={register.requests} />
              <BalancesSection
                t={t}
                language={language}
                balances={register.balances}
                names={names}
              />
              <ReconciliationSection
                t={t}
                language={language}
                reconciliation={register.reconciliation}
              />
              <TypesSection t={t} language={language} types={register.types} />
              <PoliciesSection t={t} language={language} policies={register.policies} />
              <AccrualRunsSection t={t} language={language} runs={register.accrualRuns} />
            </Stack>
          </>
        )}

        <RegisterBoundaries t={t} />
      </Page>
    </div>
  );
};

export default LeavePage;
