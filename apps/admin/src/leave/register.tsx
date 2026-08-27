import type { ReactNode } from 'react';
import { KpiGrid, StatCard } from '@munaxa/ui';
import type { LeaveBalanceView, LeaveDashboardView, LeaveRequestView } from '@work/leave/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Duration,
  Identifier,
  Isolated,
  LeaveSection,
  Named,
  Note,
  Refused,
  Row,
  Rows,
  Term,
  When,
  shownOf,
  type LeaveProps,
} from './frame';
import { DASH, count, day, instant, minutes, reference } from './exact';
import type { Language } from './locale';
import { REQUEST_TONE } from './tones';
import type { Listing, Reconciliation } from './api';

/**
 * The leave register: what has been asked for, and what the balances behind it are.
 *
 * The screen this replaced was eleven stacked cards in the order the reads happened to be issued,
 * with no entry point and no destination: nothing on it opened, so a leave request could be listed
 * but never examined and a balance could be shown but never explained. Here the requests are a list
 * and each one opens, and each balance opens the standing that produced it.
 *
 * **Every figure is the server's.** The five overview figures are `LeaveDashboardView`'s own
 * counts, the durations are the minutes Leave published, and the totals beside each section are
 * `PagedResult.total`. Nothing here sums a column or works out a balance.
 *
 * **The order is the server's.** `leave.requests` publishes no ordering parameter, so the page is
 * rendered as it arrived and the screen says so. A screen that sorted it would be inventing a rule
 * Leave does not have.
 */

export interface RegisterProps extends LeaveProps {
  readonly language: Language;
}

/** The five figures the register opens with, each one counted by the server. */
export const LeaveOverview = ({
  t,
  dashboard,
}: LeaveProps & { readonly dashboard: LeaveDashboardView | undefined }): ReactNode => (
  <KpiGrid cols={{ base: 2, md: 5 }}>
    <StatCard
      label={t('leave.label.pendingApprovals')}
      value={dashboard === undefined ? DASH : count(dashboard.pendingApprovals)}
    />
    <StatCard
      label={t('leave.label.onLeaveToday')}
      value={dashboard === undefined ? DASH : count(dashboard.onLeaveToday)}
    />
    <StatCard
      label={t('leave.label.awaitingRecalculationShort')}
      value={dashboard === undefined ? DASH : count(dashboard.balancesAwaitingRecalculation)}
    />
    <StatCard
      label={t('leave.label.leaveTypesConfigured')}
      value={dashboard === undefined ? DASH : count(dashboard.leaveTypesConfigured)}
    />
    <StatCard
      label={t('leave.label.publishedPolicies')}
      value={dashboard === undefined ? DASH : count(dashboard.publishedPolicies)}
    />
  </KpiGrid>
);

/** The address of one employment's leave standing, optionally narrowed to one leave type. */
export const standingHref = (
  employmentId: string,
  language: Language,
  leaveTypeId?: string,
): string =>
  `/leave/balances/${employmentId}?lang=${language}${
    leaveTypeId === undefined ? '' : `&leaveTypeId=${leaveTypeId}`
  }`;

const RequestRow = ({
  t,
  language,
  request,
}: RegisterProps & { readonly request: LeaveRequestView }): ReactNode => (
  <Row>
    <Cell>
      <a
        href={`/leave/requests/${request.leaveRequestId}?lang=${language}`}
        className="underline underline-offset-4"
      >
        {t('leave.label.open')}
      </a>
    </Cell>
    <Identifier value={reference(request.employmentId)} />
    <When>
      <Isolated>{day(request.fromDate)}</Isolated>
    </When>
    <When>
      <Isolated>{day(request.toDate)}</Isolated>
    </When>
    <Cell numeric>
      <Duration>{minutes(t, request.totalMinutes)}</Duration>
    </Cell>
    <Cell>
      <Term t={t} group="basis" value={request.durationBasis} tone="muted" />
    </Cell>
    <Cell>
      <Term t={t} group="state" value={request.state} tone={REQUEST_TONE[request.state]} />
    </Cell>
    <When>
      <Isolated>{instant(request.requestedAt, language)}</Isolated>
    </When>
  </Row>
);

export const RequestsSection = ({
  t,
  language,
  requests,
}: RegisterProps & { readonly requests: Listing<LeaveRequestView> | undefined }): ReactNode => {
  const title = t('leave.label.requests');

  if (requests === undefined) return <Refused t={t} title={title} />;
  if (requests.items.length === 0) {
    return <Clear t={t} title={title} message="leave.label.noRequests" />;
  }

  return (
    <LeaveSection title={title} description={shownOf(requests)}>
      <Rows
        headings={[
          t('leave.label.request'),
          t('leave.label.employment'),
          t('leave.label.from'),
          t('leave.label.to'),
          t('leave.label.total'),
          t('leave.label.durationBasis'),
          t('leave.label.state'),
          t('leave.label.requestedAt'),
        ]}
        numeric={[4]}
      >
        {requests.items.map((request) => (
          <RequestRow key={request.leaveRequestId} t={t} language={language} request={request} />
        ))}
      </Rows>
      <Note t={t} message="leave.notice.requestsAreServerOrdered" />
    </LeaveSection>
  );
};

