import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PayrollRunState } from '../domain/payroll-run.js';
import type { Page, Paged, RunStore } from '../application/payroll-ports.js';
import { runState, runValues, type PayrollRunRow } from './run-rows.js';
import { insertRow, mutable, pageOf } from './row-writer.js';

/** The run and the snapshot, in PostgreSQL. */

export class PostgresRunRepository extends Repository<PayrollRunRow> implements RunStore {
  public constructor() {
    super('payroll_run');
  }

  public async byId(transaction: Transaction, id: string): Promise<PayrollRunState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : runState(row);
  }

  public async forPeriod(
    transaction: Transaction,
    periodId: string,
  ): Promise<readonly PayrollRunState[]> {
    const rows = await transaction.execute<PayrollRunRow>(
      `select * from payroll_run
         where tenant_id = $1 and payroll_period_id = $2 and deleted_at is null
         order by run_sequence`,
      [transaction.tenantId, periodId],
    );

    return rows.map(runState);
  }

  public page(transaction: Transaction, paged: Paged): Promise<Page<PayrollRunState>> {
    return pageOf<PayrollRunRow, PayrollRunState>(
      transaction,
      {
        select: `select * from payroll_run
                   where tenant_id = $1 and deleted_at is null
                   order by created_at desc, id desc limit $2 offset $3`,
        count: `select count(*)::text as total from payroll_run
                  where tenant_id = $1 and deleted_at is null`,
        parameters: [transaction.tenantId],
        limit: paged.limit,
        offset: paged.offset,
      },
      runState,
    );
  }

  public insert(transaction: Transaction, state: PayrollRunState): Promise<void> {
    return insertRow(transaction, this.table, runValues(state, transaction.tenantId), new Date());
  }

  public async update(
    transaction: Transaction,
    state: PayrollRunState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.payrollRunId,
      expected,
      mutable(runValues(state, transaction.tenantId)),
    );
  }

  /**
   * Stamps `finalized_at` across every table the run owns — **one statement per table**.
   *
   * This is the moment the database trigger takes over: from here on any update or delete of these
   * rows raises `payroll_finalized_immutable`, from any path including SQL nobody wrote in
   * TypeScript (ADR-0066). The statements run in the finalization transaction, so either every row
   * is frozen or none is.
   */
  public async finalize(transaction: Transaction, runId: string, moment: Date): Promise<void> {
    for (const table of FINALIZED_TABLES) {
      await transaction.execute(
        `update ${table} set finalized_at = $1
           where tenant_id = $2 and payroll_run_id = $3 and finalized_at is null`,
        [moment, transaction.tenantId, runId],
      );
    }
  }
}

/** Every table carrying a `finalized_at`, and therefore every table the trigger protects. */
const FINALIZED_TABLES = [
  'payroll_input_snapshot',
  'payroll_result',
  'payroll_earning_line',
  'payroll_deduction_line',
  'payroll_accounting_line',
  'payroll_payment_instruction',
] as const;
