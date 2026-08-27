import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { payrollTranslator } from './locale';
import { ExceptionsSection, PostureSection, RunBoundaries, RunCounts, RunSummary } from './run';
import { ResultsSection } from './results';
import {
  AccountingSection,
  AdjustmentsSection,
  ApprovalsSection,
  PaymentsSection,
  ReconciliationSection,
} from './outputs';
import {
  DeductionLinesSection,
  EarningsSection,
  PayslipBoundaries,
  PayslipSummary,
  PayslipTotals,
} from './payslip';
import {
  aBlockingException,
  aPayslip,
  aReversedRun,
  aRun,
  aRunDetail,
  aStaleRun,
  aWithheldRunDetail,
  anEmptyRunDetail,
  anException,
} from './payroll.fixture';

/**
 * The run record and the result record, asserted against the markup.
 *
 * Every assertion is anchored to a rule the authorization stated: no figure is derived, refusal is
 * never emptiness, an amount is rendered as its two published halves, and a specific result is
 * reachable rather than whichever happened to be first.
 */

const en = payrollTranslator('en');
const ar = payrollTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

const escaped = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const record = (
  t: typeof en,
  language: 'en' | 'ar',
  detail: ReturnType<typeof aRunDetail>,
): string =>
  [
    html(<RunCounts t={t} run={detail.run} />),
    html(<RunSummary t={t} language={language} run={detail.run} />),
    html(<PostureSection t={t} run={detail.run} exceptions={detail.exceptions} />),
    html(<ResultsSection t={t} language={language} results={detail.results} />),
    html(<ExceptionsSection t={t} language={language} exceptions={detail.exceptions} />),
    html(<ApprovalsSection t={t} language={language} approvals={detail.approvals} />),
    html(<AdjustmentsSection t={t} language={language} adjustments={detail.adjustments} />),
    html(
      <ReconciliationSection t={t} language={language} reconciliation={detail.reconciliation} />,
    ),
    html(<AccountingSection t={t} accounting={detail.accounting} />),
    html(<PaymentsSection t={t} payments={detail.payments} />),
    html(<RunBoundaries t={t} />),
  ].join('\n');

const payslip = (t: typeof en): string => {
  const data = aPayslip();

  return [
    html(<PayslipTotals t={t} payslip={data} />),
    html(<PayslipSummary t={t} payslip={data} />),
    html(<EarningsSection t={t} earnings={data.earnings} />),
    html(<DeductionLinesSection t={t} deductions={data.deductions} />),
    html(<PayslipBoundaries t={t} />),
  ].join('\n');
};

