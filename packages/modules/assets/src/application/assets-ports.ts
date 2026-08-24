import type { Transaction } from '@work/kernel';

import type { AssetCategoryState } from '../domain/asset-category.js';
import type { AssetState } from '../domain/asset.js';
import type { CustodyRecord } from '../domain/custody.js';

/**
 * The persistence this module needs, as interfaces the domain never sees.
 *
 * **Checkpoint 1 declared no cross-module port at all. Checkpoint 2 declares exactly one**, and it
 * asks one boolean of a read Employment already publishes — see `EmploymentDirectoryPort` below.
 * There is still no `DocumentReferencePort`, no `ApprovalPort`, no `StoragePort`, no
 * `NotificationPort` and no `JobPort`: a port declared before there is a caller for it is an
 * invitation somebody eventually accepts.
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
  /**
   * The same read, taking a row lock — the serialization point for the D-5.3-09 invariant.
   *
   * "An asset may not be retired while a custody is open" spans two tables, so no single constraint
   * can express it. Both `issue-custody` and `change-asset-status` take this lock **first**, so the
   * two transactions serialize on the asset row: whichever arrives second blocks, then re-reads the
   * committed truth and refuses. Without it both could pass their own check and commit, leaving a
   * retired asset in somebody's custody.
   */
  byIdForUpdate(transaction: Transaction, id: string): Promise<AssetState | undefined>;
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

/**
 * Custody. Reads, an insert, and an update that only an **open** row can survive.
 *
 * `update` exists — unlike on an append-only store — because an open custody is a period still in
 * progress. It cannot touch a returned one: the trigger refuses that from any path including a direct
 * `psql` session, and the `expected` version guards the ordinary lost-update race in between. This is
 * `InvestigationStore`'s shape, for the same reason.
 *
 * `openFor` is how a caller learns an asset is already held. It is **not** what makes "one custody at
 * a time" true — the partial unique index is, because a read that precedes an insert decides nothing
 * under concurrency (ADR-0071). This read exists so the common case is a business refusal rather than
 * a database exception.
 *
 * **There is no read that spans a tenant.** Every collection read takes an asset or an employment: a
 * query returning every custody a tenant holds is a report nobody approved.
 */
export interface CustodyStore {
  byId(transaction: Transaction, id: string): Promise<CustodyRecord | undefined>;
  /** The open custody of one asset, or nothing. The derived current holder. */
  openFor(transaction: Transaction, assetId: string): Promise<CustodyRecord | undefined>;
  forAsset(transaction: Transaction, assetId: string, paged: Paged): Promise<Page<CustodyRecord>>;
  forEmployment(
    transaction: Transaction,
    employmentId: string,
    filters: CustodyFilters,
    paged: Paged,
  ): Promise<Page<CustodyRecord>>;
  /** Counts what is open across the tenant and names the oldest issue date. Publishes no identifier. */
  openSummary(transaction: Transaction): Promise<CustodySummary>;
  /** What one employment still holds: the authoritative count, and a bounded, named list. */
  outstandingForEmployment(
    transaction: Transaction,
    employmentId: string,
    limit: number,
  ): Promise<OutstandingCustodies>;
  insert(transaction: Transaction, state: CustodyRecord): Promise<void>;
  update(transaction: Transaction, state: CustodyRecord, expected: number): Promise<void>;
}

/** What a caller may narrow a custody list by. Never a tenant — the context already determines it. */
export interface CustodyFilters {
  readonly openOnly?: boolean;
}

/**
 * What is still out across a tenant, as an **aggregate and nothing else**.
 *
 * No asset, no custody and no employment identifier appears here, which is what separates it from the
 * "every custody in this organisation" listing this module deliberately does not publish. It is
 * ADR-0053's *"number a human can see is a number a human notices growing"* — enough to discover that
 * a dozen items have been out for two years, and not enough to be a list of who holds them.
 *
 * The oldest issue date is published rather than an elapsed count, so the elapsed arithmetic happens
 * in exactly one place for both this and the item reads.
 */
export interface CustodySummary {
  readonly openCount: number;
  /** Absent when nothing is out — an absence rather than a date nobody can interpret. */
  readonly oldestIssuedOn?: string;
}

/**
 * One open custody, named well enough for somebody to go and find the item.
 *
 * `assetTag` is joined here rather than left to the caller because a blocker that cannot name the
 * physical thing is not actionable — "return asset `019a3f…`" is not an instruction anybody can follow.
 * It is the tenant's own label, and the read it appears in is bounded to a single employment's open
 * custodies, so it cannot be used to enumerate an inventory.
 */
export interface OutstandingCustody {
  readonly assetCustodyId: string;
  readonly assetId: string;
  readonly assetTag: string;
  readonly assetCategoryId: string;
  readonly issuedOn: string;
}

/**
 * What one employment still holds.
 *
 * **`total` is counted over `asset_custody` alone; `items` is the join, and bounded.** The two are
 * separate on purpose: `total` is the authoritative answer to "is anything outstanding", so a bound
 * that truncates `items` — or a join that ever dropped a row — leaves `total` larger and clearance
 * blocked. A truncated list can never turn a blocked employment into a clear one.
 */
export interface OutstandingCustodies {
  readonly total: number;
  readonly items: readonly OutstandingCustody[];
}

/**
 * Whether an employment exists in this tenant — the module's **only** cross-module dependency.
 *
 * A boolean, and deliberately nothing more. Assets needs to know that the employment an asset is
 * issued to is real and this tenant's. It does not need the person's name, their status, their grade
 * or their manager, and a port that returned any of those would be a workforce directory an asset
 * register has no business holding. Employment answers through its own published read, reached under
 * a bounded service grant (ADR-0043).
 *
 * **It answers existence, not standing.** Whether an *ended* employment may still be issued an asset
 * is D-5.3-07, which is open — so this port deliberately cannot express the difference, and Checkpoint
 * 2 states the limitation rather than widening the port to guess at it.
 *
 * Another tenant's employment answers `false`, indistinguishable from one that never existed: the read
 * runs inside the caller's tenant context, so row-level security answers before this port does.
 */
export interface EmploymentDirectoryPort {
  exists(employmentId: string): Promise<boolean>;
}

/** The clock, as a port, so a test can hold time still without stubbing the platform. */
export interface Clock {
  now(): Date;
}

export interface AssetsStores {
  readonly categories: AssetCategoryStore;
  readonly assets: AssetStore;
  readonly custodies: CustodyStore;
}
