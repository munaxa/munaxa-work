import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { AssetCategoryState } from '../domain/asset-category.js';
import type { AssetState } from '../domain/asset.js';
import type {
  AssetCategoryStore,
  AssetFilters,
  AssetStore,
  Page,
  Paged,
} from '../application/assets-ports.js';
import {
  ASSET_CATEGORY_COLUMNS,
  ASSET_COLUMNS,
  assetCategoryState,
  assetCategoryValues,
  assetState,
  assetValues,
  type AssetCategoryRow,
  type AssetRow,
} from './asset-rows.js';
import { insertRow, mutable, pageOf, predicateFor } from './row-writer.js';

/**
 * The catalogue and the inventory, in PostgreSQL.
 *
 * **Every statement names its columns**, including the two `byId` reads, which is why both override
 * the base class's `findRow` rather than calling it: `Repository.findRow` issues `select *`, and
 * `select *` hands the mapper whatever the driver decided a column type should become. Phase 5.2 lost
 * a civil date to exactly that and did not notice for three checkpoints. Neither table here holds a
 * date, so nothing is currently wrong — the convention is adopted before there is a defect rather
 * than after one.
 *
 * **Neither repository has a remove.** An asset leaves service by retirement and a category by
 * deactivation; the base class offers only a soft delete and nothing here calls it.
 *
 * Every statement is bound to `transaction.tenantId`, and row-level security filters again beneath
 * it. Neither is the other's backup: the bind keeps a defect from reading across tenants, and RLS
 * keeps a *missing* bind from doing so.
 */

export class PostgresAssetCategoryRepository
  extends Repository<AssetCategoryRow & { version: number }>
  implements AssetCategoryStore
{
  public constructor() {
    super('asset_category');
  }

  public async byId(transaction: Transaction, id: string): Promise<AssetCategoryState | undefined> {
    const rows = await transaction.execute<AssetCategoryRow>(
      `select ${ASSET_CATEGORY_COLUMNS} from asset_category
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : assetCategoryState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<AssetCategoryState | undefined> {
    const rows = await transaction.execute<AssetCategoryRow>(
      `select ${ASSET_CATEGORY_COLUMNS} from asset_category
         where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : assetCategoryState(rows[0]);
  }

  /**
   * Ordered by `(sequence, code)`.
   *
   * Two columns rather than one, so ordering is deterministic **without** forcing `sequence` to be
   * unique — a tenant inserting an entry between two others should not have to renumber its
   * catalogue, and two entries sharing a rank must still come back in the same order every time.
   */
  public async all(
    transaction: Transaction,
    includeInactive: boolean,
  ): Promise<readonly AssetCategoryState[]> {
    const rows = await transaction.execute<AssetCategoryRow>(
      `select ${ASSET_CATEGORY_COLUMNS} from asset_category
         where tenant_id = $1 and deleted_at is null
           and ($2::boolean or active)
         order by sequence, code`,
      [transaction.tenantId, includeInactive],
    );

    return rows.map(assetCategoryState);
  }

  public insert(transaction: Transaction, state: AssetCategoryState): Promise<void> {
    return insertRow(
      transaction,
      'asset_category',
      assetCategoryValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: AssetCategoryState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.assetCategoryId,
      expected,
      mutable(assetCategoryValues(state, transaction.tenantId)),
    );
  }
}

/**
 * The inventory.
 *
 * `byTag` and `bySerialNumber` are readable-refusal reads and **not** the uniqueness guarantee: the
 * partial unique indexes are, because a read that precedes an insert decides nothing under
 * concurrency (ADR-0071). `bySerialNumber` filters `serial_number is not null` explicitly, so a call
 * with a blank value can never match the many rows that have none.
 */
export class PostgresAssetRepository
  extends Repository<AssetRow & { version: number }>
  implements AssetStore
{
  public constructor() {
    super('asset');
  }

  public async byId(transaction: Transaction, id: string): Promise<AssetState | undefined> {
    const rows = await transaction.execute<AssetRow>(
      `select ${ASSET_COLUMNS} from asset
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : assetState(rows[0]);
  }

  public async byTag(transaction: Transaction, assetTag: string): Promise<AssetState | undefined> {
    const rows = await transaction.execute<AssetRow>(
      `select ${ASSET_COLUMNS} from asset
         where tenant_id = $1 and asset_tag = $2 and deleted_at is null`,
      [transaction.tenantId, assetTag],
    );

    return rows[0] === undefined ? undefined : assetState(rows[0]);
  }

  public async bySerialNumber(
    transaction: Transaction,
    serialNumber: string,
  ): Promise<AssetState | undefined> {
    const rows = await transaction.execute<AssetRow>(
      `select ${ASSET_COLUMNS} from asset
         where tenant_id = $1 and serial_number = $2
           and serial_number is not null and deleted_at is null`,
      [transaction.tenantId, serialNumber],
    );

    return rows[0] === undefined ? undefined : assetState(rows[0]);
  }

  /**
   * The inventory, narrowed and paged, ordered by tag.
   *
   * Ordered by `asset_tag` — which is unique per tenant — so a page boundary is stable and never
   * lands in the middle of two rows the planner happened to return in a different order on the
   * second request.
   */
  public search(
    transaction: Transaction,
    filters: AssetFilters,
    paged: Paged,
  ): Promise<Page<AssetState>> {
    const predicate = predicateFor('a', transaction.tenantId, [
      { column: 'a.asset_category_id', value: filters.assetCategoryId },
      { column: 'a.status', value: filters.status },
    ]);

    return pageOf<AssetRow, AssetState>(
      transaction,
      {
        select: `select ${ASSET_COLUMNS} from asset a
                   where ${predicate.clause}
                   order by a.asset_tag
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from asset a where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      assetState,
    );
  }

  public insert(transaction: Transaction, state: AssetState): Promise<void> {
    return insertRow(transaction, 'asset', assetValues(state, transaction.tenantId), new Date());
  }

  public async update(
    transaction: Transaction,
    state: AssetState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.assetId,
      expected,
      mutable(assetValues(state, transaction.tenantId)),
    );
  }
}
