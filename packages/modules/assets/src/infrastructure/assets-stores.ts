import type { AssetsStores } from '../application/assets-ports.js';
import { PostgresAssetCategoryRepository, PostgresAssetRepository } from './assets.repository.js';

/**
 * The real stores, assembled.
 *
 * A function returning the whole `AssetsStores` interface rather than a partial, so a repository
 * somebody forgot to write is a compile error rather than a runtime one.
 */
export const postgresAssetsStores = (): AssetsStores => ({
  categories: new PostgresAssetCategoryRepository(),
  assets: new PostgresAssetRepository(),
});
