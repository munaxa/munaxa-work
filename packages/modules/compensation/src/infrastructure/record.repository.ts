import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { AdjustmentState } from '../domain/adjustment.js';
import type { OneTimeState } from '../domain/one-time.js';
import type {
  AdjustmentQuery,
  AdjustmentStore,
  OneTimeQuery,
  OneTimeStore,
  Page,
  PeriodQuery,
} from '../application/compensation-ports.js';

import {
  ADJUSTMENT_COLUMNS,
  ONE_TIME_COLUMNS,
  adjustmentValues,
  oneTimeValues,
  toAdjustment,
  toOneTime,
  type AdjustmentRow,
  type OneTimeRow,
} from './record-rows.js';
import { insertRow, mutable, pageOf, predicateFor } from './row-writer.js';

/**
 * One-time compensation and the adjustments that explain a change.
 *
 * Both are ordinary repositories, and both are narrow in the way that matters: an adjustment's
 * `update` writes an approval state and nothing else, because the reason somebody wrote down is not
 * something a later caller may revise.
 */
export class OneTimeRepository
  extends Repository<{ id: string; version: number }>
  implements OneTimeStore
{
  public constructor() {
    super('compensation_one_time');
  }

  public async byId(transaction: Transaction, id: string): Promise<OneTimeState | undefined> {
    const rows = await transaction.execute<OneTimeRow>(
      `select ${ONE_TIME_COLUMNS} from compensation_one_time o
        where o.id = $1 and o.tenant_id = $2 and o.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toOneTime(row);
  }

  public async payableWithin(
    transaction: Transaction,
    query: PeriodQuery,
  ): Promise<readonly OneTimeState[]> {
    if (query.employmentIds.length === 0) return [];

    const rows = await transaction.execute<OneTimeRow>(
      `select ${ONE_TIME_COLUMNS} from compensation_one_time o
        where o.tenant_id = $1 and o.employment_id = any($2::uuid[]) and o.deleted_at is null
          and o.payable_on between $3::date and $4::date
        order by o.employment_id, o.payable_on`,
      [transaction.tenantId, [...query.employmentIds], query.periodStart, query.periodEnd],
    );
    return rows.map(toOneTime);
  }

  public async recordedAfter(
    transaction: Transaction,
    recordedAfter: Date,
    period: { readonly from: string; readonly to: string },
    limit: number,
  ): Promise<readonly OneTimeState[]> {
    const rows = await transaction.execute<OneTimeRow>(
      `select ${ONE_TIME_COLUMNS} from compensation_one_time o
        where o.tenant_id = $1 and o.deleted_at is null and o.recorded_at > $2
          and o.payable_on between $3::date and $4::date
        order by o.recorded_at desc, o.id desc limit $5`,
      [transaction.tenantId, recordedAfter, period.from, period.to, limit],
    );
    return rows.map(toOneTime);
  }

  public async bySource(
    transaction: Transaction,
    source: {
      readonly source: string;
      readonly sourceId: string;
      readonly componentId: string;
      readonly employmentId: string;
    },
  ): Promise<OneTimeState | undefined> {
    const rows = await transaction.execute<OneTimeRow>(
      `select ${ONE_TIME_COLUMNS} from compensation_one_time o
        where o.tenant_id = $1 and o.source = $2 and o.source_id = $3
          and o.component_id = $4 and o.employment_id = $5 and o.deleted_at is null`,
      [
        transaction.tenantId,
        source.source,
        source.sourceId,
        source.componentId,
        source.employmentId,
      ],
    );
    const row = rows[0];

    return row === undefined ? undefined : toOneTime(row);
  }

  public search(transaction: Transaction, query: OneTimeQuery): Promise<Page<OneTimeState>> {
    const { clause, parameters, next } = predicateFor('o', transaction.tenantId, [
      { column: 'o.employment_id', value: query.employmentId, cast: '::uuid' },
      { column: 'o.component_id', value: query.componentId, cast: '::uuid' },
      { column: 'o.payable_on', value: query.fromDate, cast: '::date', operator: '>=' },
      { column: 'o.payable_on', value: query.toDate, cast: '::date', operator: '<=' },
    ]);

    return pageOf<OneTimeRow, OneTimeState>(
      transaction,
      {
        select: `select ${ONE_TIME_COLUMNS} from compensation_one_time o where ${clause}
                 order by o.payable_on desc, o.id desc
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from compensation_one_time o where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toOneTime,
    );
  }

  public async insert(transaction: Transaction, state: OneTimeState): Promise<void> {
    await insertRow(transaction, 'compensation_one_time', oneTimeValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: OneTimeState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(oneTimeValues(state)));
  }
}

export class AdjustmentRepository
  extends Repository<{ id: string; version: number }>
  implements AdjustmentStore
{
  public constructor() {
    super('compensation_adjustment');
  }

  public async byId(transaction: Transaction, id: string): Promise<AdjustmentState | undefined> {
    const rows = await transaction.execute<AdjustmentRow>(
      `select ${ADJUSTMENT_COLUMNS} from compensation_adjustment a
        where a.id = $1 and a.tenant_id = $2 and a.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toAdjustment(row);
  }

  public search(transaction: Transaction, query: AdjustmentQuery): Promise<Page<AdjustmentState>> {
    const { clause, parameters, next } = predicateFor('a', transaction.tenantId, [
      { column: 'a.employment_id', value: query.employmentId, cast: '::uuid' },
      { column: 'a.component_id', value: query.componentId, cast: '::uuid' },
    ]);

    return pageOf<AdjustmentRow, AdjustmentState>(
      transaction,
      {
        select: `select ${ADJUSTMENT_COLUMNS} from compensation_adjustment a where ${clause}
                 order by a.recorded_at desc, a.id desc
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from compensation_adjustment a where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toAdjustment,
    );
  }

  public async insert(transaction: Transaction, state: AdjustmentState): Promise<void> {
    await insertRow(transaction, 'compensation_adjustment', adjustmentValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: AdjustmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(adjustmentValues(state)));
  }
}
