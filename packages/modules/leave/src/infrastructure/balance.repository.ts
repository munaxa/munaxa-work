import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { BalanceState } from '../domain/balance.js';
import type { LedgerBucket } from '../domain/ledger.js';
import type { BalanceQuery, BalanceStore, Page } from '../application/leave-ports.js';

import { BALANCE_COLUMNS, balanceValues, toBalance, type BalanceRow } from './ledger-rows.js';
import { insertRow, mutable, pageOf, predicateFor } from './row-writer.js';

/**
 * The balance projection, in PostgreSQL.
 *
 * **`stale` uses the same predicate as `leave_balance_stale_idx`** — `inputs_changed_at is not
 * null` and not deleted. Presence of the mark, never a comparison against `calculated_at`: an entry
 * written within the same clock tick as the calculation it invalidates would be lost by a
 * comparison, and lost silently (ADR-0053, and the Phase 8 defect that proved it).
 *
 * **`markStale` is a single statement.** Closing a leave year touches every balance of a policy,
 * and loading those rows to mark them is the N+1 this module cannot afford. Its tenant clause is
 * not optional: a predicate write that lost it would fail across tenants silently rather than
 * loudly, which is why the isolation suite asserts this method specifically (§24.3).
 */

export class LeaveBalanceRepository
  extends Repository<{ id: string; version: number }>
  implements BalanceStore
{
  public constructor() {
    super('leave_balance');
  }

  public async forBucket(
    transaction: Transaction,
    bucket: LedgerBucket,
  ): Promise<BalanceState | undefined> {
    const rows = await transaction.execute<BalanceRow>(
      `select ${BALANCE_COLUMNS} from leave_balance b
        where b.tenant_id = $1 and b.employment_id = $2 and b.leave_type_id = $3
          and b.leave_year_start = $4::date and b.deleted_at is null`,
      [transaction.tenantId, bucket.employmentId, bucket.leaveTypeId, bucket.leaveYearStart],
    );
    const row = rows[0];

    return row === undefined ? undefined : toBalance(row);
  }

  public async forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly BalanceState[]> {
    const rows = await transaction.execute<BalanceRow>(
      `select ${BALANCE_COLUMNS} from leave_balance b
        where b.tenant_id = $1 and b.employment_id = $2 and b.deleted_at is null
        order by b.leave_year_start desc`,
      [transaction.tenantId, employmentId],
    );
    return rows.map(toBalance);
  }

  /** The same predicate as `leave_balance_stale_idx`. Presence of the mark, never a comparison. */
  public async stale(transaction: Transaction, limit: number): Promise<readonly BalanceState[]> {
    const rows = await transaction.execute<BalanceRow>(
      `select ${BALANCE_COLUMNS} from leave_balance b
        where b.tenant_id = $1 and b.inputs_changed_at is not null and b.deleted_at is null
        order by b.inputs_changed_at, b.id limit $2`,
      [transaction.tenantId, limit],
    );
    return rows.map(toBalance);
  }

  public async markStale(
    transaction: Transaction,
    scope: { readonly employmentId?: string; readonly leaveTypeId?: string },
    at: Date,
  ): Promise<number> {
    const rows = await transaction.execute<{ id: string }>(
      `update leave_balance set inputs_changed_at = $2, version = version + 1
        where tenant_id = $1 and deleted_at is null
          and ($3::uuid is null or employment_id = $3::uuid)
          and ($4::uuid is null or leave_type_id = $4::uuid)
        returning id`,
      [transaction.tenantId, at, scope.employmentId ?? null, scope.leaveTypeId ?? null],
    );
    return rows.length;
  }

  public search(transaction: Transaction, query: BalanceQuery): Promise<Page<BalanceState>> {
    const { clause, parameters, next } = predicateFor('b', transaction.tenantId, [
      { column: 'b.employment_id', value: query.employmentId },
      { column: 'b.leave_type_id', value: query.leaveTypeId },
      { column: 'b.leave_year_start', value: query.leaveYearStart, cast: '::date' },
    ]);

    return pageOf<BalanceRow, BalanceState>(
      transaction,
      {
        select: `select ${BALANCE_COLUMNS} from leave_balance b where ${clause}
                 order by b.leave_year_start desc, b.id
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from leave_balance b where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toBalance,
    );
  }

  public async insert(transaction: Transaction, state: BalanceState): Promise<void> {
    await insertRow(transaction, 'leave_balance', balanceValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: BalanceState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(balanceValues(state)));
  }
}
