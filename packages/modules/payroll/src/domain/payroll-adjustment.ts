import type { MoneyAmount } from './money-amount.js';
import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import { isAdjustmentKind, isCode, type AdjustmentKind } from './payroll-vocabulary.js';

/**
 * An adjustment: a line somebody added deliberately, with a sentence explaining why.
 *
 * **The reason code and the written note are both required**, which is the Phase 10 precedent and
 * carries the same argument: a figure changed on somebody's pay without a sentence explaining why is
 * an audit finding waiting to happen. The note is separately permissioned from the amounts —
 * reading a figure is not reading the reason behind it.
 *
 * An adjustment never edits a calculated line. It produces a **new** line, so the calculation and
 * the intervention remain distinguishable on the payslip and in the audit trail.
 *
 * A **retroactive** adjustment references a prior period and run, and is paid in the *current*
 * period. The closed period's figures never move: restating a closed period invalidates an
 * accounting output that may already have left the system, and a current-period correction line is
 * visible on a payslip the employee can question.
 */

export interface PayrollAdjustmentState {
  readonly payrollAdjustmentId: string;
  readonly payrollRunId: string;
  readonly employmentId: string;
  readonly kind: AdjustmentKind;
  readonly code: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmount;
  readonly reasonCode: string;
  /** The sentence. Behind `payroll.adjust`, never on a general result read. */
  readonly note: string;
  /** Set where this corrects a prior period, paid in the current one. */
  readonly retroactiveOfPeriodId?: string;
  readonly retroactiveOfRunId?: string;
  readonly requestedBy: string;
  readonly recordedAt: Date;
  readonly version: number;
}

export interface RecordAdjustment {
  readonly payrollAdjustmentId: string;
  readonly payrollRunId: string;
  readonly employmentId: string;
  readonly kind: string;
  readonly code: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyAmount;
  readonly reasonCode: string;
  readonly note: string;
  readonly retroactiveOfPeriodId?: string;
  readonly retroactiveOfRunId?: string;
  readonly requestedBy: string;
  readonly recordedAt: Date;
}

export const recordAdjustment = (
  command: RecordAdjustment,
): PayrollResult<PayrollAdjustmentState> => {
  if (!isAdjustmentKind(command.kind))
    return refuse('adjustment_kind_unknown', { kind: command.kind });
  if (!isCode(command.code)) return refuse('code_malformed', { code: command.code });
  if (!isCode(command.reasonCode)) return refuse('reason_code_malformed');
  if (command.note.trim().length === 0) return refuse('adjustment_note_required');
  if (command.amount.amountMinor <= 0n) return refuse('adjustment_amount_not_positive');

  return accept({
    payrollAdjustmentId: command.payrollAdjustmentId,
    payrollRunId: command.payrollRunId,
    employmentId: command.employmentId,
    kind: command.kind,
    code: command.code,
    payrollTreatmentCode: command.payrollTreatmentCode,
    amount: command.amount,
    reasonCode: command.reasonCode,
    note: command.note.trim(),
    ...(command.retroactiveOfPeriodId === undefined
      ? {}
      : { retroactiveOfPeriodId: command.retroactiveOfPeriodId }),
    ...(command.retroactiveOfRunId === undefined
      ? {}
      : { retroactiveOfRunId: command.retroactiveOfRunId }),
    requestedBy: command.requestedBy,
    recordedAt: command.recordedAt,
    version: 1,
  });
};
