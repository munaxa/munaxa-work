import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { DayExceptionState } from '../domain/attendance-day-state.js';
import type { ExceptionQuery, ExceptionStore, Page } from '../application/attendance-ports.js';

import {
  EXCEPTION_COLUMNS,
  exceptionInsert,
  exceptionUpdate,
  toException,
  type ExceptionRow,
} from './day-rows.js';
import { exceptionFilters } from './attendance-search.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * Exceptions on a day, in PostgreSQL.
 *
 * **`supersedeOpen` moves rows to `superseded`; it deletes nothing.** A recalculation replaces what
 * the previous one found, and what the system thought yesterday is part of why somebody corrected
 * something today. It is one statement rather than a loop for the same reason `markStale` is: a
 * recalculation run touches hundreds of days.
 *
 * `forDays` exists so the queue screen reads the exceptions for a page of days in one round trip.
 * A per-day read is the N+1 that turns a fast list into a slow one exactly when a month closes and
 * the list is longest.
 */
export class ExceptionRepository
  extends Repository<{ id: string; version: number }>
  implements ExceptionStore
{
  public constructor() {
    super('attendance_day_exception');
  }

  public async byId(transaction: Transaction, id: string): Promise<DayExceptionState | undefined> {
    const rows = await transaction.execute<ExceptionRow>(
      `select ${EXCEPTION_COLUMNS} from attendance_day_exception x
        where x.id = $1 and x.tenant_id = $2 and x.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toException(row);
  }

  public async forDay(
    transaction: Transaction,
    attendanceDayId: string,
  ): Promise<readonly DayExceptionState[]> {
    const rows = await transaction.execute<ExceptionRow>(
      `select ${EXCEPTION_COLUMNS} from attendance_day_exception x
        where x.tenant_id = $1 and x.attendance_day_id = $2 and x.deleted_at is null
        order by x.severity desc, x.kind`,
      [transaction.tenantId, attendanceDayId],
    );
    return rows.map(toException);
  }

  public async forDays(
    transaction: Transaction,
    attendanceDayIds: readonly string[],
  ): Promise<readonly DayExceptionState[]> {
    if (attendanceDayIds.length === 0) return [];

    const rows = await transaction.execute<ExceptionRow>(
      `select ${EXCEPTION_COLUMNS} from attendance_day_exception x
        where x.tenant_id = $1 and x.attendance_day_id = any($2::uuid[]) and x.deleted_at is null
        order by x.attendance_date, x.severity desc, x.kind`,
      [transaction.tenantId, [...attendanceDayIds]],
    );
    return rows.map(toException);
  }

  public search(transaction: Transaction, query: ExceptionQuery): Promise<Page<DayExceptionState>> {
    const { where, parameters } = exceptionFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<ExceptionRow, DayExceptionState>(
      transaction,
      {
        select: `select ${EXCEPTION_COLUMNS} from attendance_day_exception x where ${where}
                 order by x.attendance_date desc, x.severity desc, x.id
                 limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from attendance_day_exception x where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toException,
    );
  }

  /** Counted by the database rather than by loading rows: freezing a month reports this figure. */
  public async countBlocking(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const rows = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from attendance_day_exception x
        where x.tenant_id = $1 and x.employment_id = $2
          and x.attendance_date between $3::date and $4::date
          and x.severity = 'blocking' and x.state = 'open' and x.deleted_at is null`,
      [transaction.tenantId, employmentId, from, to],
    );
    return Number(rows[0]?.total ?? '0');
  }

  public async insert(transaction: Transaction, state: DayExceptionState): Promise<void> {
    await insertRow(transaction, this.table, exceptionInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: DayExceptionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, exceptionUpdate(state));
  }

  public async supersedeOpen(
    transaction: Transaction,
    attendanceDayId: string,
    at: Date,
  ): Promise<void> {
    await transaction.execute(
      `update attendance_day_exception
          set state = 'superseded', updated_at = $3, updated_by = 'system:recalculation',
              version = version + 1
        where tenant_id = $1 and attendance_day_id = $2 and state = 'open' and deleted_at is null`,
      [transaction.tenantId, attendanceDayId, at],
    );
  }
}
