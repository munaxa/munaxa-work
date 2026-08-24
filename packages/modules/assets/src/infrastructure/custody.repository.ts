import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CustodyRecord } from '../domain/custody.js';
import type {
  CustodyFilters,
  CustodyStore,
  CustodySummary,
  OutstandingCustodies,
  Page,
  Paged,
} from '../application/assets-ports.js';
import { CUSTODY_COLUMNS, custodyState, custodyValues, type CustodyRow } from './asset-rows.js';
import {
  civilDateColumn,
  insertRow,
  mutable,
  pageOf,
  predicateFor,
  type Filter,
} from './row-writer.js';

/** One row of the clearance join. Only what a blocker needs — no note, no status, no tenant. */
interface OutstandingRow {
  readonly id: string;
  readonly asset_id: string;
  readonly asset_tag: string;
  readonly asset_category_id: string;
  readonly issued_on: string;
}

/** The aggregate's own row shape. `min` over no rows is `null`, which is the empty tenant. */
interface CustodySummaryRow {
  readonly open_count: string;
  readonly oldest_issued_on: string | null;
}

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
 * Every read that returns rows takes a subject, so nothing here can enumerate a tenant's custodies at
 * large. `openSummary` is the one read without one and it returns no identifier at all — a count and a
 * date. The two collection reads order newest-issued first with the identifier as a tiebreak, so a page
 * boundary never lands in the middle of two custodies issued on one day; the clearance read orders
 * oldest first instead, because the item held longest is where a clearance conversation starts.
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

  /**
   * What is open across the tenant, counted rather than listed.
   *
   * A count over a whole tenant cannot be assembled from pages in the application, so it is computed
   * where the rows are. **It selects no identifier** — a count and a minimum date, and nothing that
   * names an asset, a custody or an employment.
   *
   * The oldest issue date is projected with `to_char` for the same reason every civil date in this
   * module is: a `date` that came back as a driver's `Date` would arrive shifted by a timezone nobody
   * chose. The elapsed days are then derived in the application, so one implementation of that
   * arithmetic serves both this and the item reads.
   *
   * Row-level security is what confines this to one tenant; the predicate names no tenant column of
   * its own beyond the one every read here carries.
   */
  public async openSummary(transaction: Transaction): Promise<CustodySummary> {
    const rows = await transaction.execute<CustodySummaryRow>(
      `select count(*)::text as open_count,
              to_char(min(issued_on), 'YYYY-MM-DD') as oldest_issued_on
         from asset_custody
        where tenant_id = $1 and state = 'open' and deleted_at is null`,
      [transaction.tenantId],
    );
    const row = rows[0];

    if (row === undefined) return { openCount: 0 };

    return {
      openCount: Number(row.open_count),
      ...(row.oldest_issued_on === null ? {} : { oldestIssuedOn: row.oldest_issued_on }),
    };
  }

  /**
   * What one employment still holds — the clearance answer (AD-006, D-5.3-01 option (a)).
   *
   * **Two statements, deliberately.** The count is taken over `asset_custody` alone, because that is
   * the authoritative answer to "is anything outstanding"; the list joins `asset` to name each item and
   * is bounded. Deriving both from the join would make a dropped row invisible — here it leaves the
   * count larger than the list, and the caller keeps clearance blocked. The failure direction is the
   * safe one.
   *
   * Ordered oldest first: the item somebody has held longest is the one a clearance conversation
   * starts with. `c.id` breaks ties so a bound never lands mid-way through one day's issues.
   *
   * Row-level security confines both statements to the tenant, and the join is keyed on the tenant as
   * well so a mis-scoped asset row could not be reached even if a policy were dropped.
   */
  public async outstandingForEmployment(
    transaction: Transaction,
    employmentId: string,
    limit: number,
  ): Promise<OutstandingCustodies> {
    const parameters = [transaction.tenantId, employmentId];
    const counted = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from asset_custody
         where tenant_id = $1 and employment_id = $2 and state = 'open' and deleted_at is null`,
      parameters,
    );

    const rows = await transaction.execute<OutstandingRow>(
      `select c.id, c.asset_id, ${civilDateColumn('c.issued_on', 'issued_on')},
              a.asset_tag, a.asset_category_id
         from asset_custody c
         join asset a on a.id = c.asset_id and a.tenant_id = c.tenant_id
        where c.tenant_id = $1 and c.employment_id = $2
          and c.state = 'open' and c.deleted_at is null
        order by c.issued_on, c.id
        limit $3`,
      [...parameters, limit],
    );

    return {
      total: Number(counted[0]?.total ?? '0'),
      items: rows.map((row) => ({
        assetCustodyId: row.id,
        assetId: row.asset_id,
        assetTag: row.asset_tag,
        assetCategoryId: row.asset_category_id,
        issuedOn: row.issued_on,
      })),
    };
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
