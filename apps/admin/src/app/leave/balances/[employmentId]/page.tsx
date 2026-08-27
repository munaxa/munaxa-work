import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadStanding, standingAnsweredNothing } from '../../../../leave/api';
import { directionOf, isLanguage, leaveTranslator, type Language } from '../../../../leave/locale';
import { todayIn } from '../../../../leave/exact';
import {
  BalancesSection,
  ProjectionSection,
  StandingBoundaries,
  StandingIdentity,
  TypeChooser,
} from '../../../../leave/standing';
import { namesOf } from '../../../../leave/frame';
import {
  AdjustmentsSection,
  EntitlementsSection,
  LedgerSection,
} from '../../../../leave/movements';
import { RequestsSection } from '../../../../leave/register';

/**
 * One employment's leave standing — the screen that answers "why is this balance that number".
 *
 * The ledger below carries `balanceBeforeMinutes` and `balanceAfterMinutes` on every entry, so a
 * disputed figure is walked movement by movement without this page adding a single number. That is
 * the whole point of the route: until it existed the product could show a balance and never the
 * arithmetic behind it.
 *
 * **A leave type is chosen, never picked on the reader's behalf.** The projection is keyed on one
 * leave type, and choosing one silently would be the `runs[0]` defect in another module. Without a
 * choice the page shows every balance this employment holds and says plainly that a projection
 * needs a type; with one it narrows the balances, the ledger, the entitlements, the adjustments and
 * the requests to that type and adds the projection.
 *
 * **There is no `notFound` here, deliberately.** Leave cannot say whether an employment exists —
 * that is Employment's question, and this page asks Employment only for a name. An employment Leave
 * holds nothing for gets empty sections saying Leave holds nothing, which is true, rather than a
 * 404 claiming the employment is not real.
 */

export const metadata: Metadata = { title: 'Leave standing' };

interface PageProps {
  readonly params: Promise<{ readonly employmentId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const BackToLeave = ({
  t,
  language,
}: {
  readonly t: (key: string) => string;
  readonly language: Language;
}): ReactNode => (
  <a
    href={`/leave?lang=${language}`}
    className="text-xs text-muted-foreground underline underline-offset-4"
  >
    {t('leave.label.backToLeave')}
  </a>
);

/** The six regions of the standing, apart from the route so the route stays a route. */
const StandingSections = ({
  t,
  language,
  standing,
  names,
}: {
  readonly t: ReturnType<typeof leaveTranslator>;
  readonly language: Language;
  readonly standing: Awaited<ReturnType<typeof loadStanding>>;
  readonly names: ReadonlyMap<string, string>;
}): ReactNode => (
  <Stack gap={8}>
    <BalancesSection t={t} language={language} balances={standing.balances} names={names} />
    <ProjectionSection t={t} projection={standing.projection} />
    <LedgerSection t={t} language={language} ledger={standing.ledger} />
    <EntitlementsSection t={t} entitlements={standing.entitlements} names={names} />
    <AdjustmentsSection
      t={t}
      language={language}
      adjustments={standing.adjustments}
      names={names}
    />
    <RequestsSection t={t} language={language} requests={standing.requests} />
  </Stack>
);

const LeaveStandingPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { employmentId } = await params;
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const leaveTypeId = single(parameters['leaveTypeId']);
  const t = leaveTranslator(language);

  const standing = await loadStanding(employmentId, {
    ...(leaveTypeId === undefined ? {} : { leaveTypeId }),
    onDate: todayIn(new Date()),
  });
  const names = namesOf(standing.types, language);

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          above={<BackToLeave t={t} language={language} />}
          title={t('leave.label.standing')}
          description={t('leave.label.standingLead')}
        />

        {standingAnsweredNothing(standing) ? (
          <EmptyState
            title={t('leave.label.nothingReadable')}
            description={t('leave.notice.unauthenticated')}
          />
        ) : (
          <>
            <StandingIdentity
              t={t}
              language={language}
              standing={standing}
              employmentId={employmentId}
            />

            <TypeChooser
              t={t}
              language={language}
              types={standing.types}
              employmentId={employmentId}
              selected={leaveTypeId}
            />

            <StandingSections t={t} language={language} standing={standing} names={names} />
          </>
        )}

        <StandingBoundaries t={t} />
      </Page>
    </div>
  );
};

export default LeaveStandingPage;
