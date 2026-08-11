import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { carryOverFor } from '../domain/carry-over.js';
import { closed } from '../domain/balance.js';
import { leaveYearFor, nextLeaveYear, type LeaveYear } from '../domain/leave-year.js';
import { appendToLedger } from './ledger-writer.js';
import { conflicted, currentActor, currentTenant, notFound } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type { BalanceState } from '../domain/balance.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Closing a leave year, and expiring what was carried over.
 *
 * **Carry-over is a pair of ledger entries, not a mutation**: `carry_out` against the closing year
 * and `carry_in` against the opening one, written in one transaction. The pair is what makes the
 * movement auditable in *both* years — a single entry would leave one year's sum unexplained, and
 * somebody would eventually ask which.
 *
 * **Closing a year deletes nothing.** The closing year's balances are retained and stamped
 * `closedAt`, so "what did they have on the last day of 2026" is answerable in 2029. The
 * projections stay; only their status changes.
 *
 * **The two expiries are different things and produce different rows.** Entitlement that simply
 * does not carry over produces a `carry_out` with no matching `carry_in` — that is *lapse*, and it
 * happens at the year end. Carried-over leave that runs out of time produces an `expiry` entry
 * months later, on the date the policy set. Calling both "expiry" would make it impossible to
 * report how much leave a policy actually discards at the year end (§17).
 *
 * Both commands are **idempotent and bounded**, like accrual. `leave_year_key` makes a rerun of a
 * closure a conflict rather than a second carry pair.
 */

export interface CloseLeaveYearCommand extends Command {
  readonly commandName: 'leave.close-leave-year';
  readonly leavePolicyId: string;
  /** Any date inside the year being closed. The boundary comes from the policy's own calendar. */
  readonly onDate: string;
  readonly limit?: number;
}

export interface LeaveYearClosed {
  readonly leaveYearId: string;
  readonly leaveYearStart: string;
  readonly employmentsClosed: number;
  readonly carriedOutMinutes: number;
  readonly carriedInMinutes: number;
  readonly lapsedMinutes: number;
}

const DEFAULT_PAGE = 200;
const MAX_PAGE = 1000;

export const closeLeaveYearHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<CloseLeaveYearCommand, LeaveYearClosed> => ({
  commandName: 'leave.close-leave-year',
  permission: LeavePermissions.accrualRun,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const policy = await dependencies.stores.policies.byId(transaction, command.leavePolicyId);

      if (policy === undefined) return notFound<LeaveYearClosed>('leave policy');

      const closing = leaveYearFor(policy, command.onDate);
      const already = await dependencies.stores.leaveYears.byPolicyAndYear(
        transaction,
        policy.id,
        closing.start,
      );

      if (already !== undefined) {
        return conflicted<LeaveYearClosed>('leave.rejection.leave_year_already_closed');
      }

      const limit = Math.min(MAX_PAGE, Math.max(1, command.limit ?? DEFAULT_PAGE));
      const balances = await balancesIn(transaction, dependencies, policy, closing, limit);
      const totals = await closeEach(transaction, dependencies, { policy, closing, balances });
      const record = {
        id: uuidV7(dependencies.clock.now().getTime()),
        tenantId: currentTenant(),
        leavePolicyId: policy.id,
        leaveTypeId: policy.leaveTypeId,
        leaveYearStart: closing.start,
        leaveYearEnd: closing.end,
        closedAt: dependencies.clock.now(),
        closedBy: currentActor(),
        employmentsClosed: balances.length,
        carriedOutMinutes: totals.carriedOut,
        carriedInMinutes: totals.carriedIn,
        expiredMinutes: totals.lapsed,
        metadata: {},
        version: 0,
      };

      await dependencies.stores.leaveYears.insert(transaction, record);
      return success({
        leaveYearId: record.id,
        leaveYearStart: closing.start,
        employmentsClosed: balances.length,
        carriedOutMinutes: totals.carriedOut,
        carriedInMinutes: totals.carriedIn,
        lapsedMinutes: totals.lapsed,
      });
    }),
});

/** The balances this policy's year covers, bounded so a run finishes. */
export const balancesIn = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  policy: LeavePolicyState,
  closing: LeaveYear,
  limit: number,
): Promise<readonly BalanceState[]> => {
  const page = await dependencies.stores.balances.search(transaction, {
    leaveTypeId: policy.leaveTypeId,
    leaveYearStart: closing.start,
    limit,
    offset: 0,
  });

  return page.items;
};

interface ClosureContext {
  readonly policy: LeavePolicyState;
  readonly closing: LeaveYear;
  readonly balances: readonly BalanceState[];
}

const closeEach = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  context: ClosureContext,
): Promise<{
  readonly carriedOut: number;
  readonly carriedIn: number;
  readonly lapsed: number;
}> => {
  const opening = nextLeaveYear(context.policy, context.closing);
  let carriedOut = 0;
  let carriedIn = 0;
  let lapsed = 0;

  for (const balance of context.balances) {
    const outcome = carryOverFor(context.policy, balance.availableMinutes);

    if (!outcome.ok) continue;
    if (outcome.value.carriedOutMinutes > 0) {
      await writePair(transaction, dependencies, {
        balance,
        closing: context.closing,
        opening,
        policy: context.policy,
        outcome: outcome.value,
      });
    }
    await dependencies.stores.balances.update(
      transaction,
      closed(balance, dependencies.clock.now()),
      balance.version,
    );
    carriedOut += outcome.value.carriedOutMinutes;
    carriedIn += outcome.value.carriedInMinutes;
    lapsed += outcome.value.lapsedMinutes;
  }
  return { carriedOut, carriedIn, lapsed };
};

interface PairContext {
  readonly balance: BalanceState;
  readonly closing: LeaveYear;
  readonly opening: LeaveYear;
  readonly policy: LeavePolicyState;
  readonly outcome: { readonly carriedOutMinutes: number; readonly carriedInMinutes: number };
}

/**
 * The pair.
 *
 * `carry_out` always; `carry_in` only where something actually carries. A policy carrying nothing
 * over produces the debit alone, which is what *lapse* looks like in the ledger and is deliberately
 * distinguishable from an `expiry` entry.
 */
const writePair = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  context: PairContext,
): Promise<void> => {
  const common = {
    tenantId: context.balance.tenantId,
    employmentId: context.balance.employmentId,
    leaveTypeId: context.balance.leaveTypeId,
    leavePolicyId: context.policy.id,
    sourceKind: 'leave_year' as const,
    sourceId: context.balance.id,
  };

  await appendToLedger(transaction, dependencies, {
    ...common,
    leaveYear: context.closing,
    kind: 'carry_out',
    minutes: -context.outcome.carriedOutMinutes,
    effectiveOn: context.closing.end,
  });

  if (context.outcome.carriedInMinutes <= 0) return;

  await appendToLedger(transaction, dependencies, {
    ...common,
    leaveYear: context.opening,
    kind: 'carry_in',
    minutes: context.outcome.carriedInMinutes,
    effectiveOn: context.opening.start,
  });
};
