/**
 * The public contract of Assets & Custody.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its handlers, its
 * stores, its tables and its aggregates are private and stay private, because the moment a second
 * module reads `asset_custody` directly the boundary stops being a boundary — and Offboarding is
 * already named in the specification as the consumer that will read custody through this contract
 * (AD-006).
 *
 * Contracts are versioned. A breaking change to anything in this file requires an ADR.
 */

export type { AssetCategoryView, AssetPageView, AssetView, LocalizedTextView } from './views.js';

/**
 * The clearance contract, published because it has a named consumer.
 *
 * AD-006 says offboarding clearance reads custody **through public contracts**, and Offboarding
 * (Phase 11.2) is the module that will do it. This is the surface it pulls: a bounded answer about one
 * employment, carrying no employment status, no person and no tenant.
 */
export type { AssetClearanceView, CustodyBlockerView } from './views.js';

/**
 * The custody contracts, published because the Admin portal now reads them.
 *
 * These four were written for `contracts/views.ts` — they carry no handler, no store and no
 * aggregate, and they are what `GET /assets/:assetId/custody`, `GET /assets/custody` and
 * `GET /assets/custody/summary` have always returned. Only the re-export was missing, so a consumer
 * could receive them and had no name for what it received.
 *
 * Publishing them changes nothing about what any route answers or what any permission covers. The
 * three reads sit behind `assets.custody.read`, exactly as before.
 *
 * **`CustodySummaryView` names no identifier at all** — a count and two dates — which is what keeps
 * it distinct from the tenant-wide custody *listing* this module deliberately does not publish.
 */
export type {
  AssetCustodyView,
  CustodyPageView,
  CustodySummaryView,
  CustodyView,
} from './views.js';
