import type { ReactNode } from 'react';
import { Badge, Inline, KpiGrid, StatCard } from '@munaxa/ui';
import type { PayrollExceptionView, PayrollRunView } from '@work/payroll/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Fact,
  Facts,
  Identifier,
  Isolated,
  PayrollSection,
  Reference,
  Refused,
  Row,
  Rows,
  type PayrollProps,
  type Tone,
} from './frame';
import { DASH, count, instant, reference } from './exact';
import type { Language } from './locale';
import { RUN_TONE } from './tones';
import { actionsFor, unresolvedExceptions, withheldBecause } from './lifecycle';

/**
 * One payroll run: what it covered, under which rules, where it stands, and what it could not do.
 *
 * **The run is the subject and it is named, not implied.** The previous screen described whichever
 * run happened to be first in a page and gave no way to reach another; here the run arrives from its
 * own bounded read, keyed on the identifier in the route, and an identifier the API will not resolve
 * renders not-found rather than a page about somebody else's payroll.
 *
 * **The four counts are the run's own fields**, not the lengths of the lists below them. A run
 * publishes `populationSize`, `resultCount`, `exceptionCount` and `staleCount`; a screen that
 * counted the rows it had been given would report a page as a payroll.
 *
 * **What the run's state permits is a statement, not a control.** Calculating, approving,
 * finalizing and reversing are writes and no request from this portal carries a principal. The API
 * refuses each independently — `run_finalized`, `run_is_stale`, `run_has_unresolved_exceptions` —
 * so nothing here is a security control; it is the run's posture, written down.
 */

export interface RunProps extends PayrollProps {
  readonly language: Language;
}

export const runTone = (status: string): Tone => RUN_TONE[status] ?? 'muted';

/** The four figures the run reports about itself. */
export const RunCounts = ({
  t,
  run,
}: PayrollProps & { readonly run: PayrollRunView }): ReactNode => (
  <KpiGrid cols={{ base: 2, md: 4 }}>
    <StatCard label={t('payroll.label.population')} value={count(run.populationSize)} />
    <StatCard label={t('payroll.label.results')} value={count(run.resultCount)} />
    <StatCard label={t('payroll.label.exceptions')} value={count(run.exceptionCount)} />
    <StatCard label={t('payroll.label.staleCount')} value={count(run.staleCount)} />
  </KpiGrid>
);

/** The run this one reverses, when it reverses one. A bounded read stands behind the link. */
const Reversal = ({ t, language, run }: RunProps & { readonly run: PayrollRunView }): ReactNode =>
  run.reversalOfRunId === undefined ? (
    <span>{DASH}</span>
  ) : (
    <a
      href={`/payroll/runs/${run.reversalOfRunId}?lang=${language}`}
      className="underline underline-offset-4"
    >
      {t('payroll.label.openTheReversedRun')}
    </a>
  );

/**
 * When the run reached each of its states.
 *
 * Four published instants and no arithmetic between them: no elapsed time, no age, no "approved
 * within". Payroll records the moments; how long anything took is a question it does not answer.
 */
const Timing = ({ t, language, run }: RunProps & { readonly run: PayrollRunView }): ReactNode => (
  <>
    <Fact
      label={t('payroll.label.calculatedAt')}
      value={<Isolated>{instant(run.calculatedAt, language)}</Isolated>}
    />
    <Fact
      label={t('payroll.label.approvedAt')}
      value={<Isolated>{instant(run.approvedAt, language)}</Isolated>}
    />
    <Fact
      label={t('payroll.label.finalizedAt')}
      value={<Isolated>{instant(run.finalizedAt, language)}</Isolated>}
    />
    <Fact
      label={t('payroll.label.staleDetectedAt')}
      value={<Isolated>{instant(run.staleDetectedAt, language)}</Isolated>}
    />
  </>
);

/** Who answered for the run, as the memberships Payroll stores. It holds no name for either. */
const Deciders = ({ t, run }: PayrollProps & { readonly run: PayrollRunView }): ReactNode => (
  <>
    <Fact
      label={t('payroll.label.approvedBy')}
      value={<Reference value={reference(run.approvedBy)} />}
    />
    <Fact
      label={t('payroll.label.finalizedBy')}
      value={<Reference value={reference(run.finalizedBy)} />}
    />
  </>
);

