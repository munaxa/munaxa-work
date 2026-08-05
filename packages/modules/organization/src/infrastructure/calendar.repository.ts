import { Repository, auditForUpdate } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CalendarStore, StoredCalendarDay } from '../application/organization-ports.js';
import type { OrganizationCalendarState } from '../domain/organization-calendar.js';
import type { BilingualName } from '../domain/organization-aggregate.js';
import type {
  CalendarDayKind,
  IsoWeekday,
  OrganizationStatus,
} from '../domain/organization-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface CalendarRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualName;
  readonly unit_id: string | null;
  readonly time_zone: string;
  readonly working_days: readonly number[];
  readonly status: string;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

interface DayRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly calendar_id: string;
  readonly on_date: string;
  readonly kind: string;
  readonly name: BilingualName;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, code, name, unit_id, time_zone, working_days, status, effective_from, effective_to, version';

const toState = (row: CalendarRow): OrganizationCalendarState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  ...(row.unit_id === null ? {} : { unitId: row.unit_id }),
  timeZone: row.time_zone,
  workingDays: row.working_days as readonly IsoWeekday[],
  status: row.status as OrganizationStatus,
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  version: asVersion(row.version),
});

const toDay = (row: DayRow): StoredCalendarDay => ({
  id: row.id,
  tenantId: row.tenant_id,
  calendarId: row.calendar_id,
  onDate: row.on_date,
  kind: row.kind as CalendarDayKind,
  name: row.name,
  version: asVersion(row.version),
});

/**
 * Calendars and their days.
 *
 * `on_date` is a `date`, not a `timestamptz`, and it is read back as the text PostgreSQL stores
 * rather than parsed into a `Date`. A holiday is a *day in a place*, not an instant: turning
 * 2027-03-20 into a moment and rendering it anywhere east or west of the calendar's own zone
 * lands it on the day before or after, which is the classic way a public holiday moves.
 */
export class CalendarRepository
  extends Repository<CalendarRow & { id: string; version: number }>
  implements CalendarStore
{
  public constructor() {
    super('organization_calendar');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<OrganizationCalendarState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<OrganizationCalendarState | undefined> {
    const rows = await transaction.execute<CalendarRow>(
      `select ${COLUMNS} from organization_calendar
        where tenant_id = $1 and lower(code) = lower($2) and deleted_at is null`,
      [transaction.tenantId, code],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async list(transaction: Transaction): Promise<readonly OrganizationCalendarState[]> {
    const rows = await transaction.execute<CalendarRow>(
      `select ${COLUMNS} from organization_calendar
        where tenant_id = $1 and deleted_at is null order by code`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: OrganizationCalendarState): Promise<void> {
    await insertRow(
      transaction,
      'organization_calendar',
      {
        id: state.id,
        tenant_id: state.tenantId,
        code: state.code,
        name: JSON.stringify(state.name),
        unit_id: state.unitId ?? null,
        time_zone: state.timeZone,
        working_days: [...state.workingDays],
        status: state.status,
        effective_from: state.effectiveFrom,
        effective_to: state.effectiveTo ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: OrganizationCalendarState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      name: JSON.stringify(state.name),
      time_zone: state.timeZone,
      working_days: [...state.workingDays],
      status: state.status,
      effective_to: state.effectiveTo ?? null,
    });
  }

  public async daysBetween(
    transaction: Transaction,
    calendarId: string,
    from: string,
    to: string,
  ): Promise<readonly StoredCalendarDay[]> {
    const rows = await transaction.execute<DayRow>(
      `select id, tenant_id, calendar_id, to_char(on_date, 'YYYY-MM-DD') as on_date, kind, name, version
         from organization_calendar_day
        where tenant_id = $1 and calendar_id = $2 and deleted_at is null
          and on_date between $3::date and $4::date
        order by on_date`,
      [transaction.tenantId, calendarId, from, to],
    );
    return rows.map(toDay);
  }

  public async dayOn(
    transaction: Transaction,
    calendarId: string,
    onDate: string,
  ): Promise<StoredCalendarDay | undefined> {
    const rows = await transaction.execute<DayRow>(
      `select id, tenant_id, calendar_id, to_char(on_date, 'YYYY-MM-DD') as on_date, kind, name, version
         from organization_calendar_day
        where tenant_id = $1 and calendar_id = $2 and on_date = $3::date and deleted_at is null`,
      [transaction.tenantId, calendarId, onDate],
    );
    const row = rows[0];
    return row === undefined ? undefined : toDay(row);
  }

  /**
   * Recording a date that already has an entry replaces it, in one statement.
   *
   * A read-then-write would leave a gap in which two concurrent administrators both see no row
   * and both insert one — and the unique index would then reject the second with a constraint
   * violation rather than the intended replacement.
   */
  public async upsertDay(transaction: Transaction, day: StoredCalendarDay): Promise<void> {
    await transaction.execute(
      `insert into organization_calendar_day
         (id, tenant_id, calendar_id, on_date, kind, name,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, $4::date, $5, $6, now(), $7, now(), $7, 1)
       on conflict (tenant_id, calendar_id, on_date) do update
         set kind = excluded.kind,
             name = excluded.name,
             updated_at = now(),
             updated_by = excluded.updated_by,
             deleted_at = null,
             deleted_by = null,
             version = organization_calendar_day.version + 1`,
      [
        day.id,
        day.tenantId,
        day.calendarId,
        day.onDate,
        day.kind,
        JSON.stringify(day.name),
        actorOf(),
      ],
    );
  }

  public async removeDay(
    transaction: Transaction,
    calendarId: string,
    onDate: string,
  ): Promise<void> {
    await transaction.execute(
      `update organization_calendar_day
          set deleted_at = now(), deleted_by = $4, updated_at = now(), updated_by = $4,
              version = version + 1
        where tenant_id = $1 and calendar_id = $2 and on_date = $3::date and deleted_at is null`,
      [transaction.tenantId, calendarId, onDate, actorOf()],
    );
  }
}

/**
 * The audit actor for the two statements this repository writes by hand.
 *
 * `insertRow` and `updateRow` derive it from the execution context, and neither can be used here
 * — one of these is an upsert and the other a soft delete on a composite key. Rather than
 * inventing a second answer, this asks the same function they do, so a calendar day records the
 * same actor as every other row in the product instead of quietly saying `system`.
 */
const actorOf = (): string => auditForUpdate(new Date()).updated_by;
