import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { carryOverExpiresOn, expiringMinutes } from '../domain/carry-over.js';
import { leaveYearFor, type LeaveYear } from '../domain/leave-year.js';
import { appendToLedger } from './ledger-writer.js';
import { balancesIn } from './leave-year.use-case.js';
import { notFound, refusedBy } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type { BalanceState } from '../domain/balance.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Expiring carried-over leave.
 *
 * Its own command, and its own file, because it happens **months after** the year it belongs to
 * closed — and because it is a different movement from the lapse that happens at the year end.
 * Lapse is a `carry_out` with no matching `carry_in`; expiry is an `expiry` entry on a date the
 * policy set. Two rows, two reports, two questions somebody actually asks (§17).
 *
 * **Nothing expires because a timer fired and nobody noticed.** An operator runs this, it reports
 * what it did, and running it again writes nothing — the same bounded, idempotent shape accrual and
 * leave-year closure have, for the same reason.
 */

const DEFAULT_PAGE = 200;
const MAX_PAGE = 1000;

export interface ExpireCarryOverCommand extends Command {
  readonly commandName: 'leave.expire-carry-over';
  readonly leavePolicyId: string;
  /** Any date inside the leave year whose carried-in amount may now have expired. */
  readonly onDate: string;
  readonly limit?: number;
}

export interface CarryOverExpired {
  readonly examined: number;
  readonly expiredEntries: number;
  readonly expiredMinutes: number;
  readonly expiresOn?: string;
}

/**
 * Expiring carried-over leave.
 *
 * A separate command with a reconciliation of its own shape, because **nothing expires because a
 * timer fired and nobody noticed**. An operator runs it, it reports what it did, and running it
 * again writes nothing.
 *
 * What expires is the unused remainder of what was **carried in** — never leave accrued during the
 * new year. Consumption is applied to the carried amount first, which is the reading favourable to
 * the employee and the one every policy that bothers to say means.
 */
export const expireCarryOverHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<ExpireCarryOverCommand, CarryOverExpired> => ({
  commandName: 'leave.expire-carry-over',
  permission: LeavePermissions.accrualRun,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const policy = await dependencies.stores.policies.byId(transaction, command.leavePolicyId);

      if (policy === undefined) return notFound<CarryOverExpired>('leave policy');

      const year = leaveYearFor(policy, command.onDate);
      const expiresOn = carryOverExpiresOn(policy, year.start);

      if (expiresOn === undefined)
        return success({ examined: 0, expiredEntries: 0, expiredMinutes: 0 });
      if (command.onDate < expiresOn) {
        return refusedBy<CarryOverExpired>({
          reason: 'carry_over_has_not_expired_yet',
          messageKey: 'leave.rejection.carry_over_has_not_expired_yet',
        });
      }

      const limit = Math.min(MAX_PAGE, Math.max(1, command.limit ?? DEFAULT_PAGE));
      const balances = await balancesIn(transaction, dependencies, policy, year, limit);
      const totals = await expireEach(transaction, dependencies, {
        policy,
        year,
        balances,
        expiresOn,
      });

      return success({ examined: balances.length, ...totals, expiresOn });
    }),
});

interface ExpiryContext {
  readonly policy: LeavePolicyState;
  readonly year: LeaveYear;
  readonly balances: readonly BalanceState[];
  readonly expiresOn: string;
}

const expireEach = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  context: ExpiryContext,
): Promise<{ readonly expiredEntries: number; readonly expiredMinutes: number }> => {
  let entries = 0;
  let minutes = 0;

  for (const balance of context.balances) {
    const expiring = expiringMinutes(balance.carriedInMinutes, balance.consumedMinutes);
    const capped = Math.min(expiring, Math.max(0, balance.availableMinutes));

    if (capped <= 0) continue;

    const written = await appendToLedger(transaction, dependencies, {
      tenantId: balance.tenantId,
      employmentId: balance.employmentId,
      leaveTypeId: balance.leaveTypeId,
      leavePolicyId: context.policy.id,
      leaveYear: context.year,
      kind: 'expiry',
      minutes: -capped,
      effectiveOn: context.expiresOn,
      sourceKind: 'leave_year',
      sourceId: balance.id,
    });

    if (written.ok && written.value.written) {
      entries += 1;
      minutes += capped;
    }
  }
  return { expiredEntries: entries, expiredMinutes: minutes };
};
