import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type {
  ScheduleAssignmentState,
  ScheduleDayState,
  ScheduleState,
} from '../domain/schedule.js';
import type {
  AssignmentStore,
  ScheduleDayStore,
  ScheduleStore,
} from '../application/attendance-ports.js';

import {
  ASSIGNMENT_COLUMNS,
  SCHEDULE_COLUMNS,
  SCHEDULE_DAY_COLUMNS,
  assignmentInsert,
  assignmentUpdate,
  scheduleDayInsert,
  scheduleInsert,
  scheduleUpdate,
  toAssignment,
  toSchedule,
  toScheduleDay,
  type AssignmentRow,
  type ScheduleDayRow,
  type ScheduleRow,
} from './definition-rows.js';
import { insertRow } from './row-writer.js';

/**
 * Schedules, their cycle and the assignments that put people on them, in PostgreSQL.
 *
 * `forEmployment` returns **every** assignment rather than the one in force today, because the
 * question this module asks is always "which applied on that date" — and answering it in SQL with
 * `current_date` would make a recalculation of March use June's rota. The date comparison is the
 * domain's `assignmentOn`, run against the whole history (ADR-0053).
 */
export class ScheduleRepository
  extends Repository<{ id: string; version: number }>
  implements ScheduleStore
{
  public constructor() {
    super('attendance_schedule');
  }

  public async byId(transaction: Transaction, id: string): Promise<ScheduleState | undefined> {
    const rows = await transaction.execute<ScheduleRow>(
      `select ${SCHEDULE_COLUMNS} from attendance_schedule c
        where c.id = $1 and c.tenant_id = $2 and c.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toSchedule(row);
  }

  public async byCode(transaction: Transaction, code: string): Promise<ScheduleState | undefined> {
    const rows = await transaction.execute<ScheduleRow>(
      `select ${SCHEDULE_COLUMNS} from attendance_schedule c
        where c.tenant_id = $1 and c.code = $2 and c.deleted_at is null
        order by c.version_number desc limit 1`,
      [transaction.tenantId, code],
    );
    const row = rows[0];

    return row === undefined ? undefined : toSchedule(row);
  }

  public async all(transaction: Transaction): Promise<readonly ScheduleState[]> {
    const rows = await transaction.execute<ScheduleRow>(
      `select ${SCHEDULE_COLUMNS} from attendance_schedule c
        where c.tenant_id = $1 and c.deleted_at is null order by c.code, c.version_number desc`,
      [transaction.tenantId],
    );
    return rows.map(toSchedule);
  }

  public async insert(transaction: Transaction, state: ScheduleState): Promise<void> {
    await insertRow(transaction, this.table, scheduleInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: ScheduleState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, scheduleUpdate(state));
  }
}

export class ScheduleDayRepository
  extends Repository<{ id: string; version: number }>
  implements ScheduleDayStore
{
  public constructor() {
    super('attendance_schedule_day');
  }

  public async forSchedule(
    transaction: Transaction,
    scheduleId: string,
  ): Promise<readonly ScheduleDayState[]> {
    const rows = await transaction.execute<ScheduleDayRow>(
      `select ${SCHEDULE_DAY_COLUMNS} from attendance_schedule_day y
        where y.tenant_id = $1 and y.schedule_id = $2 and y.deleted_at is null
        order by y.cycle_position`,
      [transaction.tenantId, scheduleId],
    );
    return rows.map(toScheduleDay);
  }

  public async insert(transaction: Transaction, state: ScheduleDayState): Promise<void> {
    await insertRow(transaction, this.table, scheduleDayInsert(state), new Date());
  }
}

export class AssignmentRepository
  extends Repository<{ id: string; version: number }>
  implements AssignmentStore
{
  public constructor() {
    super('attendance_schedule_assignment');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ScheduleAssignmentState | undefined> {
    const rows = await transaction.execute<AssignmentRow>(
      `select ${ASSIGNMENT_COLUMNS} from attendance_schedule_assignment a
        where a.id = $1 and a.tenant_id = $2 and a.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toAssignment(row);
  }

  public async forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly ScheduleAssignmentState[]> {
    const rows = await transaction.execute<AssignmentRow>(
      `select ${ASSIGNMENT_COLUMNS} from attendance_schedule_assignment a
        where a.tenant_id = $1 and a.employment_id = $2 and a.deleted_at is null
        order by a.effective_from`,
      [transaction.tenantId, employmentId],
    );
    return rows.map(toAssignment);
  }

  public async insert(transaction: Transaction, state: ScheduleAssignmentState): Promise<void> {
    await insertRow(transaction, this.table, assignmentInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: ScheduleAssignmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, assignmentUpdate(state));
  }
}
