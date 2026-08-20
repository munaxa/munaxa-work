import { Repository } from '@work/persistence';
import { currentContext, isMachineContext, isSystemContext, type Transaction } from '@work/kernel';

import type { AttendanceDayState } from '../domain/attendance-day-state.js';
import type { DayQuery, DayStore, Page } from '../application/attendance-ports.js';

import { DAY_COLUMNS, dayInsert, dayUpdate, toDay, type AttendanceDayRow } from './day-rows.js';
import { dayFilters } from './attendance-search.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * The derived attendance day, in PostgreSQL.
 *
 * Two methods here carry the module's reliability argument, and both are written to agree exactly
 * with the partial index in the migration.
 *
 * `stale` uses the *same* predicate as `attendance_day_stale_idx` — `inputs_changed_at is not null`
 * and not deleted. Presence of the mark, never a comparison against `calculated_at`: an input that
 * moved within the same clock tick as the calculation it invalidates would be lost by a comparison,
 * and lost silently. The mark is cleared by the recalculation that consumes it.
 *
 * `markStale` is a single statement rather than a read-modify-write loop. Publishing a policy can
 * touch every day of every employment in a month, and loading those rows in order to mark them is
 * the N+1 this module cannot afford (ADR-0053).
 */
export class AttendanceDayRepository
  extends Repository<{ id: string; version: number }>
  implements DayStore
{
  public constructor() {
    super('attendance_day');
  }

  public async byId(transaction: Transaction, id: string): Promise<AttendanceDayState | undefined> {
    const rows = await transaction.execute<AttendanceDayRow>(
      `select ${DAY_COLUMNS} from attendance_day d
        where d.id = $1 and d.tenant_id = $2 and d.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toDay(row);
  }

  public async byDate(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<AttendanceDayState | undefined> {
    const rows = await transaction.execute<AttendanceDayRow>(
      `select ${DAY_COLUMNS} from attendance_day d
        where d.tenant_id = $1 and d.employment_id = $2 and d.attendance_date = $3::date
          and d.deleted_at is null`,
      [transaction.tenantId, employmentId, attendanceDate],
    );
    const row = rows[0];

    return row === undefined ? undefined : toDay(row);
  }

  public async forPeriod(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<readonly AttendanceDayState[]> {
    const rows = await transaction.execute<AttendanceDayRow>(
      `select ${DAY_COLUMNS} from attendance_day d
        where d.tenant_id = $1 and d.employment_id = $2
          and d.attendance_date between $3::date and $4::date and d.deleted_at is null
        order by d.attendance_date`,
      [transaction.tenantId, employmentId, from, to],
    );
    return rows.map(toDay);
  }

  public async stale(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly AttendanceDayState[]> {
    const rows = await transaction.execute<AttendanceDayRow>(
      `select ${DAY_COLUMNS} from attendance_day d
        where d.tenant_id = $1 and d.inputs_changed_at is not null and d.deleted_at is null
        order by d.inputs_changed_at, d.id limit $2`,
      [transaction.tenantId, limit],
    );
    return rows.map(toDay);
  }

  public async markStale(
    transaction: Transaction,
    scope: { readonly employmentId?: string; readonly from: string; readonly to: string },
    at: Date,
  ): Promise<number> {
    const rows = await transaction.execute<{ id: string }>(
      `update attendance_day
          set inputs_changed_at = $4, updated_at = $4, updated_by = $5
        where tenant_id = $1 and attendance_date between $2::date and $3::date
          and deleted_at is null
          and ($6::uuid is null or employment_id = $6::uuid)
        returning id`,
      [transaction.tenantId, scope.from, scope.to, at, actorOf(), scope.employmentId ?? null],
    );
    return rows.length;
  }

  public search(transaction: Transaction, query: DayQuery): Promise<Page<AttendanceDayState>> {
    const { where, parameters } = dayFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<AttendanceDayRow, AttendanceDayState>(
      transaction,
      {
        select: `select ${DAY_COLUMNS} from attendance_day d where ${where}
                 order by d.attendance_date desc, d.id limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from attendance_day d where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toDay,
    );
  }

  public async insert(transaction: Transaction, state: AttendanceDayState): Promise<void> {
    await insertRow(transaction, this.table, dayInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: AttendanceDayState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, dayUpdate(state));
  }
}

/**
 * Who marked the days, for the audit columns of a bulk statement.
 *
 * `markStale` cannot use the base class's `updateRow` — that writes one row by identity, and this
 * writes a month of them — so the audit values it would have supplied are supplied here instead.
 */
const actorOf = (): string => {
  const context = currentContext();

  if (context === undefined) return 'system:unknown';
  if (isSystemContext(context)) return `system:${context.reason}`;
  if (isMachineContext(context)) return context.executionIdentity;
  return context.userId ?? context.actor;
};
