import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CustodyRecord } from '../domain/custody.js';
import type { CustodyFilters, CustodyStore, Page, Paged } from '../application/assets-ports.js';
import { CUSTODY_COLUMNS, custodyState, custodyValues, type CustodyRow } from './asset-rows.js';
import { insertRow, mutable, pageOf, predicateFor, type Filter } from './row-writer.js';

/**
 * Custody, in PostgreSQL.
 *
 * **Reads, an insert and an update no *returned* row can survive.** The trigger refuses an update or
 * a delete on a returned custody from any path, so this class offers an update only because an open
 * custody is a period still in progress. There is no remove: a custody that happened, happened.
 *
 * `openFor` is the derived current holder. It is **not** what makes "one custody at a time" true —
 * `asset_custody_open_idx` is, because a read that precedes an insert decides nothing under
 * concurrency (ADR-0071).
 *
 * Both collection reads take a subject, so nothing here can enumerate a tenant's custodies at large,
 * and both order newest-issued first with the identifier as a tiebreak so a page boundary never lands
 * in the middle of two custodies issued on one day.
 */
export class PostgresCustodyRepository
  extends Repository<CustodyRow & { version: number }>
  implements CustodyStore
{
  public constructor() {
    super('asset_custody');
  }

  public async byId(transaction: Transaction, id: string): Promise<CustodyRecord | undefined> {
    const rows = await transaction.execute<CustodyRow>(
      `select ${CUSTODY_COLUMNS} from asset_custody
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : custodyState(rows[0]);
  }

  public async openFor(
    transaction: Transaction,
    assetId: string,
  ): Promise<CustodyRecord | undefined> {
    const rows = await transaction.execute<CustodyRow>(
      `select ${CUSTODY_COLUMNS} from asset_custody
         where tenant_id = $1 and asset_id = $2 and state = 'open' and deleted_at is null`,
      [transaction.tenantId, assetId],
    );

    return rows[0] === undefined ? undefined : custodyState(rows[0]);
  }

  public forAsset(
    transaction: Transaction,
    assetId: string,
    paged: Paged,
  ): Promise<Page<CustodyRecord>> {
    return this.page(transaction, [{ column: 'c.asset_id', value: assetId }], paged);
  }

  public forEmployment(
    transaction: Transaction,
    employmentId: string,
    filters: CustodyFilters,
    paged: Paged,
  ): Promise<Page<CustodyRecord>> {
    return this.page(
      transaction,
      [
        { column: 'c.employment_id', value: employmentId },
        { column: 'c.state', value: filters.openOnly === true ? 'open' : undefined },
      ],
      paged,
    );
  }

  public insert(transaction: Transaction, state: CustodyRecord): Promise<void> {
    return insertRow(
      transaction,
      'asset_custody',
      custodyValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: CustodyRecord,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.assetCustodyId,
      expected,
      mutable(custodyValues(state, transaction.tenantId)),
    );
  }

  /** One paged read, so the two collection queries cannot drift apart in ordering or in bounds. */
  private page(
    transaction: Transaction,
    filters: readonly Filter[],
    paged: Paged,
  ): Promise<Page<CustodyRecord>> {
    const predicate = predicateFor('c', transaction.tenantId, filters);

    return pageOf<CustodyRow, CustodyRecord>(
      transaction,
      {
        select: `select ${CUSTODY_COLUMNS} from asset_custody c
                   where ${predicate.clause}
                   order by c.issued_on desc, c.id
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from asset_custody c where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      custodyState,
    );
  }
}
