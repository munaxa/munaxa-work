import type { ReactNode } from 'react';

import { loadPayroll } from '../../payroll/api';
import { directionOf, isLanguage, translator, type Language } from '../../payroll/locale';
import {
  CalculationSection,
  DashboardSection,
  DeductionsSection,
  ExceptionsSection,
  GroupsSection,
  PeriodsSection,
  RunsSection,
} from '../../payroll/sections';
import {
  DeductionLinesSection,
  EarningsSection,
  PayslipSection,
  ResultsSection,
} from '../../payroll/results';
import {
  AccountingSection,
  AdjustmentsSection,
  ApprovalsSection,
  FinalizationSection,
  PaymentsSection,
  ReconciliationSection,
  ReportsSection,
} from '../../payroll/outputs';

/**
 * The payroll administration screen.
 *
 * Presentation only: it consumes the module's published contracts through the API and holds no
 * business logic of its own — no rule about who may approve, no arithmetic on an amount, no
 * proration resolved a second time. Those live in the domain and the application service, and a
 * screen that reimplemented them would be a second, weaker answer to a question the API already
 * decided. **It reaches no repository and no database.**
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **It is read-only**, consistent with every module screen before it. Every mutation goes through
 * the API; the write screens are Phase 18/19's, and building them only here would make Payroll the
 * one module with them. The calculation section shows which actions the run's state *permits* rather
 * than performing them — and the API refuses each independently, so nothing here is a security
 * control.
 *
 * **Nothing on this page claims progress this system does not make.** No `posted`, no `executed`,
 * no `generated`. The accounting output is prepared in Payroll's own table and posted nowhere; the
 * payment instruction is prepared and executed by nothing; the payslip is data with no document
 * behind it. Each says so on the card rather than leaving an empty table to imply a failure.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const PayrollPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const payroll = await loadPayroll();
  const shared = { t, language } as const;

  return (
    <div
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('payroll.label.payroll')}</h1>
      </header>

      <DashboardSection
        {...shared}
        dashboard={payroll.dashboard}
        unavailable={payroll.unavailable}
      />
      <GroupsSection {...shared} groups={payroll.groups} />
      <DeductionsSection {...shared} definitions={payroll.definitions} />
      <PeriodsSection {...shared} periods={payroll.periods} />
      <RunsSection {...shared} runs={payroll.runs} />
      <CalculationSection {...shared} run={payroll.run} exceptions={payroll.exceptions} />
      <ExceptionsSection {...shared} exceptions={payroll.exceptions} />
      <ResultsSection {...shared} results={payroll.results} withheld={payroll.figuresWithheld} />
      <EarningsSection {...shared} earnings={payroll.earnings} />
      <DeductionLinesSection {...shared} deductions={payroll.deductions} />
      <ApprovalsSection {...shared} approvals={payroll.approvals} />
      <FinalizationSection {...shared} run={payroll.run} />
      <AdjustmentsSection {...shared} adjustments={payroll.adjustments} />
      <ReconciliationSection {...shared} reconciliation={payroll.reconciliation} />
      <AccountingSection {...shared} accounting={payroll.accounting} />
      <PaymentsSection {...shared} payments={payroll.payments} />
      <PayslipSection {...shared} payslip={payroll.payslip} />
      <ReportsSection {...shared} />
    </div>
  );
};

export default PayrollPage;