const BalanceRow = ({
  t,
  language,
  balance,
  names,
}: RegisterProps & {
  readonly balance: LeaveBalanceView;
  readonly names: ReadonlyMap<string, string>;
}): ReactNode => (
  <Row>
    <Cell>
      <a
        href={standingHref(balance.employmentId, language, balance.leaveTypeId)}
        className="underline underline-offset-4"
      >
        {t('leave.label.open')}
      </a>
    </Cell>
    <Identifier value={reference(balance.employmentId)} />
    <Named name={names.get(balance.leaveTypeId)} value={reference(balance.leaveTypeId)} />
    <When>
      <Isolated>{day(balance.leaveYearStart)}</Isolated>
    </When>
    <Cell numeric>
      <Duration>{minutes(t, balance.accruedMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, balance.consumedMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, balance.availableMinutes)}</Duration>
    </Cell>
    <Cell>
      {balance.inputsChangedAt === undefined ? (
        <Isolated>{instant(balance.calculatedAt, language)}</Isolated>
      ) : (
        <span className="text-warning-foreground">{t('leave.label.stale')}</span>
      )}
    </Cell>
  </Row>
);

export const BalancesSection = ({
  t,
  language,
  balances,
  names,
}: RegisterProps & {
  readonly balances: Listing<LeaveBalanceView> | undefined;
  readonly names: ReadonlyMap<string, string>;
}): ReactNode => {
  const title = t('leave.label.balances');

  if (balances === undefined) {
    return <Refused t={t} title={title} reason="leave.notice.balanceIsOwnPermission" />;
  }
  if (balances.items.length === 0) {
    return <Clear t={t} title={title} message="leave.label.noBalances" />;
  }

  return (
    <LeaveSection title={title} description={shownOf(balances)}>
      <Rows
        headings={[
          t('leave.label.standing'),
          t('leave.label.employment'),
          t('leave.label.leaveType'),
          t('leave.label.leaveYear'),
          t('leave.label.accrued'),
          t('leave.label.consumed'),
          t('leave.label.available'),
          t('leave.label.calculatedAt'),
        ]}
        numeric={[4, 5, 6]}
      >
        {balances.items.map((balance) => (
          <BalanceRow
            key={`${balance.employmentId}-${balance.leaveTypeId}-${balance.leaveYearStart}`}
            t={t}
            language={language}
            balance={balance}
            names={names}
          />
        ))}
      </Rows>
      <Note t={t} message="leave.notice.minutesAsPublished" />
    </LeaveSection>
  );
};

/**
 * The number that grows when something is quietly not working.
 *
 * A balance whose ledger moved after it was last calculated is a figure that no longer follows from
 * its own entries. It is shown and never acted on: recalculating is a `POST`.
 */
export const ReconciliationSection = ({
  t,
  language,
  reconciliation,
}: RegisterProps & { readonly reconciliation: Reconciliation | undefined }): ReactNode => {
  const title = t('leave.label.awaitingRecalculation');

  if (reconciliation === undefined) {
    return <Refused t={t} title={title} reason="leave.notice.balanceIsOwnPermission" />;
  }
  if (reconciliation.total === 0) {
    return <Clear t={t} title={title} message="leave.label.noneAwaiting" />;
  }

  return (
    <LeaveSection title={title} description={<Isolated>{count(reconciliation.total)}</Isolated>}>
      <Rows
        headings={[
          t('leave.label.employment'),
          t('leave.label.leaveType'),
          t('leave.label.leaveYear'),
          t('leave.label.calculatedAt'),
          t('leave.label.changedAt'),
        ]}
      >
        {reconciliation.balances.map((balance) => (
          <Row key={balance.balanceId}>
            <Identifier value={reference(balance.employmentId)} />
            <Identifier value={reference(balance.leaveTypeId)} />
            <When>
              <Isolated>{day(balance.leaveYearStart)}</Isolated>
            </When>
            <When>
              <Isolated>{instant(balance.calculatedAt, language)}</Isolated>
            </When>
            <When>
              <Isolated>{instant(balance.inputsChangedAt, language)}</Isolated>
            </When>
          </Row>
        ))}
      </Rows>
      <Note t={t} message="leave.notice.recalculationIsApi" />
    </LeaveSection>
  );
};

/** What the register does not do, said rather than left as an absence. */
const REGISTER_BOUNDARIES = [
  'leave.label.noMoney',
  'leave.label.noAttendance',
  'leave.label.noEmploymentStatus',
  'leave.label.noStatutory',
  'leave.label.noDocuments',
  'leave.notice.identifiersNotNames',
  'admin.notice.readOnly',
] as const;

export const RegisterBoundaries = ({ t }: LeaveProps): ReactNode => (
  <Boundaries t={t} keys={REGISTER_BOUNDARIES} />
);
