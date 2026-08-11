import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { recordDecision, reverseDecision } from '../domain/payroll-approval.js';
import { approveRun } from '../domain/payroll-run.js';
import { conflicted, currentActor, refusedBy } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import type { PayrollDependencies } from './payroll-dependencies.js';

/**
 * Approving a payroll run, and reversing an approval without erasing it.
 *
 * **`decidedBy` comes from the authenticated context and never from a command.** A caller who could
 * supply it could approve their own run under somebody else's name, and the database's
 * `check (decided_by <> requested_by)` would be checking a value the caller chose. This is the one
 * place in the module where that distinction decides whether an audit trail means anything.
 *
 * `requestedBy` is whoever calculated the run — copied onto the decision row so the check constraint
 * can see both sides, since a check constraint cannot reach another table.
 *
 * A run in `stale` cannot be approved. That is the entire point of detecting staleness: nobody
 * signs off figures whose inputs have moved.
 */

export interface ApproveRunCommand extends Command {
  readonly commandName: 'payroll.approve';
  readonly payrollRunId: string;
  readonly comment?: string;
}

export interface RunApproved {
  readonly approvalDecisionId: string;
  readonly status: string;
}

export const approveRunHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<ApproveRunCommand, RunApproved> => ({
  commandName: 'payroll.approve',
  permission: PayrollPermissions.approve,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const run = await dependencies.stores.runs.byId(transaction, command.payrollRunId);

      if (run === undefined) return conflicted<RunApproved>('run_not_found');

      const chain = await dependencies.stores.decisions.forRun(transaction, run.payrollRunId);
      const decision = recordDecision({
        approvalDecisionId: uuidV7(),
        payrollRunId: run.payrollRunId,
        sequence: chain.length + 1,
        decision: 'approved',
        decidedBy: currentActor(),
        decidedAt: dependencies.clock.now(),
        // Whoever ran the calculation. A run nobody calculated cannot be approved, so the fallback
        // is the creator rather than a placeholder that would defeat the self-approval check.
        requestedBy: run.calculatedBy ?? run.payrollRunId,
        ...(command.comment === undefined ? {} : { comment: command.comment }),
      });

      if (!decision.ok) return refusedBy<RunApproved>(decision.error);

      const approved = approveRun(run, dependencies.clock.now(), currentActor());

      if (!approved.ok) return refusedBy<RunApproved>(approved.error);

      await dependencies.stores.decisions.insert(transaction, decision.value);
      await dependencies.stores.runs.update(transaction, approved.value, run.version);

      return success({
        approvalDecisionId: decision.value.approvalDecisionId,
        status: approved.value.status,
      });
    }),
});

export interface ReverseApprovalCommand extends Command {
  readonly commandName: 'payroll.reverse-approval';
  readonly approvalDecisionId: string;
  readonly comment?: string;
}

export interface ApprovalReversed {
  readonly approvalDecisionId: string;
  readonly status: string;
}

/**
 * A reversal is a **new row that names the decision it undoes**.
 *
 * Neither row is deleted, and the chain reads as what actually happened — somebody approved,
 * somebody reversed it — rather than as though the first decision never occurred. The run returns
 * to `calculated`, so it must be approved again before it can be finalized.
 */
export const reverseApprovalHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<ReverseApprovalCommand, ApprovalReversed> => ({
  commandName: 'payroll.reverse-approval',
  permission: PayrollPermissions.approve,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const original = await dependencies.stores.decisions.byId(
        transaction,
        command.approvalDecisionId,
      );

      if (original === undefined) return conflicted<ApprovalReversed>('decision_not_found');

      const run = await dependencies.stores.runs.byId(transaction, original.payrollRunId);

      if (run === undefined) return conflicted<ApprovalReversed>('run_not_found');
      // Beyond finalization the decision may already have been acted on — an accounting output may
      // have left the system — so the remedy is a reversal run, not an unmade approval.
      if (run.status === 'finalized' || run.status === 'reversed') {
        return conflicted<ApprovalReversed>('run_finalized');
      }

      const chain = await dependencies.stores.decisions.forRun(transaction, run.payrollRunId);
      const reversal = reverseDecision(original, {
        approvalDecisionId: uuidV7(),
        sequence: chain.length + 1,
        decidedBy: currentActor(),
        decidedAt: dependencies.clock.now(),
        ...(command.comment === undefined ? {} : { comment: command.comment }),
      });

      if (!reversal.ok) return refusedBy<ApprovalReversed>(reversal.error);

      await dependencies.stores.decisions.insert(transaction, reversal.value);
      await dependencies.stores.runs.update(
        transaction,
        { ...run, status: 'calculated', version: run.version + 1 },
        run.version,
      );

      return success({
        approvalDecisionId: reversal.value.approvalDecisionId,
        status: 'calculated',
      });
    }),
});
