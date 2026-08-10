import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  DeductionLineView,
  EarningLineView,
  PayrollResultView,
  PayslipView,
} from '@work/payroll/contracts';

import { Empty, Status, instant, money, short, type SectionProps } from './sections';

/**
 * The figures: what each person was paid, why each line exists, and the payslip data.
 *
 * **Every one of these reads sits behind `payroll.read-result`**, not `payroll.read`. Somebody who
 * administers the payroll calendar sees that a run covered 1,400 people; only somebody holding this
 * permission sees what any named person was paid. When the API withholds them, this screen says so
 * — an empty table beside a run reporting 1,400 results would read as a failure rather than as the
 * permission boundary it is.
 *
 * **Nothing here is totalled across currencies.** A result is one employment in one currency; an
 * employment paid in two is two rows and no sum. There is no exchange-rate service in this
 * repository and inventing a rate on a screen would be the worst possible place to put one.
 *
 * **Every amount is the exact string the API sent.** A gross above 2^53 minor units survives to the
 * cell because nothing on the path calls `Number`.
 */

export const ResultsSection = ({
  t,
  results,
  withheld,
}: SectionProps & {
  readonly results: readonly PayrollResultView[];
  readonly withheld: boolean;
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.results')}</h2>

    {withheld ? (
      <p className="text-sm opacity-70">{t('payroll.notice.unauthenticated')}</p>
    ) : results.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.employment')}</th>
            <th className="text-start">{t('payroll.label.currency')}</th>
            <th className="text-start">{t('payroll.label.gross')}</th>
            <th className="text-start">{t('payroll.label.totalDeductions')}</th>
            <th className="text-start">{t('payroll.label.net')}</th>
            <th className="text-start">{t('payroll.label.status')}</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.payrollResultId}>
              <td>{short(result.employmentId)}</td>
              <td>{result.currencyCode}</td>
              <td>{money(result.gross)}</td>
              <td>{money(result.totalDeductions)}</td>
              <td>{money(result.net)}</td>
              <td>{result.finalized ? t('payroll.status.finalized') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

/**
 * The earning lines, each explaining itself.
 *
 * `detail` carries the basis, the numerator, the denominator and the rounding mode, so a person who
 * disputes a figure can be shown the arithmetic rather than told the system computed it.
 * `attendance_overtime` is a declared source with **no producer**: Attendance publishes candidate
 * minutes and a candidate is not an approved fact (ADR-0065).
 */
export const EarningsSection = ({
  t,
  earnings,
}: SectionProps & { readonly earnings: readonly EarningLineView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.earnings')}</h2>

    {earnings.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.sequence')}</th>
            <th className="text-start">{t('payroll.label.source')}</th>
            <th className="text-start">{t('payroll.label.code')}</th>
            <th className="text-start">{t('payroll.label.treatment')}</th>
            <th className="text-start">{t('payroll.label.amount')}</th>
            <th className="text-start">{t('payroll.label.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {earnings.map((line) => (
            <tr key={line.earningLineId}>
              <td>{line.sequence}</td>
              <td>{line.earningSource}</td>
              <td>{line.componentCode}</td>
              {/* A treatment code, uninterpreted. What "ordinary" means for tax is a
                  jurisdictional question this product does not answer. */}
              <td>{line.payrollTreatmentCode}</td>
              <td>{money(line.amount)}</td>
              <td>{line.calculationReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p className="text-xs opacity-60">{t('payroll.notice.noOvertime')}</p>
  </Card>
);

/** The deduction lines, in priority order — the order they were applied in. */
export const DeductionLinesSection = ({
  t,
  deductions,
}: SectionProps & { readonly deductions: readonly DeductionLineView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.deductions')}</h2>

    {deductions.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.priority')}</th>
            <th className="text-start">{t('payroll.label.source')}</th>
            <th className="text-start">{t('payroll.label.code')}</th>
            <th className="text-start">{t('payroll.label.treatment')}</th>
            <th className="text-start">{t('payroll.label.amount')}</th>
            <th className="text-start">{t('payroll.label.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {deductions.map((line) => (
            <tr key={line.deductionLineId}>
              <td>{line.priority}</td>
              <td>{line.deductionSource}</td>
              <td>{line.deductionCode}</td>
              <td>{line.payrollTreatmentCode}</td>
              <td>{money(line.amount)}</td>
              <td>{line.calculationReason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

/**
 * The payslip **data**, and only the data.
 *
 * Payroll owns these rows. Rendering them into a document, storing it and delivering it belong to a
 * Document domain that does not exist in this repository — there is no `DocumentPort`, no PDF and
 * no file. The screen says that rather than showing a download button that would produce nothing.
 *
 * It carries no name and no personal data: whatever eventually renders it resolves those under its
 * own permissions (ADR-0038).
 */
export const PayslipSection = ({
  t,
  language,
  payslip,
}: SectionProps & { readonly payslip: PayslipView | undefined }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.payslip')}</h2>

    {payslip === undefined ? (
      <Empty t={t} />
    ) : (
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.employment')}</dt>
          <dd>{short(payslip.employmentId)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.period')}</dt>
          <dd>{payslip.periodCode}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.paymentDate')}</dt>
          <dd>{payslip.paymentDate}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.gross')}</dt>
          <dd className="font-medium">{money(payslip.gross)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.totalDeductions')}</dt>
          <dd className="font-medium">{money(payslip.totalDeductions)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.net')}</dt>
          <dd className="font-medium">{money(payslip.net)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.status')}</dt>
          <dd>
            <Status t={t} status={payslip.finalized ? 'finalized' : 'calculated'} />
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.result')}</dt>
          <dd>{instant(undefined, language)}</dd>
        </div>
      </dl>
    )}
    <p className="text-xs opacity-60">{t('payroll.notice.noDocument')}</p>
  </Card>
);
