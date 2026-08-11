import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { SegmentState, ShiftState } from '../domain/shift.js';
import type { SegmentStore, ShiftStore } from '../application/attendance-ports.js';

import {
  SEGMENT_COLUMNS,
  SHIFT_COLUMNS,
  segmentInsert,
  shiftInsert,
  shiftUpdate,
  toSegment,
  toShift,
  type SegmentRow,
  type ShiftRow,
} from './definition-rows.js';
import { insertRow } from './row-writer.js';

/**
 * Shifts and their segments, in PostgreSQL.
 *
 * `byIds` and `forShifts` exist because the calculation resolves a *page* of days at once: a day
 * screen for a thousand people would otherwise read a shift and its segments per row, and the
 * difference between one round trip and two thousand is the difference between a screen and a
 * timeout.
 */
export class ShiftRepository
  extends Repository<{ id: string; version: number }>
  implements ShiftStore
{
  public constructor() {
    super('attendance_shift');
  }

  public async byId(transaction: Transaction, id: string): Promise<ShiftState | undefined> {
    const rows = await transaction.execute<ShiftRow>(
      `select ${SHIFT_COLUMNS} from attendance_shift s
        where s.id = $1 and s.tenant_id = $2 and s.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toShift(row);
  }

  public async byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly ShiftState[]> {
    if (ids.length === 0) return [];

    const rows = await transaction.execute<ShiftRow>(
      `select ${SHIFT_COLUMNS} from attendance_shift s
        where s.tenant_id = $1 and s.id = any($2::uuid[]) and s.deleted_at is null`,
      [transaction.tenantId, [...ids]],
    );
    return rows.map(toShift);
  }

  /** The published shift of that code, or the draft if none is published yet. */
  public async byCode(transaction: Transaction, code: string): Promise<ShiftState | undefined> {
    const rows = await transaction.execute<ShiftRow>(
      `select ${SHIFT_COLUMNS} from attendance_shift s
        where s.tenant_id = $1 and s.code = $2 and s.deleted_at is null
        order by s.version_number desc limit 1`,
      [transaction.tenantId, code],
    );
    const row = rows[0];

    return row === undefined ? undefined : toShift(row);
  }

  public async all(transaction: Transaction): Promise<readonly ShiftState[]> {
    const rows = await transaction.execute<ShiftRow>(
      `select ${SHIFT_COLUMNS} from attendance_shift s
        where s.tenant_id = $1 and s.deleted_at is null order by s.code, s.version_number desc`,
      [transaction.tenantId],
    );
    return rows.map(toShift);
  }

  public async insert(transaction: Transaction, state: ShiftState): Promise<void> {
    await insertRow(transaction, this.table, shiftInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: ShiftState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, shiftUpdate(state));
  }
}

export class SegmentRepository
  extends Repository<{ id: string; version: number }>
  implements SegmentStore
{
  public constructor() {
    super('attendance_shift_segment');
  }

  public async forShift(
    transaction: Transaction,
    shiftId: string,
  ): Promise<readonly SegmentState[]> {
    const rows = await transaction.execute<SegmentRow>(
      `select ${SEGMENT_COLUMNS} from attendance_shift_segment g
        where g.tenant_id = $1 and g.shift_id = $2 and g.deleted_at is null order by g.sequence`,
      [transaction.tenantId, shiftId],
    );
    return rows.map(toSegment);
  }

  public async forShifts(
    transaction: Transaction,
    shiftIds: readonly string[],
  ): Promise<readonly SegmentState[]> {
    if (shiftIds.length === 0) return [];

    const rows = await transaction.execute<SegmentRow>(
      `select ${SEGMENT_COLUMNS} from attendance_shift_segment g
        where g.tenant_id = $1 and g.shift_id = any($2::uuid[]) and g.deleted_at is null
        order by g.shift_id, g.sequence`,
      [transaction.tenantId, [...shiftIds]],
    );
    return rows.map(toSegment);
  }

  public async insert(transaction: Transaction, state: SegmentState): Promise<void> {
    await insertRow(transaction, this.table, segmentInsert(state), new Date());
  }
}
