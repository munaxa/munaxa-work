import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { recordAdjustment } from '../domain/payroll-adjustment.js';
import { checkedMoney, type MoneyInput } from '../domain/money-amount.js';
import { conflicted, currentActor, refusedBy } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import type { PayrollDependencies } from './payroll-dependencies.js';

/**
 * An adjustment: a line somebody added deliberately, with a sentence explaining why.
 *
 * **The reason code and the written note are both required**, and the note sits behind
 * `payroll.adjust` rather than `payroll.read` — reading a figure is not reading the reason behind
 * it. That is the Phase 10 precedent and it carries the same argument: a figure changed on
 * somebody's pay without a sentence explaining why is an audit finding.
 *
 * An adjustment **never edits a calculated line**. It records an intervention, and recalculation
 * turns it into a line of its own, so the calculation and the intervention stay distinguishable on
 * the payslip and in the audit trail.
 *
 * A **retroactive** adjustment names a prior period and run and is paid in the current period. The
 * closed period's figures never move: restating one invalidates an accounting output that may
 * already have left the system, and a current-period correction line is visible on a payslip the
 * employee can question.
 *
 * A finalized run refuses. The remedy there is a correction run, not an adjustment to history.
 */

export interface RecordAdjustmentCommand extends Command {
  readonly commandName: 'payroll.record-adjustment';
  readonly payrollRunId: string;
  readonly employmentId: string;
  readonly kind: string;
  readonly code: string;
  readonly payrollTreatmentCode: string;
  readonly amount: MoneyInput;
  readonly reasonCode: string;
  readonly note: string;
  readonly retroactiveOfPeriodId?: string;
  readonly retroactiveOfRunId?: string;
}

export interface AdjustmentRecorded {
  readonly payrollAdjustmentId: string;
}

export const recordAdjustmentHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<RecordAdjustmentCommand, AdjustmentRecorded> => ({
  commandName: 'payroll.record-adjustment',
  permission: PayrollPermissions.adjust,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const run = await dependencies.stores.runs.byId(transaction, command.payrollRunId);

      if (run === undefined) return conflicted<AdjustmentRecorded>('run_not_found');
      if (run.status === 'finalized' || run.status === 'reversed') {
        return conflicted<AdjustmentRecorded>('run_finalized');
      }

      const amount = checkedMoney(command.amount, 'amount');

      if (!amount.ok) return refusedBy<AdjustmentRecorded>(amount.error);

      const adjustment = recordAdjustment({
        ...command,
        payrollAdjustmentId: uuidV7(),
        amount: amount.value,
        requestedBy: currentActor(),
        recordedAt: dependencies.clock.now(),
      });

      if (!adjustment.ok) return refusedBy<AdjustmentRecorded>(adjustment.error);

      await dependencies.stores.adjustments.insert(transaction, adjustment.value);
      return success({ payrollAdjustmentId: adjustment.value.payrollAdjustmentId });
    }),
});
