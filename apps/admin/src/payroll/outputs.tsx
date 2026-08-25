import type { ReactNode } from 'react';
import type {
  AccountingLineView,
  PaymentInstructionView,
  PayrollAdjustmentView,
  PayrollApprovalChainView,
  PayrollReconciliationView,
} from '@work/payroll/contracts';

import {
  Cell,
  Clear,
  Identifier,
  Isolated,
  Money,
  PayrollSection,
  Refused,
  Row,
  Rows,
  Term,
  shownOf,
  type PayrollProps,
} from './frame';
import { DASH, amountOf, count, day, instant, reference } from './exact';
import type { Language } from './locale';
import { APPROVAL_TONE, INSTRUCTION_TONE } from './tones';
import type { Listing } from './api';

/**
 * What happened to the run after it was calculated: who answered, what moved, and what was prepared.
 *
 * **Three of these four sections stand on their own permission.** The approval chain and the
 * reconciliation are `payroll.read`; the accounting output is `payroll.accounting`; the payment
 * instructions are `payroll.payment`. A caller can be shown the run, refused the journal, and shown
 * the instructions — and each section says which of those happened to it rather than rendering an
 * empty table that reads as "nothing was prepared".
 *
 * **Nothing here claims progress this system does not make.** The accounting output is prepared in
 * Payroll's own table and posted to no ledger; a payment instruction is prepared and executed by
 * nothing, and carries no account number, IBAN or credential by contract. Both say so.
 */

export interface OutputsProps extends PayrollProps {
  readonly language: Language;
}

export const ApprovalsSection = ({
  t,
  language,
  approvals,
}: OutputsProps & { readonly approvals: PayrollApprovalChainView | undefined }): ReactNode => {
  const title = t('payroll.label.approvals');

  if (approvals === undefined) return <Refused t={t} title={title} />;
  if (approvals.steps.length === 0) {
    return (
      <Clear
        t={t}
        title={title}
        message={
          approvals.required ? 'payroll.label.noDecisionsYet' : 'payroll.label.noApprovalRequired'
        }
      />
    );
  }

  return (
    <PayrollSection
      title={title}
      description={
        <Term t={t} group="status" value={approvals.state} tone={APPROVAL_TONE[approvals.state]} />
      }
    >
      <Rows
        headings={[
          t('payroll.label.sequence'),
          t('payroll.label.decision'),
          t('payroll.label.decidedBy'),
          t('payroll.label.decidedAt'),
          t('payroll.label.note'),
          t('payroll.label.reverses'),
        ]}
        numeric={[0]}
      >
        {approvals.steps.map((step) => (
          <Row key={`${String(step.sequence)}-${step.decidedBy}`}>
            <Cell numeric>{count(step.sequence)}</Cell>
            <Cell>
              <Term
                t={t}
                group="status"
                value={step.decision}
                tone={APPROVAL_TONE[step.decision]}
              />
            </Cell>
            <Identifier value={reference(step.decidedBy)} />
            <Cell>
              <Isolated>{instant(step.decidedAt, language)}</Isolated>
            </Cell>
            <Cell>{step.comment === undefined ? DASH : <Isolated>{step.comment}</Isolated>}</Cell>
            <Identifier value={reference(step.reversesDecisionId)} />
          </Row>
        ))}
      </Rows>
    </PayrollSection>
  );
};

/**
 * Every adjustment recorded against the run.
 *
 * An adjustment's `note` is published **only to a caller holding `payroll.adjust`** — the module
 * separates reading a figure from reading the sentence behind it — so an absent note here is a
 * boundary rather than an omission, and the dash says so.
 */
