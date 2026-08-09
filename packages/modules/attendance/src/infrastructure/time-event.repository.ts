import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { TimeEventState } from '../domain/time-event.js';
import type { EventQuery, Page, TimeEventStore } from '../application/attendance-ports.js';

import { EVENT_COLUMNS, timeEventInsert, toTimeEvent, type TimeEventRow } from './event-rows.js';
import { eventFilters } from './attendance-search.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * Raw time events, in PostgreSQL.
 *
 * **There is no update method and no delete method**, and that is the module's strongest structural
 * guarantee: a history that can be amended is not history, and the cheapest way to keep it is to
 * have no method that could. A correction inserts a new event carrying `supersedes_event_id`
 * (ADR-0052).
 *
 * `byKey` reads the same `(tenant_id, event_key)` the unique index enforces. The read is an
 * optimisation and the index is the guarantee: two concurrent submissions of one punch race at the
 * insert, the loser catches `23505`, re-reads, and both callers are told the same event identifier
 * (ADR-0053).
 */
export class TimeEventRepository
  extends Repository<{ id: string; version: number }>
  implements TimeEventStore
{
  public constructor() {
    super('attendance_time_event');
  }

  public async byId(transaction: Transaction, id: string): Promise<TimeEventState | undefined> {
    const rows = await transaction.execute<TimeEventRow>(
      `select ${EVENT_COLUMNS} from attendance_time_event e
        where e.id = $1 and e.tenant_id = $2 and e.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toTimeEvent(row);
  }

  public async byKey(
    transaction: Transaction,
    eventKey: string,
  ): Promise<TimeEventState | undefined> {
    const rows = await transaction.execute<TimeEventRow>(
      `select ${EVENT_COLUMNS} from attendance_time_event e
        where e.tenant_id = $1 and e.event_key = $2 and e.deleted_at is null`,
      [transaction.tenantId, eventKey],
    );
    const row = rows[0];

    return row === undefined ? undefined : toTimeEvent(row);
  }

  /**
   * Every event on one employment's day, superseded ones included.
   *
   * Ordered by when the punch *occurred*, not by when it arrived: an out-of-order flush from a
   * device whose uplink recovered must pair with the day it belongs to, and ordering by receipt
   * would pair it with whatever happened to land beside it.
   */
  public async forDay(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<readonly TimeEventState[]> {
    const rows = await transaction.execute<TimeEventRow>(
      `select ${EVENT_COLUMNS} from attendance_time_event e
        where e.tenant_id = $1 and e.employment_id = $2 and e.attendance_date = $3::date
          and e.deleted_at is null
        order by e.occurred_at, e.id`,
      [transaction.tenantId, employmentId, attendanceDate],
    );
    return rows.map(toTimeEvent);
  }

  public search(transaction: Transaction, query: EventQuery): Promise<Page<TimeEventState>> {
    const { where, parameters } = eventFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<TimeEventRow, TimeEventState>(
      transaction,
      {
        select: `select ${EVENT_COLUMNS} from attendance_time_event e where ${where}
                 order by e.occurred_at desc, e.id limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from attendance_time_event e where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toTimeEvent,
    );
  }

  /**
   * Inserts the event, and lets the unique index decide.
   *
   * No `on conflict do nothing`: ingestion needs to *know* it lost so it can read the winner and
   * return that identifier. Swallowing the conflict would return a success naming nothing, which is
   * the shape of an idempotent endpoint that quietly does nothing.
   */
  public async insert(transaction: Transaction, state: TimeEventState): Promise<void> {
    await insertRow(transaction, this.table, timeEventInsert(state), new Date());
  }
}
