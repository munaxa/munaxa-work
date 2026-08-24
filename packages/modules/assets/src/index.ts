/**
 * Assets & Custody — Phase 5.3, Checkpoint 1.
 *
 * **What this module holds:** the tenant's asset catalogue — the kinds of thing it issues — the
 * inventory of individual items it owns, and **custody**: who holds which item, since when, and what
 * happened when it came back.
 *
 * **A custody is a period, and one row is one handover** (AD-003). Issuing opens it, returning closes
 * it, and a returned custody is immutable at the database. The current holder of an asset is its
 * **open** custody, derived rather than stored, and at most one can exist — a partial unique index
 * settles that rather than a read (AD-004, ADR-0071).
 *
 * **The asset status vocabulary still lists four of the specification's seven, and that is now load
 * bearing rather than merely pending.** `issued`, `in_custody` and `returned` are facts about custody,
 * so `asset.status` says only whether an item is *in service* — an asset somebody is holding is still
 * `available`. A second copy on the asset would go stale the moment a custody row was written
 * (ADR-0070).
 *
 * **What it deliberately does not hold:** transfer, acknowledgement, acceptance, cancellation,
 * correction, condition, expected-return dates, reminders, incidents, liability, waivers, the
 * clearance projection, and any deduction. Each arrives with the checkpoint that builds it, several
 * behind decisions that are still open; none is stubbed, flagged or half-modelled here.
 *
 * **What it will never hold:** a person. Custody references Employment and never People (AD-001), and
 * no name, email, national identifier or user account is copied into this module.
 *
 * **One cross-module dependency**, and it creates no contract: Employment's already published read,
 * under a bounded service grant, answering one boolean.
 */

export * from './contracts/index.js';
export * from './contracts/views.js';

export { assetsModule } from './application/assets-module.js';
export {
  ALL_ASSETS_PERMISSIONS,
  AssetsPermissions,
  type AssetsPermission,
} from './application/assets-permissions.js';
export type { AssetsDependencies } from './application/assets-dependencies.js';
export type {
  AssetCategoryStore,
  AssetFilters,
  AssetStore,
  AssetsStores,
  Clock,
  CustodyFilters,
  CustodyStore,
  EmploymentDirectoryPort,
  Page,
  Paged,
} from './application/assets-ports.js';
export { inMemoryAssetsStores } from './application/in-memory-stores.js';
export type { InMemoryAssetsStores } from './application/in-memory-stores.js';

export { postgresAssetsStores } from './infrastructure/assets-stores.js';

export { AssetsDispatcher } from './api/assets-dispatcher.js';
export { AssetCategoryController } from './api/asset-category.controller.js';
export { AssetController } from './api/asset.controller.js';
export { AssetCustodyController } from './api/asset-custody.controller.js';
export { CustodyController } from './api/custody.controller.js';

export type {
  AmendAssetCategoryCommand,
  AssetCategoryDefined,
  DefineAssetCategoryCommand,
} from './application/asset-category.use-case.js';
export type {
  AmendAssetCommand,
  AssetIdentified,
  ChangeAssetStatusCommand,
  RegisterAssetCommand,
} from './application/asset.use-case.js';
export type { ListAssetCategories, ReadAsset, SearchAssets } from './application/assets-queries.js';

export {
  ASSET_STATUSES,
  CUSTODY_ELIGIBLE_STATUS,
  CUSTODY_STATES,
  INITIAL_ASSET_STATUS,
  INITIAL_CUSTODY_STATE,
  PERMITTED_ASSET_TRANSITIONS,
  permitsAssetTransition,
} from './domain/assets-vocabulary.js';
export type { AssetStatus, CustodyState } from './domain/assets-vocabulary.js';