export const RunSummary = ({
  t,
  language,
  run,
}: RunProps & { readonly run: PayrollRunView }): ReactNode => (
  <Facts>
    <Fact label={t('payroll.label.runKind')} value={<Isolated>{run.runKind}</Isolated>} />
    <Fact
      label={t('payroll.label.period')}
      value={<Reference value={reference(run.payrollPeriodId)} />}
    />
    <Fact
      label={t('payroll.label.group')}
      value={<Reference value={reference(run.payrollGroupId)} />}
    />
    <Timing t={t} language={language} run={run} />
    <Fact
      label={t('payroll.label.countryPack')}
      value={<Reference value={reference(run.countryPackId)} />}
    />
    <Deciders t={t} run={run} />
    {/* The cursor has covered the population, or it has not. A partial run cannot be approved, so
        this is a fact an operator acts on rather than a detail of the calculation. */}
    <Fact
      label={t('payroll.label.complete')}
      value={run.complete ? t('payroll.label.covered') : t('payroll.label.notCovered')}
    />
    <Fact
      label={t('payroll.label.reversalOf')}
      value={<Reversal t={t} language={language} run={run} />}
    />
  </Facts>
);

/**
 * What this run's state permits, and the sentence saying why the rest is not offered.
 *
 * Rendered as words rather than as controls, because every one of them is a write this portal
 * cannot make. A reader learns that a finalized run's only remedy is a reversal — which is the
 * useful half of what a control would have told them.
 */
export const PostureSection = ({
  t,
  run,
  exceptions,
}: PayrollProps & {
  readonly run: PayrollRunView;
  readonly exceptions: readonly PayrollExceptionView[] | undefined;
}): ReactNode => {
  const raised = exceptions ?? [];
  const permitted = [...actionsFor(run, raised)];
  const withheld = withheldBecause(run, raised);

  return (
    <PayrollSection title={t('payroll.label.statePermits')}>
      {permitted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('payroll.label.nothingPermitted')}</p>
      ) : (
        <Inline gap={2} wrap>
          {permitted.map((action) => (
            <Badge key={action} tone="muted">
              {t(`payroll.label.${action}`)}
            </Badge>
          ))}
        </Inline>
      )}
      {withheld === undefined ? undefined : (
        <p className="text-sm text-muted-foreground">{t(withheld)}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('payroll.label.postureIsNotPermission')}</p>
    </PayrollSection>
  );
};

/**
 * Every employment the run could not calculate, with the reason in words.
 *
 * The exception codes are Payroll's own closed set and ship translated, so an operator reads "No
 * compensation for this period" rather than `compensation_missing`.
 */
export const ExceptionsSection = ({
  t,
  language,
  exceptions,
}: RunProps & { readonly exceptions: readonly PayrollExceptionView[] | undefined }): ReactNode => {
  const title = t('payroll.label.exceptions');

  if (exceptions === undefined) return <Refused t={t} title={title} />;
  if (exceptions.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.noExceptions" />;
  }

  const open = unresolvedExceptions(exceptions).length;

  return (
    <PayrollSection
      title={title}
      description={
        <>
          {t('payroll.label.unresolved')}: <Isolated>{count(open)}</Isolated>
        </>
      }
    >
      <Rows
        headings={[
          t('payroll.label.employment'),
          t('payroll.label.reason'),
          t('payroll.label.resolvedAt'),
        ]}
      >
        {exceptions.map((raised) => (
          <Row key={raised.payrollExceptionId}>
            <Identifier value={reference(raised.employmentId)} />
            <Cell>{t(`payroll.exception.${raised.exceptionCode}`)}</Cell>
            <Cell>
              <Isolated>{instant(raised.resolvedAt, language)}</Isolated>
            </Cell>
          </Row>
        ))}
      </Rows>
    </PayrollSection>
  );
};

/** What the run record does not do. */
const RUN_BOUNDARIES = [
  'payroll.label.boundaryWrites',
  'payroll.notice.noStatutory',
  'payroll.label.boundaryFigures',
  'payroll.label.boundaryNames',
  'payroll.notice.noPosting',
  'payroll.notice.noPayment',
  'admin.notice.readOnly',
] as const;

export const RunBoundaries = ({ t }: PayrollProps): ReactNode => (
  <Boundaries t={t} keys={RUN_BOUNDARIES} />
);
