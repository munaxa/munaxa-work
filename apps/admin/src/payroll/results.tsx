import type { ReactNode } from 'react';
import type { PayrollResultView } from '@work/payroll/contracts';

import { TD } from '@munaxa/ui';

import {
  Cell,
  Clear,
  Isolated,
  Money,
  PayrollSection,
  Refused,
  Row,
  Rows,
  shownOf,
  type PayrollProps,
} from './frame';
import { amountOf, count, reference } from './exact';
import type { Language } from './locale';
import type { Listing } from './api';

/**
 * What each employment on this run was paid, and the way into one result.
 *
 * **This is the withheld state Payroll separates its permissions for.** `payroll.read` sees that a
 * run covered fourteen hundred people; `payroll.read-result` sees what a named person was paid. A
 * caller holding the first and not the second reads the run and is refused this section — and the
 * screen says *refused*, naming the permission's own sentence, because "no results" on a run whose
 * own `resultCount` says otherwise is the most misleading thing this screen could print.
 *
 * **Every figure is published.** Gross, total deductions and net are three separate
 * `MoneyAmountView`s the module calculated and froze; net is never gross minus deductions here, no
 * column is totalled, and no two currencies are ever added — Payroll publishes one result per
 * currency and refuses to total across them, so a screen that summed a column would be inventing a
 * figure the domain declines to produce.
 */

export interface ResultsProps extends PayrollProps {
  readonly language: Language;
}

const ResultRow = ({
  t,
  language,
  result,
}: ResultsProps & { readonly result: PayrollResultView }): ReactNode => (
  <Row>
    {/* The employment is what identifies the row, so it is the link. Payroll holds no name for it,
        so the identifier is shown whole — and three rows reading "Open" would identify nothing. */}
    <TD className="whitespace-nowrap font-mono text-xs">
      <a
        href={`/payroll/results/${result.payrollResultId}?lang=${language}`}
        className="underline underline-offset-4"
      >
        <Isolated>{reference(result.employmentId)}</Isolated>
      </a>
    </TD>
    <Cell numeric>
      <Money amount={amountOf(result.gross)} />
    </Cell>
    <Cell numeric>
      <Money amount={amountOf(result.totalDeductions)} />
    </Cell>
    <Cell numeric>
      <Money amount={amountOf(result.net)} />
    </Cell>
    <Cell>
      <Isolated>{count(result.calculationVersion)}</Isolated>
    </Cell>
    <Cell>
      {result.finalized ? t('payroll.status.finalized') : t('payroll.label.notFinalized')}
    </Cell>
  </Row>
);

export const ResultsSection = ({
  t,
  language,
  results,
}: ResultsProps & { readonly results: Listing<PayrollResultView> | undefined }): ReactNode => {
  const title = t('payroll.label.results');

  if (results === undefined) {
    return <Refused t={t} title={title} reason="payroll.label.figuresWithheld" />;
  }
  if (results.items.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.noResults" />;
  }

  return (
    <PayrollSection title={title} description={shownOf(results)}>
      <Rows
        headings={[
          t('payroll.label.employment'),
          t('payroll.label.gross'),
          t('payroll.label.totalDeductions'),
          t('payroll.label.net'),
          t('payroll.label.calculationVersion'),
          t('payroll.label.finalized'),
        ]}
        numeric={[1, 2, 3]}
      >
        {results.items.map((result) => (
          <ResultRow key={result.payrollResultId} t={t} language={language} result={result} />
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('payroll.label.oneResultPerCurrency')}</p>
    </PayrollSection>
  );
};