describe('the payroll run record', () => {
  it('shows the four counts the run reports about itself, not the lengths of its lists', () => {
    const markup = html(<RunCounts t={en} run={aRun()} />);

    // 1,398 results are reported by a run whose page below carries two rows.
    expect(markup).toContain('1402');
    expect(markup).toContain('1398');
    expect(markup).toContain('4');
    expect(markup).toContain('1');
  });

  /** The withheld state Payroll separates four permissions for. */
  it('says the figures were withheld rather than that the run produced nothing', () => {
    const withheld = record(en, 'en', aWithheldRunDetail());
    const empty = record(en, 'en', anEmptyRunDetail());

    expect(withheld).toContain(escaped(en('payroll.label.figuresWithheld')));
    expect(withheld).toContain(en('payroll.label.accountingWithheld'));
    expect(withheld).toContain(en('payroll.label.paymentsWithheld'));
    expect(withheld).not.toContain(en('payroll.label.noResults'));

    expect(empty).toContain(en('payroll.label.noResults'));
    expect(empty).not.toContain(escaped(en('payroll.label.figuresWithheld')));
  });

  it('opens a specific result rather than whichever came first', () => {
    const markup = html(<ResultsSection t={en} language="en" results={aRunDetail().results} />);

    expect(markup).toContain(
      'href="/payroll/results/01900000-0000-7000-8000-0000000000t1?lang=en"',
    );
    expect(markup).toContain(
      'href="/payroll/results/01900000-0000-7000-8000-0000000000t2?lang=en"',
    );
  });

  /**
   * The arithmetic rule, proved against a fixture that would expose it.
   *
   * Gross 1850.000 less deductions 274.500 is 1575.500 — and the fixture's net *is* 1575.500, so a
   * screen that derived it would look right. What must never appear is a *total* of the column: two
   * results in two currencies, and Payroll refuses to add them.
   */
  it('renders each published figure and totals no column', () => {
    const markup = html(<ResultsSection t={en} language="en" results={aRunDetail().results} />);

    expect(markup).toContain('1850.000');
    expect(markup).toContain('274.500');
    expect(markup).toContain('1575.500');
    expect(markup).toContain('JOD');
    expect(markup).toContain('USD');
    // 3700.000 and 3151.000 are what a summed column would produce.
    expect(markup).not.toContain('3700');
    expect(markup).not.toContain('3151');
    expect(markup).toContain(en('payroll.label.oneResultPerCurrency'));
  });

  /** An amount is a figure and a unit, not one concatenated string. */
  it('renders an amount as its two published halves in one isolated run', () => {
    const markup = html(<ResultsSection t={en} language="en" results={aRunDetail().results} />);

    expect(markup).toContain('<bdi><span class="tabular-nums">1850.000</span>');
    expect(markup).not.toContain('1850.000 JOD');
  });

  it('names an exception in words rather than by its code', () => {
    const markup = record(en, 'en', aRunDetail());

    expect(markup).toContain(en('payroll.exception.compensation_missing'));
    expect(markup).not.toContain('compensation_missing');
  });

  it('states what the run’s state permits, and that it is not permission', () => {
    const markup = html(<PostureSection t={en} run={aRun()} exceptions={[anException()]} />);

    expect(markup).toContain(en('payroll.label.approve'));
    expect(markup).toContain(escaped(en('payroll.label.postureIsNotPermission')));
    expect(markup).not.toMatch(/<form|<button/);
  });

  it('withholds approval on a stale run and says why', () => {
    const markup = html(<PostureSection t={en} run={aStaleRun()} exceptions={[]} />);

    expect(markup).not.toContain(`>${en('payroll.label.approve')}<`);
    expect(markup).toContain(en('payroll.notice.staleRun'));
  });

  it('offers nothing at all on a reversed run', () => {
    expect(html(<PostureSection t={en} run={aReversedRun()} exceptions={[]} />)).toContain(
      en('payroll.label.nothingPermitted'),
    );
  });

  it('withholds finalization while a blocking exception is unresolved', () => {
    const markup = html(<PostureSection t={en} run={aRun()} exceptions={[aBlockingException()]} />);

    expect(markup).toContain(en('payroll.notice.unresolvedExceptions'));
  });

  it('links a reversal to the run it reverses', () => {
    const markup = html(<RunSummary t={en} language="en" run={aReversedRun()} />);

    expect(markup).toContain('href="/payroll/runs/01900000-0000-7000-8000-0000000000n2?lang=en"');
  });

  it('keeps an employment as a whole identifier and says why no name is shown', () => {
    const markup = record(en, 'en', aRunDetail());

    expect(markup).toContain('01900000-0000-7000-8000-0000000000e1');
    expect(markup).toContain(en('payroll.label.boundaryNames'));
  });

  it('renders in Arabic with every amount and code isolated', () => {
    const markup = record(ar, 'ar', aRunDetail());

    expect(markup).toContain('<bdi>regular</bdi>');
    expect(markup).toContain(ar('payroll.label.population'));
    const leaked = [...markup.matchAll(/payroll\.label\.[a-zA-Z_]+/g)].map((m) => m[0]);

    expect(leaked).toEqual([]);
  });

  it('offers no control anywhere on the record', () => {
    expect(record(en, 'en', aRunDetail())).not.toMatch(/<form|<button|<input|<select|<textarea/);
  });
});

describe('the payroll result record', () => {
  it('shows the three frozen totals and derives none of them', () => {
    const markup = payslip(en);

    expect(markup).toContain('1850.000');
    expect(markup).toContain('274.500');
    expect(markup).toContain('1575.500');
    expect(markup).toContain(escaped(en('payroll.label.boundaryTotals')));
  });

  it('names the period the payslip itself publishes', () => {
    const markup = payslip(en);

    expect(markup).toContain('2026-08');
    expect(markup).toContain('2026-08-01');
    expect(markup).toContain('2026-08-28');
  });

  it('shows both line sets from the one read and sums neither', () => {
    const markup = payslip(en);

    expect(markup).toContain('BASIC');
    expect(markup).toContain('TRANSPORT');
    expect(markup).toContain('SOCIAL');
    // 1600.000 + 250.000 is the gross the module already published; a summed column would repeat it
    // in the lines table, where no total belongs.
    expect(markup).not.toMatch(/BASIC[\s\S]*1850\.000[\s\S]*TRANSPORT/);
  });

  it('says it is data rather than a document', () => {
    expect(payslip(en)).toContain(en('payroll.notice.noDocument'));
  });

  it('shows no name for the employment it belongs to', () => {
    const markup = payslip(en);

    expect(markup).toContain('01900000-0000-7000-8000-0000000000e1');
    expect(markup).toContain(en('payroll.label.boundaryNames'));
  });

  it('renders in Arabic with every figure isolated', () => {
    const markup = payslip(ar);

    expect(markup).toContain('<bdi>2026-08</bdi>');
    expect(markup).toContain(ar('payroll.label.net'));
    expect(markup).not.toContain('payroll.label.');
  });

  it('offers no control', () => {
    expect(payslip(en)).not.toMatch(/<form|<button|<input|<select|<textarea/);
  });
});
