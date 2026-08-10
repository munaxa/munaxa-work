import type { Transaction } from '@work/kernel';

import type { PayrollResultState } from '../domain/payroll-lines.js';
import type { Page, Paged, ResultStore } from '../application/payroll-ports.js';
import { resultState, resultValues, type ResultRow } from './result-rows.js';
import { insertRows, pageOf } from './row-writer.js';

/**
 * The tables that carry money, in PostgreSQL.
 *
 * Three properties are enforced here rather than assumed.
 *
 * **Every write is a multi-row insert.** At five hundred employments per batch, a statement per row
 * is five hundred round trips where one will do.
 *
 * **No store offers a general `update`.** A result and its lines are written once and read
 * thereafter; `clearRun` exists only so a recalculation can replace a run that is *not* finalized,
 * and the database trigger refuses it for one that is (ADR-0066).
 *
 * **No amount passes through `number`.** Values go in as decimal strings and come back as `bigint`.
 */

export class PostgresResultRepository implements ResultStore {
  public async byId(transaction: Transaction, id: string): Promise<PayrollResultState | undefined> {
    const rows = await transaction.execute<ResultRow>(
      `select * from payroll_result where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : resultState(rows[0]);
  }

  public forRun(
    transaction: Transaction,
    runId: string,
    paged: Paged,
  ): Promise<Page<PayrollResultState>> {
    return pageOf<ResultRow, PayrollResultState>(
      transaction,
      {
        select: `select * from payroll_result
                   where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null
                   order by employment_id, currency_code limit $3 offset $4`,
        count: `select count(*)::text as total from payroll_result
                  where tenant_id = $1 and payroll_run_id = $2 and deleted_at is null`,
        parameters: [transaction.tenantId, runId],
        limit: paged.limit,
        offset: paged.offset,
      },
      resultState,
    );
  }

  public async forEmployment(
    transaction: Transaction,
    runId: string,
    employmentId: string,
  ): Promise<readonly PayrollResultState[]> {
    const rows = await transaction.execute<ResultRow>(
      `select * from payroll_result
         where tenant_id = $1 and payroll_run_id = $2 and employment_id = $3 and deleted_at is null`,
      [transaction.tenantId, runId, employmentId],
    );

    return rows.map(resultState);
  }

  public insertMany(
    transaction: Transaction,
    results: readonly PayrollResultState[],
  ): Promise<void> {
    return insertRows(
      transaction,
      'payroll_result',
      results.map((result) => resultValues(result, transaction.tenantId)),
      new Date(),
    );
  }

  /**
   * Removes a **non-finalized** run's results so a recalculation can replace them.
   *
   * A hard delete rather than a soft one, because these rows are derived: the authoritative record
   * of what was consumed is the snapshot, and a soft-deleted result would leave two answers to
   * "what did this run produce". The `finalized_at is null` predicate is the application half of
   * the immutability rule; the trigger is the other half and refuses the same delete.
   */
  public async clearRun(transaction: Transaction, runId: string): Promise<void> {
    await transaction.execute(
      `delete from payroll_result
         where tenant_id = $1 and payroll_run_id = $2 and finalized_at is null`,
      [transaction.tenantId, runId],
    );
  }

  /**
   * The same delete, narrowed to the employments a batch is about to write.
   *
   * This runs before every batch's inserts. On a first pass it matches nothing; on a recalculation
   * it is what makes the write a replacement rather than a second row — `payroll_result_unique_idx`
   * would otherwise raise 23505 partway through a batch. `finalized_at is null` keeps a frozen
   * result out of reach; the trigger refuses the same delete (ADR-0066).
   */
  public async clearEmployments(
    transaction: Transaction,
    runId: string,
    employmentIds: readonly string[],
  ): Promise<void> {
    if (employmentIds.length === 0) return;
    await transaction.execute(
      `delete from payroll_result
         where tenant_id = $1 and payroll_run_id = $2 and employment_id = any($3::uuid[])
           and finalized_at is null`,
      [transaction.tenantId, runId, employmentIds],
    );
  }
}
