import type { Transaction } from '@work/kernel';

import type { LedgerBucket, LedgerEntryState } from '../domain/ledger.js';
import type { LedgerQuery, LedgerStore, Page } from '../application/leave-ports.js';

import { LEDGER_COLUMNS, ledgerValues, toLedgerEntry, type LedgerRow } from './ledger-rows.js';
import { insertRow, pageOf, predicateFor } from './row-writer.js';

/**
 * The authoritative ledger, in PostgreSQL.
 *
 * **It offers `insert` and reads, and nothing else.** No `update`, no `remove`, no `restore` — not
 * because a caller is trusted not to use them but because they do not exist. A balance somebody
 * disputes is a sum of rows, and the cheapest guarantee that nobody rewrote one is to have no
 * method that could (ADR-0052 applied to a second module).
 *
 * `bySource` is the idempotency read every bounded run rests on, backed by
 * `leave_ledger_source_key`: an accrual repeated, an approval retried and a leave-year close rerun
 * each find their entry already present and write nothing.
 */
export class LeaveLedgerRepository implements LedgerStore {
  public async byId(transaction: Transaction, id: string): Promise<LedgerEntryState | undefined> {
    const rows = await transaction.execute<LedgerRow>(
      `select ${LEDGER_COLUMNS} from leave_ledger_entry l
        where l.id = $1 and l.tenant_id = $2 and l.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toLedgerEntry(row);
  }

  public async forBucket(
    transaction: Transaction,
    bucket: LedgerBucket,
  ): Promise<readonly LedgerEntryState[]> {
    const rows = await transaction.execute<LedgerRow>(
      `select ${LEDGER_COLUMNS} from leave_ledger_entry l
        where l.tenant_id = $1 and l.employment_id = $2 and l.leave_type_id = $3
          and l.leave_year_start = $4::date and l.deleted_at is null
        order by l.effective_on, l.id`,
      [transaction.tenantId, bucket.employmentId, bucket.leaveTypeId, bucket.leaveYearStart],
    );
    return rows.map(toLedgerEntry);
  }

  public async forBucketUpTo(
    transaction: Transaction,
    bucket: LedgerBucket,
    onDate: string,
  ): Promise<readonly LedgerEntryState[]> {
    const rows = await transaction.execute<LedgerRow>(
      `select ${LEDGER_COLUMNS} from leave_ledger_entry l
        where l.tenant_id = $1 and l.employment_id = $2 and l.leave_type_id = $3
          and l.leave_year_start = $4::date and l.effective_on <= $5::date
          and l.deleted_at is null
        order by l.effective_on, l.id`,
      [
        transaction.tenantId,
        bucket.employmentId,
        bucket.leaveTypeId,
        bucket.leaveYearStart,
        onDate,
      ],
    );
    return rows.map(toLedgerEntry);
  }

  public async bySource(
    transaction: Transaction,
    source: { readonly sourceKind: string; readonly sourceId: string; readonly kind: string },
  ): Promise<LedgerEntryState | undefined> {
    const rows = await transaction.execute<LedgerRow>(
      `select ${LEDGER_COLUMNS} from leave_ledger_entry l
        where l.tenant_id = $1 and l.source_kind = $2 and l.source_id = $3 and l.kind = $4
          and l.deleted_at is null`,
      [transaction.tenantId, source.sourceKind, source.sourceId, source.kind],
    );
    const row = rows[0];

    return row === undefined ? undefined : toLedgerEntry(row);
  }

  public async forSource(
    transaction: Transaction,
    source: { readonly sourceKind: string; readonly sourceId: string },
  ): Promise<readonly LedgerEntryState[]> {
    const rows = await transaction.execute<LedgerRow>(
      `select ${LEDGER_COLUMNS} from leave_ledger_entry l
        where l.tenant_id = $1 and l.source_kind = $2 and l.source_id = $3
          and l.deleted_at is null order by l.recorded_at`,
      [transaction.tenantId, source.sourceKind, source.sourceId],
    );
    return rows.map(toLedgerEntry);
  }

  public search(transaction: Transaction, query: LedgerQuery): Promise<Page<LedgerEntryState>> {
    const { clause, parameters, next } = predicateFor('l', transaction.tenantId, [
      { column: 'l.employment_id', value: query.employmentId },
      { column: 'l.leave_type_id', value: query.leaveTypeId },
      { column: 'l.leave_year_start', value: query.leaveYearStart, cast: '::date' },
      { column: 'l.kind', value: query.kind },
      { column: 'l.effective_on', value: query.fromDate, cast: '::date', operator: '>=' },
      { column: 'l.effective_on', value: query.toDate, cast: '::date', operator: '<=' },
    ]);

    return pageOf<LedgerRow, LedgerEntryState>(
      transaction,
      {
        select: `select ${LEDGER_COLUMNS} from leave_ledger_entry l where ${clause}
                 order by l.effective_on desc, l.id desc
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from leave_ledger_entry l where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toLedgerEntry,
    );
  }

  public async insert(transaction: Transaction, state: LedgerEntryState): Promise<void> {
    await insertRow(transaction, 'leave_ledger_entry', ledgerValues(state), new Date());
  }
}
