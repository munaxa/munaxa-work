import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { RecurringState } from '../domain/recurring.js';
import type {
  Page,
  PeriodQuery,
  RecurringQuery,
  RecurringStore,
} from '../application/compensation-ports.js';

import {
  RECURRING_COLUMNS,
  recurringValues,
  toRecurring,
  type RecurringRow,
} from './record-rows.js';
import { insertRow, mutable, pageOf, predicateFor } from './row-writer.js';

/**
 * The authoritative recurring records, in PostgreSQL.
 *
 * **`overlappingPeriod` is the one to read.** It resolves a whole page of employments in a single
 * statement, and it is the query decision D-7 rests on: no projection was built because the
 * authoritative rows answer the payroll-period question fast enough, and this is why. The
 * alternative — a timeline read per employment — would be 100,000 round trips per payroll run.
 *
 * The index it leads with is `(tenant_id, employment_id, component_id, effective_from desc)`, which
 * is also what `inForceOn` and the current-compensation read use.
 *
 * `update` writes an end date, an approval state and an approval instant. It cannot write an
 * amount, a currency or an effective start, because `mutable(...)` is built from the same values
 * object as the insert and the caller passes the state it read — a superseded row's value columns
 * are never *given* a new value to write.
 */
export class RecurringRepository
  extends Repository<{ id: string; version: number }>
  implements RecurringStore
{
  public constructor() {
    super('compensation_recurring');
  }

  public async byId(transaction: Transaction, id: string): Promise<RecurringState | undefined> {
    const rows = await transaction.execute<RecurringRow>(
      `select ${RECURRING_COLUMNS} from compensation_recurring r
        where r.id = $1 and r.tenant_id = $2 and r.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toRecurring(row);
  }

  public async forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly RecurringState[]> {
    const rows = await transaction.execute<RecurringRow>(
      `select ${RECURRING_COLUMNS} from compensation_recurring r
        where r.tenant_id = $1 and r.employment_id = $2 and r.deleted_at is null
        order by r.component_id, r.effective_from`,
      [transaction.tenantId, employmentId],
    );
    return rows.map(toRecurring);
  }

  public async forComponent(
    transaction: Transaction,
    employmentId: string,
    componentId: string,
  ): Promise<readonly RecurringState[]> {
    const rows = await transaction.execute<RecurringRow>(
      `select ${RECURRING_COLUMNS} from compensation_recurring r
        where r.tenant_id = $1 and r.employment_id = $2 and r.component_id = $3
          and r.deleted_at is null
        order by r.effective_from`,
      [transaction.tenantId, employmentId, componentId],
    );
    return rows.map(toRecurring);
  }

  public async inForceOn(
    transaction: Transaction,
    employmentId: string,
    onDate: string,
  ): Promise<readonly RecurringState[]> {
    const rows = await transaction.execute<RecurringRow>(
      `select ${RECURRING_COLUMNS} from compensation_recurring r
        where r.tenant_id = $1 and r.employment_id = $2 and r.deleted_at is null
          and r.effective_from <= $3::date
          and (r.effective_to is null or r.effective_to > $3::date)
        order by r.component_id`,
      [transaction.tenantId, employmentId, onDate],
    );
    return rows.map(toRecurring);
  }

  /** **The set-based payroll read.** One statement for a page of employments. */
  public async overlappingPeriod(
    transaction: Transaction,
    query: PeriodQuery,
  ): Promise<readonly RecurringState[]> {
    if (query.employmentIds.length === 0) return [];

    const rows = await transaction.execute<RecurringRow>(
      `select ${RECURRING_COLUMNS} from compensation_recurring r
        where r.tenant_id = $1 and r.employment_id = any($2::uuid[]) and r.deleted_at is null
          and r.effective_from <= $4::date
          and (r.effective_to is null or r.effective_to > $3::date)
        order by r.employment_id, r.component_id, r.effective_from`,
      [transaction.tenantId, [...query.employmentIds], query.periodStart, query.periodEnd],
    );
    return rows.map(toRecurring);
  }

  /**
   * The reconciliation read: what has been **recorded** since a caller last looked.
   *
   * System time, not business time — a raise effective in March entered in April appears to a
   * caller asking about April, which is exactly what a payroll run needs and exactly what an
   * effective-date filter cannot answer.
   */
  public async recordedAfter(
    transaction: Transaction,
    recordedAfter: Date,
    period: { readonly from: string; readonly to: string },
    limit: number,
  ): Promise<readonly RecurringState[]> {
    const rows = await transaction.execute<RecurringRow>(
      `select ${RECURRING_COLUMNS} from compensation_recurring r
        where r.tenant_id = $1 and r.deleted_at is null and r.recorded_at > $2
          and r.effective_from <= $4::date
          and (r.effective_to is null or r.effective_to > $3::date)
        order by r.recorded_at desc, r.id desc limit $5`,
      [transaction.tenantId, recordedAfter, period.from, period.to, limit],
    );
    return rows.map(toRecurring);
  }

  public async bySource(
    transaction: Transaction,
    source: {
      readonly source: string;
      readonly sourceId: string;
      readonly componentId: string;
      readonly employmentId: string;
    },
  ): Promise<RecurringState | undefined> {
    const rows = await transaction.execute<RecurringRow>(
      `select ${RECURRING_COLUMNS} from compensation_recurring r
        where r.tenant_id = $1 and r.source = $2 and r.source_id = $3
          and r.component_id = $4 and r.employment_id = $5 and r.deleted_at is null`,
      [
        transaction.tenantId,
        source.source,
        source.sourceId,
        source.componentId,
        source.employmentId,
      ],
    );
    const row = rows[0];

    return row === undefined ? undefined : toRecurring(row);
  }

  public search(transaction: Transaction, query: RecurringQuery): Promise<Page<RecurringState>> {
    const { clause, parameters, next } = predicateFor('r', transaction.tenantId, [
      { column: 'r.employment_id', value: query.employmentId, cast: '::uuid' },
      { column: 'r.component_id', value: query.componentId, cast: '::uuid' },
      { column: 'r.effective_from', value: query.effectiveOn, cast: '::date', operator: '<=' },
    ]);

    return pageOf<RecurringRow, RecurringState>(
      transaction,
      {
        select: `select ${RECURRING_COLUMNS} from compensation_recurring r where ${clause}
                 order by r.effective_from desc, r.id desc
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from compensation_recurring r where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toRecurring,
    );
  }

  public async insert(transaction: Transaction, state: RecurringState): Promise<void> {
    await insertRow(transaction, 'compensation_recurring', recurringValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: RecurringState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(recurringValues(state)));
  }
}
