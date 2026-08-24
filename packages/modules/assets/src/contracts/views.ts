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
  /**
   * Whole days this custody has been open, as at the `asAt` the response echoes — **derived, never
   * stored**, and absent on a returned custody.
   *
   * The day of issue is day zero. It is also absent when `asAt` precedes the issue, because as at that
   * date the custody had not been issued and zero would be a claim rather than an answer.
   *
   * **This is elapsed time, not overdue.** No expected return is recorded anywhere in this module, so
   * overdue cannot be computed and is not stated.
   */
  readonly daysOutstanding?: number;
  /**
   * Whole days this custody ran, issue to return — present only once it has come back.
   *
   * A closed fact: it does not depend on `asAt`, and the row it describes is immutable from the moment
   * it closed.
   */
  readonly daysHeld?: number;
  readonly version: number;
}

export interface CustodyPageView {
  readonly items: readonly CustodyView[];
  /** The civil date every `daysOutstanding` above was measured against. Echoed so a figure is reproducible. */
  readonly asAt: string;
  readonly total: number;
}

/**
 * What is still out across the tenant, as an aggregate.
 *
 * **No identifier of any kind appears here** — not an asset, not a custody, not an employment. That is
 * what separates it from the tenant-wide custody *listing* this module deliberately does not publish,
 * and it is why it sits behind the same `assets.custody.read` as the two reads that disclose more.
 *
 * It publishes no 30/60/90-day bucketing. Those are business thresholds, and this module does not
 * invent one.
 */
/**
 * One reason clearance cannot complete: an asset this employment still holds.
 *
 * Named well enough to be acted on — the tag is the label somebody uses to go and find the item — and
 * no further. There is no employment status here, no person, no note and no tenant.
 */
export interface CustodyBlockerView {
  readonly assetCustodyId: string;
  readonly assetId: string;
  readonly assetTag: string;
  readonly assetCategoryId: string;
  readonly issuedOn: string;
  /** Days outstanding as at the response's `asAt`. Absent when `asAt` precedes the issue. */
  readonly daysOutstanding?: number;
}

/**
 * What Assets contributes to an offboarding clearance (AD-006).
 *
 * **`assetsClear`, not `clear`.** Assets does not decide whether a person is cleared; Offboarding
 * (Phase 11.2) will, across domains this module knows nothing about — accounts, finance, keys. A field
 * called `clear` on an Assets contract would be read as the whole answer and would be wrong the first
 * time anything outside Assets blocked an exit. This states only what this module knows: as far as
 * company assets are concerned, this employment has nothing outstanding.
 *
 * **The truth is the custody row and nothing else** (D-5.3-01, approved option (a)): an open custody is
 * outstanding, a returned one is not, and an employment ending changes neither. Nothing here asks
 * Employment anything, so a custody held by an ended employment appears exactly like any other.
 *
 * **`assetsClear` follows `outstandingCount`, never `blockers.length`.** The list is bounded; the count
 * is not. If the bound truncates, `outstandingCount` exceeds the list and clearance stays blocked — a
 * truncated list can never report an employment as clear.
 *
 * **This read decides nothing and writes nothing.** It reports persisted facts. A blocker is resolved
 * by a human returning the asset through the ordinary return command, never automatically.
 */
export interface AssetClearanceView {
  readonly employmentId: string;
  /** The civil date `daysOutstanding` was measured against. */
  readonly asAt: string;
  readonly assetsClear: boolean;
  readonly outstandingCount: number;
  readonly blockers: readonly CustodyBlockerView[];
}

export interface CustodySummaryView {
  /** The civil date the figures were measured against. */
  readonly asAt: string;
  readonly openCount: number;
  /** Absent when nothing is out. */
  readonly oldestIssuedOn?: string;
  /** The largest `daysOutstanding` among open custodies. Absent when nothing is out. */
  readonly longestDaysOutstanding?: number;
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
  /** The civil date the ageing figures below were measured against. */
  readonly asAt: string;
}
