import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  CompensationAdjustmentView,
  CompensationDashboardView,
  MoneyAmountView,
  OneTimeCompensationView,
  RecurringCompensationView,
} from '@work/compensation/contracts';

import type { Language } from './locale';

/**
 * The operational half of the compensation screen: what people receive, what was paid once, and
 * what somebody changed by hand.
 *
 * Four things this screen does deliberately.
 *
 * **It shows employment identifiers, not names.** Resolving an employment to a human being is
 * People's read, behind People's permission — and this screen has not asked. A truncated identifier
 * is honest; a name cached here would be a second answer that goes stale on the first correction.
 *
 * **It renders the amount the API returned and computes nothing.** Not a total across currencies,
 * not a proration, not a percentage. Compensation resolved the figure once and published the rule
 * beside it; a screen that resolved it again would be a second answer that differs by a rounding
 * mode.
 *
 * **It shows a payroll treatment code without interpreting it.** What "ordinary" means for tax is a
 * jurisdictional question this product does not answer, here or anywhere.
 *
 * **It does not show an adjustment reason unless the API sent one.** Reasons sit behind
 * `compensation.adjust`; the screen renders what came back rather than deciding for itself.
 */

export type Translate = (key: string) => string;

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;

/** An amount, exactly as the API rendered it. Nothing here parses or re-formats a figure. */
export const money = (amount: MoneyAmountView | undefined): string =>
  amount === undefined ? '—' : `${amount.amount} ${amount.currencyCode}`;

export const instant = (at: Date | string | undefined, language: Language): string => {
  if (at === undefined) return '—';
  return new Date(at).toLocaleString(language === 'ar' ? 'ar' : 'en-GB', { timeZone: 'UTC' });
};

export const Empty = ({ t }: { readonly t: Translate }): ReactNode => (
  <p className="text-sm opacity-70">{t('compensation.label.empty')}</p>
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
    <dt className="opacity-70">{t(`compensation.label.${label}`)}</dt>
    <dd className="text-lg font-medium">{value}</dd>
  </div>
);

export const DashboardSection = ({
  t,
  dashboard,
  unavailable,
}: SectionProps & {
  readonly dashboard: CompensationDashboardView | undefined;
  readonly unavailable: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.dashboard')}</h2>

    {unavailable || dashboard === undefined ? (
      <p className="text-sm opacity-70">{t('compensation.label.unavailable')}</p>
    ) : (
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Figure t={t} label="plansPublished" value={dashboard.plansPublished} />
        <Figure t={t} label="componentsConfigured" value={dashboard.componentsConfigured} />
        <Figure t={t} label="awaitingApproval" value={dashboard.awaitingApproval} />
        <Figure t={t} label="effectiveThisMonth" value={dashboard.effectiveThisMonth} />
        <Figure t={t} label="futureDatedChanges" value={dashboard.futureDatedChanges} />
        {/* The one figure on this page that reveals a *gap*: somebody employed and not yet paid
            anything. Reporting it as a count is different from reporting their pay as zero. */}
        <Figure
          t={t}
          label="employmentsWithoutCompensation"
          value={dashboard.employmentsWithoutCompensation}
        />
      </dl>
    )}
  </Card>
);

export const RecurringSection = ({
  t,
  language,
  recurring,
}: SectionProps & { readonly recurring: readonly RecurringCompensationView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.recurring')}</h2>

    {recurring.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('compensation.label.employment')}</th>
            <th className="text-start">{t('compensation.label.component')}</th>
            <th className="text-start">{t('compensation.label.amount')}</th>
            <th className="text-start">{t('compensation.label.effectiveFrom')}</th>
            <th className="text-start">{t('compensation.label.effectiveTo')}</th>
            <th className="text-start">{t('compensation.label.state')}</th>
          </tr>
        </thead>
        <tbody>
          {recurring.map((record) => (
            <tr key={record.recurringId}>
              <td>{short(record.employmentId)}</td>
              <td>{record.componentCode}</td>
              <td>{money(record.amount)}</td>
              <td>{record.effectiveFrom}</td>
              <td>{record.effectiveTo ?? '—'}</td>
              <td>{record.approvalState}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p className="text-xs opacity-60">{instant(undefined, language)}</p>
  </Card>
);

export const OneTimeSection = ({
  t,
  oneTime,
}: SectionProps & { readonly oneTime: readonly OneTimeCompensationView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.oneTime')}</h2>

    {oneTime.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('compensation.label.employment')}</th>
            <th className="text-start">{t('compensation.label.component')}</th>
            <th className="text-start">{t('compensation.label.amount')}</th>
            <th className="text-start">{t('compensation.label.payableOn')}</th>
            <th className="text-start">{t('compensation.label.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {oneTime.map((item) => (
            <tr key={item.oneTimeId}>
              <td>{short(item.employmentId)}</td>
              <td>{item.componentCode}</td>
              <td>{money(item.amount)}</td>
              <td>{item.payableOn}</td>
              <td>{item.reasonCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const AdjustmentsSection = ({
  t,
  language,
  adjustments,
}: SectionProps & {
  readonly adjustments: readonly CompensationAdjustmentView[];
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('compensation.label.adjustments')}</h2>

    {adjustments.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('compensation.label.employment')}</th>
            <th className="text-start">{t('compensation.label.previousAmount')}</th>
            <th className="text-start">{t('compensation.label.amount')}</th>
            <th className="text-start">{t('compensation.label.effectiveFrom')}</th>
            <th className="text-start">{t('compensation.label.reason')}</th>
            <th className="text-start">{t('compensation.label.note')}</th>
            <th className="text-start">{t('compensation.label.recorded')}</th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((item) => (
            <tr key={item.adjustmentId}>
              <td>{short(item.employmentId)}</td>
              <td>{money(item.previousAmount)}</td>
              <td>{money(item.newAmount)}</td>
              <td>{item.effectiveFrom}</td>
              {/* Absent for a caller without `compensation.adjust`. The screen renders what the
                  API returned rather than deciding what to hide. */}
              <td>{item.reasonCode ?? '—'}</td>
              <td>{item.note ?? '—'}</td>
              <td>{instant(item.recordedAt, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);
