import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { AccrualRunState, LeaveYearState } from '../domain/runs.js';
import type { AccrualRunStore, LeaveYearStore } from '../application/leave-ports.js';

import {
  LEAVE_YEAR_COLUMNS,
  RUN_COLUMNS,
  leaveYearValues,
  runValues,
  toLeaveYear,
  toRun,
  type AccrualRunRow,
  type LeaveYearRow,
} from './ledger-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * The records the two bounded runs leave behind.
 *
 * `forPeriod` is backed by `leave_accrual_run_key` and is what makes a run **resumable**: invoking
 * the command again for the same policy and period finds the run that was interrupted rather than
 * opening a second one, so the grants it already wrote are recognised as its own.
 *
 * `byPolicyAndYear` is backed by `leave_year_key` and is what makes closing a leave year safe to
 * retry: the second closure is refused rather than producing a second carry pair.
 *
 * Neither offers an update to what it recorded. A closure that was wrong is corrected by
 * adjustments, which are their own rows with their own actors and their own reasons.
 */

export class AccrualRunRepository
  extends Repository<{ id: string; version: number }>
  implements AccrualRunStore
{
  public constructor() {
    super('leave_accrual_run');
  }

  public async byId(transaction: Transaction, id: string): Promise<AccrualRunState | undefined> {
    const rows = await transaction.execute<AccrualRunRow>(
      `select ${RUN_COLUMNS} from leave_accrual_run r
        where r.id = $1 and r.tenant_id = $2 and r.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toRun(row);
  }

  /** Backed by `leave_accrual_run_key`, so re-invoking the command resumes rather than reopens. */
  public async forPeriod(
    transaction: Transaction,
    leavePolicyId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<AccrualRunState | undefined> {
    const rows = await transaction.execute<AccrualRunRow>(
      `select ${RUN_COLUMNS} from leave_accrual_run r
        where r.tenant_id = $1 and r.leave_policy_id = $2 and r.period_start = $3::date
          and r.period_end = $4::date and r.deleted_at is null`,
      [transaction.tenantId, leavePolicyId, periodStart, periodEnd],
    );
    const row = rows[0];

    return row === undefined ? undefined : toRun(row);
  }

  public async recent(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly AccrualRunState[]> {
    const rows = await transaction.execute<AccrualRunRow>(
      `select ${RUN_COLUMNS} from leave_accrual_run r
        where r.tenant_id = $1 and r.deleted_at is null order by r.run_at desc limit $2`,
      [transaction.tenantId, limit],
    );
    return rows.map(toRun);
  }

  public async insert(transaction: Transaction, state: AccrualRunState): Promise<void> {
    await insertRow(transaction, 'leave_accrual_run', runValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: AccrualRunState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(runValues(state)));
  }
}

export class LeaveYearRepository implements LeaveYearStore {
  public async byPolicyAndYear(
    transaction: Transaction,
    leavePolicyId: string,
    leaveYearStart: string,
  ): Promise<LeaveYearState | undefined> {
    const rows = await transaction.execute<LeaveYearRow>(
      `select ${LEAVE_YEAR_COLUMNS} from leave_year y
        where y.tenant_id = $1 and y.leave_policy_id = $2 and y.leave_year_start = $3::date
          and y.deleted_at is null`,
      [transaction.tenantId, leavePolicyId, leaveYearStart],
    );
    const row = rows[0];

    return row === undefined ? undefined : toLeaveYear(row);
  }

  public async recent(transaction: Transaction, limit: number): Promise<readonly LeaveYearState[]> {
    const rows = await transaction.execute<LeaveYearRow>(
      `select ${LEAVE_YEAR_COLUMNS} from leave_year y
        where y.tenant_id = $1 and y.deleted_at is null order by y.closed_at desc limit $2`,
      [transaction.tenantId, limit],
    );
    return rows.map(toLeaveYear);
  }

  public async insert(transaction: Transaction, state: LeaveYearState): Promise<void> {
    await insertRow(transaction, 'leave_year', leaveYearValues(state), new Date());
  }
}