export const AdjustmentsSection = ({
  t,
  language,
  adjustments,
}: OutputsProps & {
  readonly adjustments: readonly PayrollAdjustmentView[] | undefined;
}): ReactNode => {
  const title = t('payroll.label.adjustments');

  if (adjustments === undefined) return <Refused t={t} title={title} />;
  if (adjustments.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.noAdjustments" />;
  }

  return (
    <PayrollSection title={title}>
      <Rows
        headings={[
          t('payroll.label.employment'),
          t('payroll.label.code'),
          t('payroll.label.amount'),
          t('payroll.label.reason'),
          t('payroll.label.note'),
          t('payroll.label.recordedAt'),
        ]}
        numeric={[2]}
      >
        {adjustments.map((adjustment) => (
          <Row key={adjustment.payrollAdjustmentId}>
            <Identifier value={reference(adjustment.employmentId)} />
            <Cell>
              <Isolated>{adjustment.code}</Isolated>
            </Cell>
            <Cell numeric>
              <Money amount={amountOf(adjustment.amount)} />
            </Cell>
            <Cell>
              <Isolated>{adjustment.reasonCode}</Isolated>
            </Cell>
            <Cell>
              {adjustment.note === undefined ? DASH : <Isolated>{adjustment.note}</Isolated>}
            </Cell>
            <Cell>
              <Isolated>{instant(adjustment.recordedAt, language)}</Isolated>
            </Cell>
          </Row>
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">
        {t('payroll.label.noteNeedsAdjustPermission')}
      </p>
    </PayrollSection>
  );
};

export const ReconciliationSection = ({
  t,
  language,
  reconciliation,
}: OutputsProps & {
  readonly reconciliation: readonly PayrollReconciliationView[] | undefined;
}): ReactNode => {
  const title = t('payroll.label.reconciliation');

  if (reconciliation === undefined) return <Refused t={t} title={title} />;
  if (reconciliation.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.nothingMoved" />;
  }

  return (
    <PayrollSection title={title}>
      <Rows
        headings={[
          t('payroll.label.employment'),
          t('payroll.label.staleSource'),
          t('payroll.label.detectedAt'),
        ]}
      >
        {reconciliation.map((record) => (
          <Row key={`${record.employmentId}-${record.staleSource}`}>
            <Identifier value={reference(record.employmentId)} />
            <Cell>{t(`payroll.label.${record.staleSource}`)}</Cell>
            <Cell>
              <Isolated>{instant(record.detectedAt, language)}</Isolated>
            </Cell>
          </Row>
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('payroll.notice.staleRun')}</p>
    </PayrollSection>
  );
};

export const AccountingSection = ({
  t,
  accounting,
}: PayrollProps & { readonly accounting: Listing<AccountingLineView> | undefined }): ReactNode => {
  const title = t('payroll.label.accounting');

  if (accounting === undefined) {
    return <Refused t={t} title={title} reason="payroll.label.accountingWithheld" />;
  }
  if (accounting.items.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.noAccounting" />;
  }

  return (
    <PayrollSection title={title} description={shownOf(accounting)}>
      <Rows
        headings={[
          t('payroll.label.employment'),
          t('payroll.label.direction'),
          t('payroll.label.accountReference'),
          t('payroll.label.costCentre'),
          t('payroll.label.amount'),
          t('payroll.label.journalReference'),
        ]}
        numeric={[4]}
      >
        {accounting.items.map((line) => (
          <Row key={line.accountingLineId}>
            <Identifier value={reference(line.employmentId)} />
            <Cell>{t(`payroll.label.${line.direction}`)}</Cell>
            <Cell>
              <Isolated>{line.accountReference}</Isolated>
            </Cell>
            <Identifier value={reference(line.costCenterId)} />
            <Cell numeric>
              <Money amount={amountOf(line.amount)} />
            </Cell>
            <Cell>
              <Isolated>{line.journalReference}</Isolated>
            </Cell>
          </Row>
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('payroll.notice.noPosting')}</p>
    </PayrollSection>
  );
};

export const PaymentsSection = ({
  t,
  payments,
}: PayrollProps & {
  readonly payments: Listing<PaymentInstructionView> | undefined;
}): ReactNode => {
  const title = t('payroll.label.payment');

  if (payments === undefined) {
    return <Refused t={t} title={title} reason="payroll.label.paymentsWithheld" />;
  }
  if (payments.items.length === 0) {
    return <Clear t={t} title={title} message="payroll.label.noPayments" />;
  }

  return (
    <PayrollSection title={title} description={shownOf(payments)}>
      <Rows
        headings={[
          t('payroll.label.employment'),
          t('payroll.label.amount'),
          t('payroll.label.paymentDate'),
          t('payroll.label.paymentMethod'),
          t('payroll.label.status'),
        ]}
        numeric={[1]}
      >
        {payments.items.map((instruction) => (
          <Row key={instruction.paymentInstructionId}>
            <Identifier value={reference(instruction.employmentId)} />
            <Cell numeric>
              <Money amount={amountOf(instruction.amount)} />
            </Cell>
            <Cell>
              <Isolated>{day(instruction.paymentDate)}</Isolated>
            </Cell>
            <Cell>
              <Isolated>{instruction.paymentMethodCode}</Isolated>
            </Cell>
            <Cell>
              <Term
                t={t}
                group="status"
                value={instruction.status}
                tone={INSTRUCTION_TONE[instruction.status]}
              />
            </Cell>
          </Row>
        ))}
      </Rows>
      <p className="text-xs text-muted-foreground">{t('payroll.notice.noPayment')}</p>
    </PayrollSection>
  );
};
