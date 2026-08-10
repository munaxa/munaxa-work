import { success, type Query, type QueryHandler } from '@work/kernel';

import { LeavePermissions } from './leave-permissions.js';
import { DEFAULT_BATCH, MAX_BATCH } from './recalculate.use-case.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * The reconciliation read: balances whose ledger moved after they were last calculated.
 *
 * A first-class query rather than an operations script, because it is the mechanism that recovers
 * work a lost event would otherwise have dropped, and something a human can look at is something a
 * human notices is growing. It is on the admin dashboard for exactly that reason.
 *
 * It uses the same predicate as the partial index the migration creates — **presence of the stale
 * mark**, never a comparison against `calculated_at`. A ledger entry written within the same clock
 * tick as the calculation it invalidates would be lost by a comparison, and lost silently
 * (ADR-0053).
 *
 * The worst failure this module has is a **silently wrong balance**: nobody notices until somebody
 * is refused leave they had. This query, the digest on the projection, and the as-of query that
 * re-derives from the ledger independently are the three things that make that failure detectable
 * rather than merely unlikely.
 */

export interface BalancesAwaitingRecalculation extends Query {
  readonly queryName: 'leave.balances-awaiting-recalculation';
  readonly limit?: number;
}

export interface AwaitingRecalculationView {
  readonly total: number;
  readonly balances: readonly {
    readonly balanceId: string;
    readonly employmentId: string;
    readonly leaveTypeId: string;
    readonly leaveYearStart: string;
    readonly inputsChangedAt?: Date;
    readonly calculatedAt?: Date;
  }[];
}

export const balancesAwaitingRecalculationHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<BalancesAwaitingRecalculation, AwaitingRecalculationView> => ({
  queryName: 'leave.balances-awaiting-recalculation',
  permission: LeavePermissions.balanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const limit = Math.min(MAX_BATCH, Math.max(1, query.limit ?? DEFAULT_BATCH));
      const stale = await dependencies.stores.balances.stale(transaction, limit);

      return success({
        total: stale.length,
        balances: stale.map((balance) => ({
          balanceId: balance.id,
          employmentId: balance.employmentId,
          leaveTypeId: balance.leaveTypeId,
          leaveYearStart: balance.leaveYearStart,
          ...(balance.inputsChangedAt === undefined
            ? {}
            : { inputsChangedAt: balance.inputsChangedAt }),
          ...(balance.calculatedAt === undefined ? {} : { calculatedAt: balance.calculatedAt }),
        })),
      });
    }),
});
