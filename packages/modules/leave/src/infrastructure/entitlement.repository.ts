import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { AdjustmentState, EntitlementState } from '../domain/entitlement.js';
import type { LedgerBucket } from '../domain/ledger.js';
import type {
  AdjustmentQuery,
  AdjustmentStore,
  EntitlementQuery,
  EntitlementSource,
  EntitlementStore,
  Page,
} from '../application/leave-ports.js';

import {
  ADJUSTMENT_COLUMNS,
  ENTITLEMENT_COLUMNS,
  adjustmentValues,
  entitlementValues,
  toAdjustment,
  toEntitlement,
  type AdjustmentRow,
  type EntitlementRow,
} from './ledger-rows.js';
import { insertRow, pageOf, predicateFor } from './row-writer.js';

/**
 * Entitlements and adjustments, in PostgreSQL.
 *
 * `bySource` is backed by `leave_entitlement_source_key` and is what makes an interrupted accrual
 * run safe to restart: the run finds its own grants and skips them.
 *
 * Both are **inserted and read**. A grant that was wrong is corrected by an adjustment, which is
 * its own row with its own actor and its own written reason — not by editing the grant.
 */
export class EntitlementRepository
  extends Repository<{ id: string; version: number }>
  implements EntitlementStore
{
  public constructor() {
    super('leave_entitlement');
  }

  public async byId(transaction: Transaction, id: string): Promise<EntitlementState | undefined> {
    const rows = await transaction.execute<EntitlementRow>(
      `select ${ENTITLEMENT_COLUMNS} from leave_entitlement e
        where e.id = $1 and e.tenant_id = $2 and e.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toEntitlement(row);
  }

  /** The idempotency read an accrual run makes. Backed by `leave_entitlement_source_key`. */
  public async bySource(
    transaction: Transaction,
    source: EntitlementSource,
  ): Promise<EntitlementState | undefined> {
    const rows = await transaction.execute<EntitlementRow>(
      `select ${ENTITLEMENT_COLUMNS} from leave_entitlement e
        where e.tenant_id = $1 and e.employment_id = $2 and e.leave_type_id = $3
          and e.leave_year_start = $4::date and e.source = $5 and e.source_id = $6::uuid
          and e.deleted_at is null`,
      [
        transaction.tenantId,
        source.employmentId,
        source.leaveTypeId,
        source.leaveYearStart,
        source.source,
        source.sourceId,
      ],
    );
    const row = rows[0];

    return row === undefined ? undefined : toEntitlement(row);
  }

  public async forBucket(
    transaction: Transaction,
    bucket: LedgerBucket,
  ): Promise<readonly EntitlementState[]> {
    const rows = await transaction.execute<EntitlementRow>(
      `select ${ENTITLEMENT_COLUMNS} from leave_entitlement e
        where e.tenant_id = $1 and e.employment_id = $2 and e.leave_type_id = $3
          and e.leave_year_start = $4::date and e.deleted_at is null`,
      [transaction.tenantId, bucket.employmentId, bucket.leaveTypeId, bucket.leaveYearStart],
    );
    return rows.map(toEntitlement);
  }

  public search(
    transaction: Transaction,
    query: EntitlementQuery,
  ): Promise<Page<EntitlementState>> {
    const { clause, parameters, next } = predicateFor('e', transaction.tenantId, [
      { column: 'e.employment_id', value: query.employmentId },
      { column: 'e.leave_type_id', value: query.leaveTypeId },
      { column: 'e.leave_year_start', value: query.leaveYearStart, cast: '::date' },
    ]);

    return pageOf<EntitlementRow, EntitlementState>(
      transaction,
      {
        select: `select ${ENTITLEMENT_COLUMNS} from leave_entitlement e where ${clause}
                 order by e.leave_year_start desc, e.id
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from leave_entitlement e where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toEntitlement,
    );
  }

  public async insert(transaction: Transaction, state: EntitlementState): Promise<void> {
    await insertRow(transaction, 'leave_entitlement', entitlementValues(state), new Date());
  }
}

export class AdjustmentRepository
  extends Repository<{ id: string; version: number }>
  implements AdjustmentStore
{
  public constructor() {
    super('leave_adjustment');
  }

  public async byId(transaction: Transaction, id: string): Promise<AdjustmentState | undefined> {
    const rows = await transaction.execute<AdjustmentRow>(
      `select ${ADJUSTMENT_COLUMNS} from leave_adjustment j
        where j.id = $1 and j.tenant_id = $2 and j.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toAdjustment(row);
  }

  public search(transaction: Transaction, query: AdjustmentQuery): Promise<Page<AdjustmentState>> {
    const { clause, parameters, next } = predicateFor('j', transaction.tenantId, [
      { column: 'j.employment_id', value: query.employmentId },
      { column: 'j.leave_type_id', value: query.leaveTypeId },
    ]);

    return pageOf<AdjustmentRow, AdjustmentState>(
      transaction,
      {
        select: `select ${ADJUSTMENT_COLUMNS} from leave_adjustment j where ${clause}
                 order by j.adjusted_at desc, j.id
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from leave_adjustment j where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toAdjustment,
    );
  }

  public async insert(transaction: Transaction, state: AdjustmentState): Promise<void> {
    await insertRow(transaction, 'leave_adjustment', adjustmentValues(state), new Date());
  }
}
