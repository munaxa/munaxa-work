import type { ReactNode } from 'react';
import { KpiGrid, StatCard } from '@munaxa/ui';
import type { DeductionLineView, EarningLineView, PayslipView } from '@work/payroll/contracts';

import {
  Boundaries,
  Cell,
  Clear,
  Fact,
  Facts,
  Isolated,
  Money,
  PayrollSection,
  Reference,
  Row,
  Rows,
  type PayrollProps,
} from './frame';
import { DASH, amountOf, count, day, reference } from './exact';
import type { Language } from './locale';

/**
 * One employment's payroll result, from one bounded read.
 *
 * **The previous screen showed `results.items[0]`** — whichever result happened to be first in a
 * page — as though it were a payslip somebody had chosen. This one is addressed by its own
 * identifier, and an identifier the API will not resolve renders not-found rather than somebody
 * else's pay.
 *
 * **`PayslipView` carries everything on this page in one read**: the period, the payment date, the
 * currency, the three published totals and both line sets. Nothing here asks for earnings or
 * deductions separately — the module returns them together precisely so a screen cannot show one
 * line set from one state beside a total from another.
 *
 * **Three totals, and none of them derived.** Gross, total deductions and net are three fields the
 * module calculated and froze at the table. Net is not gross minus deductions here, no column of
 * lines is summed, and no line is checked against a total. A screen that reproduced the arithmetic
 * would be a second answer that disagrees with the first the day either changes.
 *
 * **It is data, not a document.** Payroll owns the payslip's figures; rendering, storing and
 * delivering a payslip belong to a Document domain that does not exist in this repository, so there
 * is nothing here to open, download or send, and the boundary note says so.
 *
 * **It carries no name.** Payroll holds no personal data at all, so the employment is an identifier
 * and this screen does not invent a person to attach it to.
 */

export interface PayslipProps extends PayrollProps {
  readonly language: Language;
}

/** The three figures the module froze. */
export const PayslipTotals = ({
  t,
  payslip,
}: PayrollProps & { readonly payslip: PayslipView }): ReactNode => (
  <KpiGrid cols={{ base: 3 }}>
    <StatCard label={t('payroll.label.gross')} value={<Money amount={amountOf(payslip.gross)} />} />
    <StatCard
      label={t('payroll.label.totalDeductions')}
      value={<Money amount={amountOf(payslip.totalDeductions)} />}
    />
    <StatCard label={t('payroll.label.net')} value={<Money amount={amountOf(payslip.net)} />} />
  </KpiGrid>
);

export const PayslipSummary = ({
  t,
  payslip,
}: PayrollProps & { readonly payslip: PayslipView }): ReactNode => (
  <Facts>
    <Fact
      label={t('payroll.label.employment')}
      value={<Reference value={reference(payslip.employmentId)} />}
    />
    <Fact label={t('payroll.label.period')} value={<Isolated>{payslip.periodCode}</Isolated>} />
    <Fact
      label={t('payroll.label.periodStart')}
      value={<Isolated>{day(payslip.periodStart)}</Isolated>}
    />
    <Fact
      label={t('payroll.label.periodEnd')}
      value={<Isolated>{day(payslip.periodEnd)}</Isolated>}
    />
    <Fact
      label={t('payroll.label.paymentDate')}
      value={<Isolated>{day(payslip.paymentDate)}</Isolated>}
    />
    <Fact
      label={t('payroll.label.finalized')}
      value={payslip.finalized ? t('payroll.status.finalized') : t('payroll.label.notFinalized')}
    />
  </Facts>
);

/**
 * One line, and the reason the module gives for it.
 *
 * `calculationReason` and the proration in `detail` are the module's own explanation of how a figure
 * came about — the property the audit called explainable payroll — so they are rendered as
 * published and nothing recomputes the basis, the fraction or the rounding.
 */
const proration = (detail: {
  readonly numerator?: number;
  readonly denominator?: number;
}): string =>
  detail.numerator === undefined || detail.denominator === undefined
    ? DASH
    : `${String(detail.numerator)}/${String(detail.denominator)}`;

export const EarningsSection = ({
  t,
  earnings,
}: PayrollProps & { readonly earnings: readonly EarningLineView[] }): ReactNode =>
  earnings.length === 0 ? (
    <Clear t={t} title={t('payroll.label.earnings')} message="payroll.label.noEarnings" />
  ) : (
    <PayrollSection title={t('payroll.label.earnings')}>
      <Rows
        headings={[
          t('payroll.label.sequence'),
          t('payroll.label.code'),
          t('payroll.label.source'),
          t('payroll.label.treatment'),
          t('payroll.label.amount'),
          t('payroll.label.reason'),
          t('payroll.label.proration'),
        ]}
        numeric={[0, 4]}
      >
        {earnings.map((line) => (
          <Row key={line.earningLineId}>
            <Cell numeric>{count(line.sequence)}</Cell>
            <Cell>
              <Isolated>{line.componentCode}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{line.earningSource}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{line.payrollTreatmentCode}</Isolated>
            </Cell>
            <Cell numeric>
              <Money amount={amountOf(line.amount)} />
            </Cell>
            <Cell>
              <Isolated>{line.calculationReason}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{proration(line.detail)}</Isolated>
            </Cell>
          </Row>
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('payroll.notice.noOvertime')}</p>
    </PayrollSection>
  );

export const DeductionLinesSection = ({
  t,
  deductions,
}: PayrollProps & { readonly deductions: readonly DeductionLineView[] }): ReactNode =>
  deductions.length === 0 ? (
    <Clear t={t} title={t('payroll.label.deductions')} message="payroll.label.noDeductions" />
  ) : (
    <PayrollSection title={t('payroll.label.deductions')}>
      <Rows
        headings={[
          t('payroll.label.sequence'),
          t('payroll.label.code'),
          t('payroll.label.source'),
          t('payroll.label.treatment'),
          t('payroll.label.amount'),
          t('payroll.label.reason'),
          t('payroll.label.priority'),
        ]}
        numeric={[0, 4, 6]}
      >
        {deductions.map((line) => (
          <Row key={line.deductionLineId}>
            <Cell numeric>{count(line.sequence)}</Cell>
            <Cell>
              <Isolated>{line.deductionCode}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{line.deductionSource}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{line.payrollTreatmentCode}</Isolated>
            </Cell>
            <Cell numeric>
              <Money amount={amountOf(line.amount)} />
            </Cell>
            <Cell>
              <Isolated>{line.calculationReason}</Isolated>
            </Cell>
            <Cell numeric>{count(line.priority)}</Cell>
          </Row>
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('payroll.notice.noStatutory')}</p>
    </PayrollSection>
  );

/** What the payslip record does not do. */
const PAYSLIP_BOUNDARIES = [
  'payroll.notice.noDocument',
  'payroll.label.boundaryNames',
  'payroll.label.boundaryTotals',
  'payroll.label.boundaryWrites',
  'admin.notice.readOnly',
] as const;

export const PayslipBoundaries = ({ t }: PayrollProps): ReactNode => (
  <Boundaries t={t} keys={PAYSLIP_BOUNDARIES} />
);
