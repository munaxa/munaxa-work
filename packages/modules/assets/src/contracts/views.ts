/**
 * What Assets & Custody publishes.
 *
 * **Views only.** No handler, no store, no dependency type and no domain aggregate leaves this
 * module: a consumer that could reach a handler could bypass this module's permission checks, and one
 * that could reach a store could bypass its tenancy.
 *
 * **Nothing here carries a person, and in Checkpoint 1 nothing carries an employment either.** An
 * asset is a thing, not a relationship. The first employment identifier this module publishes will
 * arrive on a custody view in Checkpoint 2, and it will be an employment and never a person (AD-001).
 *
 * Contracts are versioned. A breaking change to anything here requires an ADR.
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

/**
 * One entry in a tenant's asset catalogue.
 *
 * Ordering is `sequence`, so a screen lists the catalogue the way the tenant arranged it rather than
 * alphabetically. Ties break on `code`, which makes the order deterministic without forcing a tenant
 * to renumber to insert an entry.
 *
 * **There is no condition scale, no acknowledgement requirement, no return requirement and no
 * valuation basis on this view**, because there are none on the table. Each configures a capability
 * Checkpoint 1 does not build, and two of them are downstream of decisions that are still open.
 */
export interface AssetCategoryView {
  readonly assetCategoryId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly sequence: number;
  readonly active: boolean;
  readonly version: number;
}

/**
 * One item in the inventory.
 *
 * `status` is whether the item is in service — `registered`, `available`, `under_repair` or
 * `retired`. **It never says who holds it.** `issued`, `in_custody` and `returned` are facts about
 * custody, derived from the custody history when Checkpoint 2 creates it, and a copy on this view
 * would be a second answer that goes stale (ADR-0070).
 *
 * `locationNote` and `purchaseReference` are free text a human wrote. Neither is a reference:
 * Organization owns units, and no module in this repository owns purchase orders.
 */
export interface AssetView {
  readonly assetId: string;
  readonly assetCategoryId: string;
  readonly assetTag: string;
  readonly serialNumber?: string;
  readonly description?: string;
  readonly locationNote?: string;
  readonly purchaseReference?: string;
  readonly status: string;
  readonly version: number;
}

export interface AssetPageView {
  readonly items: readonly AssetView[];
  readonly total: number;
}
