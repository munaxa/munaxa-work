import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { recalculated, type BalanceState } from '../domain/balance.js';
import { LeaveEvents, leaveEvent } from '../domain/leave-events.js';
import { notFound, originOfCurrentRequest } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Recalculation, and the reconciliation that makes it reliable.
 *
 * **This is the module's answer to an at-most-once event bus.** Every write to the ledger marks the
 * affected balance in the same transaction; this command recomputes what is marked from the ledger,
 * and the query beside it names what is still outstanding. Nothing waits to be told (ADR-0053).
 *
 * The command is **idempotent and bounded**: running it twice produces the same figures, and a run
 * has a limit so it finishes. Running it on a balance whose ledger has not moved recomputes the
 * same digest and changes nothing observable — and still clears the stale mark, because a balance
 * left marked would sit in the queue for ever asking to be redone. That last clause is the Phase 8
 * defect, and it is not repeated here.
 *
 * **A balance is never written except by this command.** No other use case increments one. The
 * ledger is authoritative and this is the only thing that reads it into a projection.
 *
 * **Event received ≠ recalculation guarantee; event not received ≠ recalculation failure.**
 */

export const DEFAULT_BATCH = 200;
export const MAX_BATCH = 1000;

export interface RecalculateBalancesCommand extends Command {
  readonly commandName: 'leave.recalculate-balances';
  /** One bucket, or nothing — in which case the stale balances are taken in order. */
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly leaveYearStart?: string;
  readonly limit?: number;
}

export interface RecalculationOutcome {
  readonly examined: number;
  readonly recalculated: number;
  readonly unchanged: number;
}

export const recalculateBalancesHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<RecalculateBalancesCommand, RecalculationOutcome> => ({
  commandName: 'leave.recalculate-balances',
  permission: LeavePermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const balances = await targets(transaction, dependencies, command);

      if (balances === undefined) return notFound<RecalculationOutcome>('leave balance');

      let changed = 0;

      for (const balance of balances) {
        const moved = await recalculateOne(transaction, dependencies, balance);

        if (moved) changed += 1;
      }
      return success({
        examined: balances.length,
        recalculated: changed,
        unchanged: balances.length - changed,
      });
    }),
});

const targets = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  command: RecalculateBalancesCommand,
): Promise<readonly BalanceState[] | undefined> => {
  const limit = Math.min(MAX_BATCH, Math.max(1, command.limit ?? DEFAULT_BATCH));

  if (
    command.employmentId === undefined ||
    command.leaveTypeId === undefined ||
    command.leaveYearStart === undefined
  ) {
    return dependencies.stores.balances.stale(transaction, limit);
  }

  const balance = await dependencies.stores.balances.forBucket(transaction, {
    employmentId: command.employmentId,
    leaveTypeId: command.leaveTypeId,
    leaveYearStart: command.leaveYearStart,
  });

  return balance === undefined ? undefined : [balance];
};

/**
 * One balance, recomputed from its ledger.
 *
 * The digest comparison is what makes a rerun cheap and a rerun honest: identical entries produce
 * an identical digest, and the caller is told `unchanged` rather than being shown a write that did
 * nothing. The row is still written, because the stale mark has to be cleared either way.
 */
const recalculateOne = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  balance: BalanceState,
): Promise<boolean> => {
  const entries = await dependencies.stores.ledger.forBucket(transaction, {
    employmentId: balance.employmentId,
    leaveTypeId: balance.leaveTypeId,
    leaveYearStart: balance.leaveYearStart,
  });
  const { state, changed } = recalculated(balance, entries, dependencies.clock.now());

  await dependencies.stores.balances.update(transaction, state, balance.version);

  if (changed) {
    transaction.collect([
      leaveEvent(
        LeaveEvents.balanceRecalculated,
        { aggregateType: 'LeaveBalance', aggregateId: state.id },
        {
          employmentId: state.employmentId,
          leaveTypeId: state.leaveTypeId,
          availableMinutes: state.availableMinutes,
        },
        originOfCurrentRequest(),
        state.calculatedAt ?? dependencies.clock.now(),
      ),
    ]);
  }
  return changed;
};
