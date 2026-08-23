import type { Transaction } from '@work/kernel';

import type { AssetCategoryState } from '../domain/asset-category.js';
import type { AssetState } from '../domain/asset.js';

/**
 * The persistence this module needs, as interfaces the domain never sees.
 *
 * **There is nothing else in this file, and that is the checkpoint's most valuable property.** No
 * `EmploymentDirectoryPort`, no `DocumentReferencePort`, no `ApprovalPort`, no `StoragePort`, no
 * `NotificationPort`, no `JobPort`, no clock. Checkpoint 1 asks no other module a question, so it
 * declares no way to ask one — and a port declared before there is a caller for it is an invitation
 * somebody eventually accepts.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id`, row-level security filters again
 * beneath it, and every collection read of the inventory takes a bound. The catalogue read is
 * unbounded and bounded by nature: it is the list of words a tenant classifies its property in.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface AssetCategoryStore {
  byId(transaction: Transaction, id: string): Promise<AssetCategoryState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<AssetCategoryState | undefined>;
  /** Ordered by `(sequence, code)` — deterministic without requiring a unique sequence. */
  all(transaction: Transaction, includeInactive: boolean): Promise<readonly AssetCategoryState[]>;
  insert(transaction: Transaction, state: AssetCategoryState): Promise<void>;
  update(transaction: Transaction, state: AssetCategoryState, expected: number): Promise<void>;
}

/**
 * The inventory. Reads, an insert and an update — **no remove**.
 *
 * An asset leaves service by retirement, never by deletion: a laptop that was deleted from the
 * register still existed, and Checkpoint 2's custody history will point at items that are long out of
 * service.
 *
 * `byTag` and `bySerialNumber` exist so the common case is a readable refusal rather than a database
 * exception. **Neither is what makes uniqueness true** — the partial unique indexes are, because a
 * read that precedes an insert decides nothing under concurrency (ADR-0071).
 */
export interface AssetStore {
  byId(transaction: Transaction, id: string): Promise<AssetState | undefined>;
  byTag(transaction: Transaction, assetTag: string): Promise<AssetState | undefined>;
  bySerialNumber(transaction: Transaction, serialNumber: string): Promise<AssetState | undefined>;
  search(transaction: Transaction, filters: AssetFilters, paged: Paged): Promise<Page<AssetState>>;
  insert(transaction: Transaction, state: AssetState): Promise<void>;
  update(transaction: Transaction, state: AssetState, expected: number): Promise<void>;
}

/** What a caller may narrow the inventory by. Never a tenant — the context already determines it. */
export interface AssetFilters {
  readonly assetCategoryId?: string;
  readonly status?: string;
}

export interface AssetsStores {
  readonly categories: AssetCategoryStore;
  readonly assets: AssetStore;
}
