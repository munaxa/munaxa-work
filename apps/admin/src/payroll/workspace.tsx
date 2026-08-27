import type { ReactNode } from 'react';
import { KpiGrid, StatCard } from '@munaxa/ui';
import type { PayrollDashboardView, PayrollRunView } from '@work/payroll/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Isolated,
  PayrollSection,
  Refused,
  Row,
  Rows,
  Term,
  shownOf,
  type PayrollProps,
} from './frame';
import { DASH, count, instant } from './exact';
import type { Language } from './locale';
import { RUN_TONE } from './tones';
import type { Listing, PayrollWorkspace } from './api';

/**
 * The payroll workspace: what the tenant's payroll is doing, and every run somebody can open.
 *
 * The screen this replaced was eighteen stacked cards, most of them about *one* run that the
 * composition had chosen by taking the first row of a page. An operator could not look at last
 * month's payroll and had nothing telling them they were not already looking at it. Here the runs
 * are a list and each one opens.
 *
 * **Every figure is the server's.** The five overview figures are `PayrollDashboardView`'s own
 * counts; the run counts are the run's own `populationSize`, `resultCount`, `exceptionCount` and
 * `staleCount`; the totals beside each section are `PagedResult.total`. Nothing here totals a
 * column, works out which run is current, or derives one count from another.
 *
 * **The runs are in the server's order.** `payroll.runs` publishes no ordering parameter and no
 * "current" flag, so the page is rendered as it arrived. A screen that sorted it, or picked a
 * newest, would be inventing a rule Payroll does not have.
 */

export interface WorkspaceProps extends PayrollProps {
  readonly language: Language;
}

/** The five figures the workspace opens with, each one counted by the server. */
export const PayrollOverview = ({
  t,
  dashboard,
}: PayrollProps & { readonly dashboard: PayrollDashboardView | undefined }): ReactNode => (
  <KpiGrid cols={{ base: 2, md: 5 }}>
    <StatCard
      label={t('payroll.label.openPeriods')}
      value={dashboard === undefined ? DASH : count(dashboard.openPeriods)}
    />
    <StatCard
      label={t('payroll.label.awaitingApproval')}
      value={dashboard === undefined ? DASH : count(dashboard.runsAwaitingApproval)}
    />
    <StatCard
      label={t('payroll.label.staleRuns')}
      value={dashboard === undefined ? DASH : count(dashboard.staleRuns)}
    />
    <StatCard
      label={t('payroll.label.unresolvedExceptions')}
      value={dashboard === undefined ? DASH : count(dashboard.unresolvedExceptions)}
    />
    <StatCard
      label={t('payroll.label.finalizedThisMonth')}
      value={dashboard === undefined ? DASH : count(dashboard.finalizedThisMonth)}
    />
  </KpiGrid>
);

/**
 * One run in the list.
 *
 * The run number and its kind are what a payroll operator names a run by; the period is the
 * identifier Payroll stores, because the module publishes no read of a period by identifier and a
 * code guessed from a page of periods would be right until the page moved.
 */
const RunRow = ({
  t,
  language,
  run,
}: WorkspaceProps & { readonly run: PayrollRunView }): ReactNode => (
  <Row>
    <Cell>
      <a
        href={`/payroll/runs/${run.payrollRunId}?lang=${language}`}
        className="underline underline-offset-4"
      >
        <Isolated>{count(run.runSequence)}</Isolated>
      </a>
    </Cell>
    <Cell>
      <Isolated>{run.runKind}</Isolated>
    </Cell>
    <Cell>
      <Term t={t} group="status" value={run.status} tone={RUN_TONE[run.status]} />
    </Cell>
    <Cell numeric>{count(run.populationSize)}</Cell>
    <Cell numeric>{count(run.resultCount)}</Cell>
    <Cell numeric>{count(run.exceptionCount)}</Cell>
    <Cell>
      <Isolated>{instant(run.calculatedAt, language)}</Isolated>
    </Cell>
  </Row>
);

export const RunsSection = ({
  t,
  language,
  runs,
}: WorkspaceProps & { readonly runs: Listing<PayrollRunView> | undefined }): ReactNode => {
  const title = t('payroll.label.runs');

  if (runs === undefined) return <Refused t={t} title={title} />;
  if (runs.items.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.noRuns" />;
  }

  return (
    <PayrollSection title={title} description={shownOf(runs)}>
      <Rows
        headings={[
          t('payroll.label.run'),
          t('payroll.label.runKind'),
          t('payroll.label.status'),
          t('payroll.label.population'),
          t('payroll.label.results'),
          t('payroll.label.exceptions'),
          t('payroll.label.calculatedAt'),
        ]}
        numeric={[3, 4, 5]}
      >
        {runs.items.map((run) => (
          <RunRow key={run.payrollRunId} t={t} language={language} run={run} />
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('payroll.label.runsAreServerOrdered')}</p>
    </PayrollSection>
  );
};

/** What the workspace does not do, said rather than left as an absence. */
const WORKSPACE_BOUNDARIES = [
  'payroll.label.boundaryWrites',
  'payroll.notice.noStatutory',
  'payroll.notice.noPosting',
  'payroll.notice.noPayment',
  'payroll.notice.noDocument',
  'payroll.label.boundaryNames',
  'admin.notice.readOnly',
] as const;

export const WorkspaceBoundaries = ({ t }: PayrollProps): ReactNode => (
  <Boundaries t={t} keys={WORKSPACE_BOUNDARIES} />
);

/** True when not one of the workspace's reads answered — the ordinary state of this deployment. */
export const answeredNothing = (workspace: PayrollWorkspace): boolean =>
  workspace.dashboard === undefined &&
  workspace.runs === undefined &&
  workspace.periods === undefined &&
  workspace.groups === undefined;
