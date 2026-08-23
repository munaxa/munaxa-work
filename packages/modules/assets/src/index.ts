/**
 * Assets & Custody — Phase 5.3, Checkpoint 1.
 *
 * **What this module holds:** the tenant's asset catalogue — the kinds of thing it issues — and the
 * inventory of individual items it owns, with the identifiers that tell them apart and the status
 * that says whether each is in service.
 *
 * **What it deliberately does not hold, yet:** custody. Nothing here issues an item to anybody,
 * records an acknowledgement, tracks a return, references an employment or names a person. Custody
 * arrives in Checkpoint 2 with the decisions it needs (D-5.3-01, D-5.3-05); incidents and liability
 * in Checkpoint 3; the clearance projection Offboarding consumes in Checkpoint 4. None is stubbed,
 * flagged or half-modelled here, because a table nothing writes is worse than no table (ADR-0070).
 *
 * **The asset status vocabulary lists four of the specification's seven for the same reason.**
 * `issued`, `in_custody` and `returned` are facts about custody, derived from the custody history
 * when it exists — never a second copy on the asset that goes stale.
 *
 * **What it will never hold:** a person. Custody will reference Employment and never People (AD-001),
 * and this checkpoint references neither.
 *
 * **Zero cross-module dependencies.** No port, no service grant, no other module's query. That is the
 * checkpoint's most valuable property and it is asserted rather than promised.
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
  Page,
  Paged,
} from './application/assets-ports.js';
export { inMemoryAssetsStores } from './application/in-memory-stores.js';
export type { InMemoryAssetsStores } from './application/in-memory-stores.js';

export { postgresAssetsStores } from './infrastructure/assets-stores.js';

export { AssetsDispatcher } from './api/assets-dispatcher.js';
export { AssetCategoryController } from './api/asset-category.controller.js';
export { AssetController } from './api/asset.controller.js';

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
  INITIAL_ASSET_STATUS,
  PERMITTED_ASSET_TRANSITIONS,
  permitsAssetTransition,
} from './domain/assets-vocabulary.js';
export type { AssetStatus } from './domain/assets-vocabulary.js';
