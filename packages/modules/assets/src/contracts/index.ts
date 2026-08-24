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
