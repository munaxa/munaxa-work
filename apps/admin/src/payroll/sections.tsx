import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  DeductionDefinitionView,
  MoneyAmountView,
  PayrollDashboardView,
  PayrollExceptionView,
  PayrollGroupView,
  PayrollPeriodView,
  PayrollRunView,
} from '@work/payroll/contracts';

import { textIn, type Language } from './locale';
import { actionsFor, unresolvedExceptions, withheldBecause } from './lifecycle';

/**
 * The configuration and lifecycle half of the payroll screen: dashboard, groups, deduction
 * definitions, periods, runs, calculation and exceptions.
 *
 * Five things this screen does deliberately.
 *
 * **It renders the amount the API returned and computes nothing.** Not a total, not a proration, not
 * a percentage, and never across currencies. Every amount arrives as an exact decimal string with
 * its currency and exponent; parsing one into a JavaScript number would turn 9,007,199,254,740,993
 * minor units into 9,007,199,254,740,992 and nobody would see where.
 *
 * **It shows employment identifiers, not names.** Resolving an employment to a human being is
 * People's read, behind People's permission — and this screen has not asked.
 *
 * **It never replaces an exception with a zero.** An employment the run could not calculate appears
 * as a named failure with its code, not as somebody paid nothing. Hiding a failed employee from the
 * payroll operator is how a workforce gets underpaid quietly.
 *
 * **It offers only the actions the run's state permits** — and the API refuses them independently.
 * See `lifecycle.ts`: a hidden button has never been a security control, and nothing here pretends
 * otherwise.
 *
 * **It states what this product does not do**, rather than leaving an empty table to imply it
 * failed. No approved overtime, no statutory rules, no journal posting, no payment execution and no
 * document rendering exist in this repository.
 */

export type Translate = (key: string) => string;

export interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

/** An identifier, shortened for a table cell. Never a name this screen does not own. */
export const short = (id: string | undefined): string =>
  id === undefined ? '—' : `${id.slice(0, 8)}…`;

/**
 * An amount, exactly as the API rendered it.
 *
 * `amount` is already a decimal string placed by the module against its own exponent. Nothing here
 * parses, re-formats or rounds it, and the currency code travels beside it because a figure without
 * one is not a figure.
 */
export const money = (amount: MoneyAmountView | undefined): string =>
  amount === undefined ? '—' : `${amount.amount} ${amount.currencyCode}`;

export const instant = (at: Date | string | undefined, language: Language): string => {
  if (at === undefined) return '—';
  return new Date(at).toLocaleString(language === 'ar' ? 'ar' : 'en-GB', { timeZone: 'UTC' });
};

export const Empty = ({ t }: { readonly t: Translate }): ReactNode => (
  <p className="text-sm opacity-70">{t('payroll.notice.empty')}</p>
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
    <dt className="opacity-70">{t(`payroll.label.${label}`)}</dt>
    <dd className="text-lg font-medium">{value}</dd>
  </div>
);

/** A status, translated. This module's own closed vocabulary, so it is this product's to translate. */
export const Status = ({
  t,
  status,
}: {
  readonly t: Translate;
  readonly status: string;
}): ReactNode => (
  <span className="rounded px-2 py-0.5 text-xs">{t(`payroll.status.${status}`)}</span>
);

