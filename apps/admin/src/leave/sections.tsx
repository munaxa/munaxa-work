import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  LeaveBalanceView,
  LeaveDashboardView,
  LeaveRequestView,
  LedgerEntryView,
} from '@work/leave/contracts';

import type { Language } from './locale';

/**
 * The operational half of the leave screen: what people have, what they have asked for, and what
 * needs a human.
 *
 * Four things this screen does deliberately.
 *
 * **It shows employment identifiers, not names.** Resolving an employment to a human being is
 * People's read, behind People's permission — and this screen has not asked. A truncated identifier
 * is honest; a name cached here would be a second answer that goes stale on the first correction.
 *
 * **It shows the balances awaiting recalculation.** That number is the one on this page that
 * reveals a *failure*: the ledger is authoritative and the balance is a projection, and a
 * projection whose ledger has moved is stale. Showing the count turns a silent gap into something
 * somebody can act on.
 *
 * **It shows minutes, never days and never money.** Converting minutes to days needs the
 * employment's contracted hours, which this screen has not read; converting them to money is
 * Payroll's, which this screen will never do.
 *
 * **It does not show a justification.** The register lists requests, their dates and their state. A
 * sick-leave reason is close to health data and does not belong on a list somebody leaves open on a
 * second monitor.
 */

export type Translate = (key: string) => string;

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;

/** Minutes, rendered as minutes. No conversion to days, to a rate or to an amount. */
export const minutes = (t: Translate, value: number): string =>
  t('leave.label.minutes').replace('{minutes}', String(value));

export const instant = (at: Date | string | undefined, language: Language): string => {
  if (at === undefined) return '—';
  return new Date(at).toLocaleString(language === 'ar' ? 'ar' : 'en-GB', { timeZone: 'UTC' });
};

export const Empty = ({ t }: { readonly t: Translate }): ReactNode => (
  <p className="text-sm opacity-70">{t('leave.label.empty')}</p>
);

export const Figure = ({
  t,
  label,
  value,
}: {
  readonly t: Translate;
  readonly label: string;
  readonly value: number;
}): ReactNode => (
  <div className="flex flex-col">
    <dt className="opacity-70">{t(`leave.label.${label}`)}</dt>
    <dd className="text-lg font-medium">{value}</dd>
  </div>
);

export const DashboardSection = ({
  t,
  dashboard,
  unavailable,
}: SectionProps & {
  readonly dashboard: LeaveDashboardView | undefined;
  readonly unavailable: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.dashboard')}</h2>

    {unavailable || dashboard === undefined ? (
      <p className="text-sm opacity-70">{t('leave.label.unavailable')}</p>
    ) : (
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Figure t={t} label="pendingApprovals" value={dashboard.pendingApprovals} />
        <Figure t={t} label="onLeaveToday" value={dashboard.onLeaveToday} />
        <Figure t={t} label="leaveTypesConfigured" value={dashboard.leaveTypesConfigured} />
        <Figure t={t} label="publishedPolicies" value={dashboard.publishedPolicies} />
        {/* The failure number, shown beside the rest rather than hidden in an operations view. */}
        <Figure
          t={t}
          label="awaitingRecalculation"
          value={dashboard.balancesAwaitingRecalculation}
        />
      </dl>
    )}
  </Card>
);

/**
 * Balances, with the stale mark visible.
 *
 * `inputsChangedAt` being present means the ledger moved after this figure was calculated. Showing
 * it beside the number is the difference between a stale balance somebody can distrust and one that
 * looks exactly like a correct one.
 */
export const BalancesSection = ({
  t,
  language,
  balances,
}: SectionProps & { readonly balances: readonly LeaveBalanceView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.balances')}</h2>

    {balances.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('leave.label.employment')}</th>
            <th className="text-start">{t('leave.label.leaveYear')}</th>
            <th className="text-start">{t('leave.label.accrued')}</th>
            <th className="text-start">{t('leave.label.consumed')}</th>
            <th className="text-start">{t('leave.label.available')}</th>
            <th className="text-start">{t('leave.label.calculatedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((balance) => (
            <tr key={`${balance.employmentId}-${balance.leaveTypeId}-${balance.leaveYearStart}`}>
              <td>{short(balance.employmentId)}</td>
              <td>{balance.leaveYearStart}</td>
              <td>{minutes(t, balance.accruedMinutes)}</td>
              <td>{minutes(t, balance.consumedMinutes)}</td>
              <td>{minutes(t, balance.availableMinutes)}</td>
              <td>
                {balance.inputsChangedAt === undefined
                  ? instant(balance.calculatedAt, language)
                  : t('leave.label.stale')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

/** The movements behind a balance — the screen that answers "why is it this number". */
export const LedgerSection = ({
  t,
  language,
  ledger,
}: SectionProps & { readonly ledger: readonly LedgerEntryView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.ledger')}</h2>

    {ledger.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('leave.label.employment')}</th>
            <th className="text-start">{t('leave.label.kind')}</th>
            <th className="text-start">{t('leave.label.minutes').replace('{minutes} ', '')}</th>
            <th className="text-start">{t('leave.label.effectiveOn')}</th>
            <th className="text-start">{t('leave.label.balanceAfter')}</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((entry) => (
            <tr key={entry.entryId}>
              <td>{short(entry.employmentId)}</td>
              {/* A kind is product vocabulary, rendered as stored. */}
              <td>{entry.kind}</td>
              <td>{minutes(t, entry.minutes)}</td>
              <td>{entry.effectiveOn}</td>
              <td>{minutes(t, entry.balanceAfterMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p className="text-xs opacity-60">{instant(ledger[0]?.recordedAt, language)}</p>
  </Card>
);

/** The register and the approval queue. Neither shows a justification. */
export const RequestsSection = ({
  t,
  language,
  requests,
  heading,
}: SectionProps & {
  readonly requests: readonly LeaveRequestView[];
  readonly heading: string;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t(`leave.label.${heading}`)}</h2>

    {requests.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('leave.label.employment')}</th>
            <th className="text-start">{t('leave.label.from')}</th>
            <th className="text-start">{t('leave.label.to')}</th>
            <th className="text-start">{t('leave.label.total')}</th>
            <th className="text-start">{t('leave.label.state')}</th>
            <th className="text-start">{t('leave.label.requestedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.leaveRequestId}>
              <td>{short(request.employmentId)}</td>
              <td>{request.fromDate}</td>
              <td>{request.toDate}</td>
              <td>{minutes(t, request.totalMinutes)}</td>
              <td>{request.state}</td>
              <td>{instant(request.requestedAt, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);
