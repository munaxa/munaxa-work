import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  AccountingLineView,
  PaymentInstructionView,
  PayrollAdjustmentView,
  PayrollApprovalChainView,
  PayrollReconciliationView,
  PayrollRunView,
} from '@work/payroll/contracts';

import { Empty, Status, instant, money, short, type SectionProps } from './sections';
import { actionsFor } from './lifecycle';

/**
 * What happens after the figures exist: approval, finalization, adjustments, reconciliation, and the
 * two outputs this system prepares and nothing consumes.
 *
 * **The approval chain names humans.** `decidedBy` is taken from the authenticated context and never
 * from a request body, and the database refuses `decided_by = requested_by`. There is no
 * `system:auto-approval` here or anywhere — a payroll approved by nobody is a payroll nobody
 * accepted responsibility for.
 *
 * **The accounting output is prepared, never posted.** There is no Finance module, no ledger and no
 * chart of accounts in this repository; `accountReference` is an opaque code the tenant supplied.
 * The screen says so, because a table headed "accounting" invites the assumption that a journal
 * exists somewhere.
 *
 * **The payment instruction is prepared, never executed.** No account number, no IBAN, no
 * credential, and no status beyond `prepared`. No WPS, Mudad, bank file or transfer exists.
 */

export const ApprovalsSection = ({
  t,
  language,
  approvals,
}: SectionProps & { readonly approvals: PayrollApprovalChainView | undefined }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.approvals')}</h2>

    {approvals === undefined || approvals.steps.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.sequence')}</th>
            <th className="text-start">{t('payroll.label.status')}</th>
            <th className="text-start">{t('payroll.label.decidedBy')}</th>
            <th className="text-start">{t('payroll.label.calculation')}</th>
            <th className="text-start">{t('payroll.label.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {approvals.steps.map((step) => (
            <tr key={`${String(step.sequence)}-${step.decidedBy}`}>
              <td>{step.sequence}</td>
              <td>{step.decision}</td>
              {/* A named human, always. A reversal does not erase the decision it reverses. */}
              <td>{step.decidedBy}</td>
              <td>{instant(step.decidedAt, language)}</td>
              <td>{step.comment ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

/**
 * Finalization: the moment the figures stop being editable.
 *
 * After this no update path can change a result, a line, a snapshot, an accounting line or a payment
 * instruction — a trigger refuses it at the table, from any path including SQL nobody wrote in
 * TypeScript (ADR-0066). The remedy for a wrong finalized run is a reversal, which creates new state
 * rather than editing old state.
 */
export const FinalizationSection = ({
  t,
  language,
  run,
}: SectionProps & { readonly run: PayrollRunView | undefined }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.finalize')}</h2>

    {run === undefined ? (
      <Empty t={t} />
    ) : (
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.status')}</dt>
          <dd>
            <Status t={t} status={run.status} />
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.approvedBy')}</dt>
          <dd>{run.approvedBy ?? '—'}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.finalizedBy')}</dt>
          <dd>{run.finalizedBy ?? '—'}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.accounting')}</dt>
          <dd>{instant(run.accountingPreparedAt, language)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.payment')}</dt>
          <dd>{instant(run.paymentPreparedAt, language)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="opacity-70">{t('payroll.label.reverse')}</dt>
          <dd>{actionsFor(run).has('reverse') ? '✓' : '—'}</dd>
        </div>
      </dl>
    )}
  </Card>
);

/**
 * Adjustments — the figures somebody changed by hand, and why.
 *
 * The **note** is present only for a caller holding `payroll.adjust`: reading a figure is not
 * reading the sentence somebody wrote about why a person's pay changed. Absent is meaningful here,
 * not missing.
 */
export const AdjustmentsSection = ({
  t,
  language,
  adjustments,
}: SectionProps & { readonly adjustments: readonly PayrollAdjustmentView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.adjustments')}</h2>

    {adjustments.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.employment')}</th>
            <th className="text-start">{t('payroll.label.code')}</th>
            <th className="text-start">{t('payroll.label.amount')}</th>
            <th className="text-start">{t('payroll.label.reason')}</th>
            <th className="text-start">{t('payroll.label.decidedBy')}</th>
            <th className="text-start">{t('payroll.label.calculation')}</th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((adjustment) => (
            <tr key={adjustment.payrollAdjustmentId}>
              <td>{short(adjustment.employmentId)}</td>
              <td>{`${adjustment.kind} · ${adjustment.code}`}</td>
              <td>{money(adjustment.amount)}</td>
              {/* The note, where the caller may read it; the code alone where they may not. */}
              <td>{adjustment.note ?? adjustment.reasonCode}</td>
              <td>{adjustment.requestedBy}</td>
              <td>{instant(adjustment.recordedAt, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

/**
 * What reconciliation found. **Nothing here repaired anything.**
 *
 * Reconciliation is a pull: it asks every source whether it has moved since the run was calculated.
 * Correctness never depends on an event having been delivered, which is why a lost event does not
 * silently leave a payroll wrong.
 */
export const ReconciliationSection = ({
  t,
  language,
  reconciliation,
}: SectionProps & {
  readonly reconciliation: readonly PayrollReconciliationView[];
}): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.reconciliation')}</h2>

    {reconciliation.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.employment')}</th>
            <th className="text-start">{t('payroll.label.staleSource')}</th>
            <th className="text-start">{t('payroll.label.calculation')}</th>
          </tr>
        </thead>
        <tbody>
          {reconciliation.map((record) => (
            <tr key={`${record.employmentId}-${record.staleSource}`}>
              <td>{short(record.employmentId)}</td>
              <td>{t(`payroll.label.${record.staleSource}`)}</td>
              <td>{instant(record.detectedAt, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const AccountingSection = ({
  t,
  accounting,
}: SectionProps & { readonly accounting: readonly AccountingLineView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.accounting')}</h2>

    {accounting.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.accountReference')}</th>
            <th className="text-start">{t('payroll.label.debit')}</th>
            <th className="text-start">{t('payroll.label.credit')}</th>
            <th className="text-start">{t('payroll.label.costCentre')}</th>
            <th className="text-start">{t('payroll.label.journalReference')}</th>
          </tr>
        </thead>
        <tbody>
          {accounting.map((line) => (
            <tr key={line.accountingLineId}>
              {/* An opaque tenant code. Payroll owns no chart of accounts. */}
              <td>{line.accountReference}</td>
              <td>{line.direction === 'debit' ? money(line.amount) : '—'}</td>
              <td>{line.direction === 'credit' ? money(line.amount) : '—'}</td>
              <td>{short(line.costCenterId)}</td>
              <td>{line.journalReference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p className="text-xs opacity-60">{t('payroll.notice.noPosting')}</p>
  </Card>
);

export const PaymentsSection = ({
  t,
  payments,
}: SectionProps & { readonly payments: readonly PaymentInstructionView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.payment')}</h2>

    {payments.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('payroll.label.employment')}</th>
            <th className="text-start">{t('payroll.label.amount')}</th>
            <th className="text-start">{t('payroll.label.paymentDate')}</th>
            <th className="text-start">{t('payroll.label.paymentMethod')}</th>
            <th className="text-start">{t('payroll.label.status')}</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((instruction) => (
            <tr key={instruction.paymentInstructionId}>
              <td>{short(instruction.employmentId)}</td>
              <td>{money(instruction.amount)}</td>
              <td>{instruction.paymentDate}</td>
              <td>{instruction.paymentMethodCode}</td>
              {/* `prepared`, and nothing further. There is no `executed`. */}
              <td>
                <Status t={t} status={instruction.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
    <p className="text-xs opacity-60">{t('payroll.notice.noPayment')}</p>
  </Card>
);

/**
 * The reports a payroll operator can actually get, and the ones this product does not produce.
 *
 * Stated rather than omitted. A "Reports" heading over an empty page reads as something broken; a
 * list of what exists and what does not is the honest version, and it is the same list the Phase 11
 * report carries under NOT VERIFIED.
 */
export const ReportsSection = ({ t }: SectionProps): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('payroll.label.reports')}</h2>

    <ul className="flex flex-col gap-1 text-sm">
      <li>{t('payroll.label.results')}</li>
      <li>{t('payroll.label.exceptions')}</li>
      <li>{t('payroll.label.accounting')}</li>
      <li>{t('payroll.label.payment')}</li>
      <li>{t('payroll.label.payslip')}</li>
    </ul>

    <div className="flex flex-col gap-1 text-xs opacity-60">
      <p>{t('payroll.notice.noStatutory')}</p>
      <p>{t('payroll.notice.noPosting')}</p>
      <p>{t('payroll.notice.noPayment')}</p>
      <p>{t('payroll.notice.noDocument')}</p>
      <p>{t('payroll.notice.noOvertime')}</p>
    </div>
  </Card>
);
