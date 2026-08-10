import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { accrueOne, type RunContext } from './accrual-run.js';
import { currentActor, currentTenant, notFound, refusedBy } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { AccrualRunState } from '../domain/runs.js';
import type { EmploymentForLeave } from './leave-ports.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * An accrual run: a bounded, idempotent, restartable command an operator invokes.
 *
 * **It is not scheduled, and nothing here pretends it is.** No timer runs it, because nothing in
 * this repository runs on a timer — scheduling is Phase 24's. A run this module triggered from a
 * fake scheduler would be exactly the kind of claimed-but-absent capability the instruction
 * forbids, so the completion report marks scheduled execution NOT VERIFIED and this command is what
 * actually exists.
 *
 * **Bounded**: it takes a page of employments and reports what it covered. A hundred thousand
 * employments in one request is a request that never finishes, and an operator who cannot tell
 * whether it is working.
 *
 * **Idempotent, and the key is per employment rather than per run.** Two unique indexes cooperate.
 * `leave_accrual_run_key` means re-invoking the command for the same policy and period **resumes
 * the same run** instead of opening a second one. `leave_entitlement_source_key` means that run's
 * grants are recognised as its own, so an employment already accrued is skipped. The ledger entry
 * is then keyed on the *entitlement*, which is unique per employment — keying it on the run would
 * have made the whole run one entry, and every employment after the first would have been skipped
 * for the wrong reason. A run interrupted half way is re-run, not repaired.
 *
 * **Explainable**: every entry names the run and the policy version that produced it, and the run
 * records how many it examined, wrote, skipped and refused. The refusals are the honest part: a run
 * that hid them would quietly under-grant.
 *
 * **No statutory figure appears anywhere in this file.** The amount comes from the policy version,
 * and for `service_band` from a `RuleDefinition` the tenant or a country pack supplied, evaluated
 * by the kernel engine (§22).
 */

export interface RunAccrualCommand extends Command {
  readonly commandName: 'leave.run-accrual';
  readonly leavePolicyId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly limit?: number;
}

export interface AccrualRunOutcome {
  readonly accrualRunId: string;
  readonly employmentsExamined: number;
  readonly entriesWritten: number;
  readonly entriesSkipped: number;
  readonly refusals: number;
}

const DEFAULT_PAGE = 200;
const MAX_PAGE = 1000;

export const runAccrualHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<RunAccrualCommand, AccrualRunOutcome> => ({
  commandName: 'leave.run-accrual',
  permission: LeavePermissions.accrualRun,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const policy = await dependencies.stores.policies.byId(transaction, command.leavePolicyId);

      if (policy === undefined) return notFound<AccrualRunOutcome>('leave policy');
      if (policy.status !== 'published') {
        return refusedBy<AccrualRunOutcome>({
          reason: 'leave_policy_not_published',
          messageKey: 'leave.rejection.leave_policy_not_published',
        });
      }

      const run = await openRun(transaction, dependencies, command, policy);
      const limit = Math.min(MAX_PAGE, Math.max(1, command.limit ?? DEFAULT_PAGE));
      const employments = await dependencies.employment.activeEmployments(limit);
      const counts = await accrueEach(transaction, dependencies, {
        context: { run, policy, periodStart: command.periodStart, periodEnd: command.periodEnd },
        employments,
      });

      await dependencies.stores.accrualRuns.update(transaction, { ...run, ...counts }, run.version);
      return success({ accrualRunId: run.id, ...counts });
    }),
});

/**
 * The run row, resumed where one already exists for this policy and period.
 *
 * Resumed rather than reopened, because the grants a half-finished run wrote name it as their
 * source — and a fresh run identity would make them invisible to the retry, which would then accrue
 * everybody twice.
 */
const openRun = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  command: RunAccrualCommand,
  policy: LeavePolicyState,
): Promise<AccrualRunState> => {
  const resumed = await dependencies.stores.accrualRuns.forPeriod(
    transaction,
    policy.id,
    command.periodStart,
    command.periodEnd,
  );

  if (resumed !== undefined) return resumed;

  const now = dependencies.clock.now();
  const run: AccrualRunState = {
    id: uuidV7(now.getTime()),
    tenantId: currentTenant(),
    leavePolicyId: policy.id,
    leaveTypeId: policy.leaveTypeId,
    periodStart: command.periodStart,
    periodEnd: command.periodEnd,
    runBy: currentActor(),
    runAt: now,
    employmentsExamined: 0,
    entriesWritten: 0,
    entriesSkipped: 0,
    refusals: 0,
    metadata: {},
    version: 0,
  };

  await dependencies.stores.accrualRuns.insert(transaction, run);
  return run;
};

interface RunCounts {
  readonly employmentsExamined: number;
  readonly entriesWritten: number;
  readonly entriesSkipped: number;
  readonly refusals: number;
}

const accrueEach = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  page: { readonly context: RunContext; readonly employments: readonly EmploymentForLeave[] },
): Promise<RunCounts> => {
  let written = 0;
  let skipped = 0;
  let refusals = 0;

  for (const employment of page.employments) {
    const outcome = await accrueOne(transaction, dependencies, page.context, employment);

    if (outcome === 'written') written += 1;
    else if (outcome === 'skipped') skipped += 1;
    else refusals += 1;
  }
  return {
    employmentsExamined: page.employments.length,
    entriesWritten: written,
    entriesSkipped: skipped,
    refusals,
  };
};