export const DashboardSection = ({
  t,
  dashboard,
  unavailable,
}: SectionProps & {
  readonly dashboard: PayrollDashboardView | undefined;
  readonly unavailable: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.dashboard')}</h2>

    {unavailable || dashboard === undefined ? (
      <p className="text-sm opacity-70">{t('payroll.notice.unauthenticated')}</p>
    ) : (
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
        <Figure t={t} label="periods" value={dashboard.openPeriods} />
        <Figure t={t} label="approvals" value={dashboard.runsAwaitingApproval} />
        {/* Stale runs and unresolved exceptions are on this view deliberately: they are the two
            numbers that grow when something is quietly not working. */}
        <Figure t={t} label="status" value={dashboard.staleRuns} />
        <Figure t={t} label="exceptions" value={dashboard.unresolvedExceptions} />
        <Figure t={t} label="finalize" value={dashboard.finalizedThisMonth} />
        <Figure t={t} label="groups" value={dashboard.groupsConfigured} />
      </dl>
    )}
  </Card>
);

export const GroupsSection = ({
  t,
  language,
  groups,
}: SectionProps & { readonly groups: readonly PayrollGroupView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.groups')}</h2>

    {groups.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.code')}</th>
            <th className="text-start">{t('payroll.label.group')}</th>
            <th className="text-start">{t('payroll.label.currency')}</th>
            <th className="text-start">{t('payroll.label.proration')}</th>
            <th className="text-start">{t('payroll.label.roundingMode')}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.payrollGroupId}>
              <td>{group.code}</td>
              <td>{textIn(group.name, language)}</td>
              {/* Every permitted currency, never one assumed. Nothing is totalled across them. */}
              <td>{group.permittedCurrencies.join(', ')}</td>
              <td>{group.prorationBasis}</td>
              <td>{group.roundingMode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    {/* No rate, threshold, bracket or authority name ships in this product. */}
    <p className="text-xs opacity-60">{t('payroll.notice.noStatutory')}</p>
  </Card>
);

export const DeductionsSection = ({
  t,
  language,
  definitions,
}: SectionProps & { readonly definitions: readonly DeductionDefinitionView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.deductionDefinitions')}</h2>

    {definitions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.code')}</th>
            <th className="text-start">{t('payroll.label.deductions')}</th>
            <th className="text-start">{t('payroll.label.source')}</th>
            <th className="text-start">{t('payroll.label.amount')}</th>
            <th className="text-start">{t('payroll.label.priority')}</th>
          </tr>
        </thead>
        <tbody>
          {definitions.map((definition) => (
            <tr key={definition.deductionDefinitionId}>
              <td>{definition.code}</td>
              <td>{textIn(definition.name, language)}</td>
              {/* A source, not an interpretation. `statutory` is declared and has no producer. */}
              <td>{definition.deductionSource}</td>
              <td>
                {definition.fixedAmount === undefined
                  ? `${String(definition.basisPoints ?? 0)} bp`
                  : money(definition.fixedAmount)}
              </td>
              <td>{definition.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const PeriodsSection = ({
  t,
  periods,
}: SectionProps & { readonly periods: readonly PayrollPeriodView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.periods')}</h2>

    {periods.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.code')}</th>
            <th className="text-start">{t('payroll.label.periodStart')}</th>
            <th className="text-start">{t('payroll.label.periodEnd')}</th>
            <th className="text-start">{t('payroll.label.paymentDate')}</th>
            <th className="text-start">{t('payroll.label.status')}</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((period) => (
            <tr key={period.payrollPeriodId}>
              <td>{period.code}</td>
              {/* Civil dates, rendered as stored. A period is not an instant in a time zone. */}
              <td>{period.periodStart}</td>
              <td>{period.periodEnd}</td>
              <td>{period.paymentDate}</td>
              <td>
                <Status t={t} status={period.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const RunsSection = ({
  t,
  language,
  runs,
}: SectionProps & { readonly runs: readonly PayrollRunView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.runs')}</h2>

    {runs.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.run')}</th>
            <th className="text-start">{t('payroll.label.status')}</th>
            <th className="text-start">{t('payroll.label.population')}</th>
            <th className="text-start">{t('payroll.label.results')}</th>
            <th className="text-start">{t('payroll.label.exceptionCount')}</th>
            <th className="text-start">{t('payroll.label.complete')}</th>
            <th className="text-start">{t('payroll.label.calculation')}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.payrollRunId}>
              <td>{short(run.payrollRunId)}</td>
              <td>
                <Status t={t} status={run.status} />
              </td>
              <td>{run.populationSize}</td>
              <td>{run.resultCount}</td>
              <td>{run.exceptionCount}</td>
              {/* A run whose cursor has not covered its population cannot be approved. */}
              <td>{run.complete ? '✓' : '—'}</td>
              <td>{instant(run.calculatedAt, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

/**
 * What a payroll operator may do to this run right now, and what they may not.
 *
 * Every action is a link to the API's own endpoint rather than a form that reimplements a rule. The
 * withheld ones carry a sentence saying why, because a control that is simply absent leaves an
 * operator refreshing the page wondering whether it failed to load.
 */
export const CalculationSection = ({
  t,
  run,
  exceptions,
}: SectionProps & {
  readonly run: PayrollRunView | undefined;
  readonly exceptions: readonly PayrollExceptionView[];
}): ReactNode => {
  const permitted = actionsFor(run, exceptions);
  const withheld = withheldBecause(run, exceptions);

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-medium">{t('payroll.label.calculation')}</h2>

      {run === undefined ? (
        <Empty t={t} />
      ) : (
        <>
          <ul className="flex flex-wrap gap-2 text-sm">
            {[...permitted].map((action) => (
              <li key={action} className="rounded border px-3 py-1">
                {t(`payroll.label.${action}`)}
              </li>
            ))}
          </ul>
          {withheld === undefined ? undefined : <p className="text-sm opacity-70">{t(withheld)}</p>}
        </>
      )}
    </Card>
  );
};

/**
 * Every employment the run could not calculate, with the reason.
 *
 * **Never a zero and never a silent omission.** An employment missing its compensation, an unknown
 * leave state, an unreachable Attendance or Organization, a broken eligibility rule, a currency the
 * group does not permit — each is a row here with a translated code, and each is somebody a human
 * has to deal with before the run is finalized.
 */
export const ExceptionsSection = ({
  t,
  language,
  exceptions,
}: SectionProps & { readonly exceptions: readonly PayrollExceptionView[] }): ReactNode => {
  const unresolved = unresolvedExceptions(exceptions);

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-medium">{t('payroll.label.exceptions')}</h2>

      {exceptions.length === 0 ? (
        <Empty t={t} />
      ) : (
        <table className="w-full text-start text-sm">
          <thead className="opacity-70">
            <tr>
              <th className="text-start">{t('payroll.label.employment')}</th>
              <th className="text-start">{t('payroll.label.reason')}</th>
              <th className="text-start">{t('payroll.label.status')}</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map((raised) => (
              <tr key={raised.payrollExceptionId}>
                <td>{short(raised.employmentId)}</td>
                <td>{t(`payroll.exception.${raised.exceptionCode}`)}</td>
                <td>{instant(raised.resolvedAt, language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unresolved.length === 0 ? undefined : (
        <p className="text-sm opacity-70">{t('payroll.notice.unresolvedExceptions')}</p>
      )}
    </Card>
  );
};
