import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CorrectionRequestState } from '../domain/correction.js';
import type {
  CorrectionQuery,
  CorrectionStore,
  ImportBatchState,
  ImportBatchStore,
  Page,
  SnapshotState,
  SnapshotStore,
} from '../application/attendance-ports.js';

import {
  CORRECTION_COLUMNS,
  IMPORT_COLUMNS,
  SNAPSHOT_COLUMNS,
  correctionInsert,
  correctionUpdate,
  importBatchInsert,
  importBatchUpdate,
  snapshotInsert,
  toCorrection,
  toImportBatch,
  toSnapshot,
  type CorrectionRow,
  type ImportBatchRow,
  type SnapshotRow,
} from './record-rows.js';
import { correctionFilters } from './attendance-search.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * Corrections, payable snapshots and import batches, in PostgreSQL.
 *
 * `appliedRemovals` is how an approved removal reaches the calculation. The event stays in the
 * table, readable and unaltered; the *correction* is the tombstone, and this read is what tells the
 * calculation to leave it out of the arithmetic. Nothing here deletes an event and nothing writes a
 * compensating punch that never happened (ADR-0052).
 */
export class CorrectionRepository
  extends Repository<{ id: string; version: number }>
  implements CorrectionStore
{
  public constructor() {
    super('attendance_correction_request');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<CorrectionRequestState | undefined> {
    const rows = await transaction.execute<CorrectionRow>(
      `select ${CORRECTION_COLUMNS} from attendance_correction_request n
        where n.id = $1 and n.tenant_id = $2 and n.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toCorrection(row);
  }

  public async appliedRemovals(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<readonly string[]> {
    const rows = await transaction.execute<{ target_event_id: string }>(
      `select n.target_event_id from attendance_correction_request n
        where n.tenant_id = $1 and n.employment_id = $2 and n.attendance_date = $3::date
          and n.kind = 'remove_event' and n.state = 'applied'
          and n.target_event_id is not null and n.deleted_at is null`,
      [transaction.tenantId, employmentId, attendanceDate],
    );
    return rows.map((row) => row.target_event_id);
  }

  public search(
    transaction: Transaction,
    query: CorrectionQuery,
  ): Promise<Page<CorrectionRequestState>> {
    const { where, parameters } = correctionFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<CorrectionRow, CorrectionRequestState>(
      transaction,
      {
        select: `select ${CORRECTION_COLUMNS} from attendance_correction_request n where ${where}
                 order by n.requested_at desc, n.id limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from attendance_correction_request n where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toCorrection,
    );
  }

  public async insert(transaction: Transaction, state: CorrectionRequestState): Promise<void> {
    await insertRow(transaction, this.table, correctionInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: CorrectionRequestState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, correctionUpdate(state));
  }
}

/**
 * The frozen figures Payroll reads.
 *
 * **Inserted and read; there is no update.** A correction after a freeze produces the next sequence
 * rather than altering the row somebody already paid from, and the absence of an update method is
 * what makes that a property of the system rather than a convention (ADR-0054).
 */
export class SnapshotRepository
  extends Repository<{ id: string; version: number }>
  implements SnapshotStore
{
  public constructor() {
    super('attendance_payable_snapshot');
  }

  public async latest(
    transaction: Transaction,
    employmentId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<SnapshotState | undefined> {
    const rows = await transaction.execute<SnapshotRow>(
      `select ${SNAPSHOT_COLUMNS} from attendance_payable_snapshot t
        where t.tenant_id = $1 and t.employment_id = $2 and t.period_start = $3::date
          and t.period_end = $4::date and t.deleted_at is null
        order by t.sequence desc limit 1`,
      [transaction.tenantId, employmentId, periodStart, periodEnd],
    );
    const row = rows[0];

    return row === undefined ? undefined : toSnapshot(row);
  }

  public async forPeriod(
    transaction: Transaction,
    periodStart: string,
    periodEnd: string,
    employmentId?: string,
  ): Promise<readonly SnapshotState[]> {
    const rows = await transaction.execute<SnapshotRow>(
      `select ${SNAPSHOT_COLUMNS} from attendance_payable_snapshot t
        where t.tenant_id = $1 and t.period_start = $2::date and t.period_end = $3::date
          and t.deleted_at is null and ($4::uuid is null or t.employment_id = $4::uuid)
        order by t.employment_id, t.sequence`,
      [transaction.tenantId, periodStart, periodEnd, employmentId ?? null],
    );
    return rows.map(toSnapshot);
  }

  public async insert(transaction: Transaction, state: SnapshotState): Promise<void> {
    await insertRow(transaction, this.table, snapshotInsert(state), new Date());
  }
}

/** What an import run did, kept so a re-run's "skipped everything" is a claim somebody can check. */
export class ImportBatchRepository
  extends Repository<{ id: string; version: number }>
  implements ImportBatchStore
{
  public constructor() {
    super('attendance_import_batch');
  }

  public async byId(transaction: Transaction, id: string): Promise<ImportBatchState | undefined> {
    const rows = await transaction.execute<ImportBatchRow>(
      `select ${IMPORT_COLUMNS} from attendance_import_batch b
        where b.id = $1 and b.tenant_id = $2 and b.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toImportBatch(row);
  }

  public async recent(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ImportBatchState[]> {
    const rows = await transaction.execute<ImportBatchRow>(
      `select ${IMPORT_COLUMNS} from attendance_import_batch b
        where b.tenant_id = $1 and b.deleted_at is null order by b.submitted_at desc limit $2`,
      [transaction.tenantId, limit],
    );
    return rows.map(toImportBatch);
  }

  public async insert(transaction: Transaction, state: ImportBatchState): Promise<void> {
    await insertRow(transaction, this.table, importBatchInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: ImportBatchState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, importBatchUpdate(state));
  }
}
