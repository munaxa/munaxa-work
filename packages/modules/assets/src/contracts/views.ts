/**
 * What Assets & Custody publishes.
 *
 * **Views only.** No handler, no store, no dependency type and no domain aggregate leaves this
 * module: a consumer that could reach a handler could bypass this module's permission checks, and one
 * that could reach a store could bypass its tenancy.
 *
 * **Nothing here carries a person.** Checkpoint 2 publishes the module's first employment identifier,
 * on the custody views below — and it is an employment and never a person (AD-001). No name, no email,
 * no national identifier and no user account leaves this module; a screen that wants one asks People
 * or Employment, which own them.
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

/**
 * One custody — a period during which one employment held one asset.
 *
 * `state` is `open` or `returned`, and nothing else: the specification's accepted, acknowledged,
 * cancelled and transferred are reached by capabilities Checkpoint 2 does not build.
 *
 * `returnedOn` is absent while the custody is open, and its absence is the fact rather than a gap.
 *
 * **This view carries an employment identifier and no other personal reference.** It is the only place
 * this module names a person at all, and it names them the way Employment does.
 */
export interface CustodyView {
  readonly assetCustodyId: string;
  readonly assetId: string;
  readonly employmentId: string;
  readonly issuedOn: string;
  readonly returnedOn?: string;
  readonly state: string;
  readonly issueNote?: string;
  readonly returnNote?: string;
  readonly version: number;
}

export interface CustodyPageView {
  readonly items: readonly CustodyView[];
  readonly total: number;
}

/**
 * An asset's custody: who holds it now, and who held it before.
 *
 * **`current` is derived, never stored.** It is the open custody among this asset's records, and there
 * is at most one — the partial unique index is what makes that true. Its absence is a real answer: the
 * asset is in nobody's custody. Nothing anywhere holds a second copy of it (ADR-0070).
 */
export interface AssetCustodyView {
  readonly assetId: string;
  readonly current?: CustodyView;
  readonly history: CustodyPageView;
}
