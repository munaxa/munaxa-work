import { success, type Query, type QueryHandler } from '@work/kernel';

import { notFound } from './assets-context.js';
import { AssetsPermissions } from './assets-permissions.js';
import { assetCategoryView, assetView } from './assets-views.js';
import type { AssetsDependencies } from './assets-dependencies.js';
import type { AssetCategoryView, AssetPageView, AssetView } from '../contracts/views.js';

/**
 * The three reads, and the rules every one of them keeps.
 *
 * **No read here is audited, and that is a decision rather than an omission.** Relations audits reads
 * because a violation is an allegation about a named person and AD-007 requires the trail; an asset
 * register is a list of laptops and names nobody. Auditing it would bury the reads that matter under
 * reads that never mattered — the "audit every query" mechanism D-5.2-05 rejected — and there is no
 * access-trail table in this module to write into. **When custody arrives it names a person, and
 * whether *that* read is audited is Checkpoint 2's judgement made on Checkpoint 2's evidence.**
 *
 * **Bounded.** The inventory read is paged, with a default and a maximum, so no caller can ask for
 * every asset a tenant owns in one response. The catalogue read is unpaged and bounded by nature: it
 * is the list of words a tenant classifies its property in.
 *
 * **Nothing found rather than forbidden.** An asset in another tenant answers exactly as one that
 * never existed, so an identifier cannot be used as a probe.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAXIMUM_PAGE_SIZE = 200;

export interface PageRequest {
  readonly page?: number;
  readonly pageSize?: number;
}

const pagedFrom = (request: PageRequest): { readonly limit: number; readonly offset: number } => {
  const size = boundedSize(request.pageSize);
  const page =
    request.page !== undefined && Number.isInteger(request.page) && request.page > 0
      ? request.page
      : 1;

  return { limit: size, offset: (page - 1) * size };
};

const boundedSize = (size: number | undefined): number => {
  if (size === undefined || !Number.isInteger(size) || size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAXIMUM_PAGE_SIZE);
};

/** The tenant's catalogue, ordered `(sequence, code)`. Inactive entries on request, never by default. */
export interface ListAssetCategories extends Query {
  readonly queryName: 'assets.categories';
  readonly includeInactive?: boolean;
}

export const listAssetCategoriesHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<ListAssetCategories, readonly AssetCategoryView[]> => ({
  queryName: 'assets.categories',
  permission: AssetsPermissions.categoryRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.categories.all(
        transaction,
        query.includeInactive ?? false,
      );

      return success(found.map(assetCategoryView));
    }),
});

export interface ReadAsset extends Query {
  readonly queryName: 'assets.read-asset';
  readonly assetId: string;
}

export const readAssetHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<ReadAsset, AssetView> => ({
  queryName: 'assets.read-asset',
  permission: AssetsPermissions.assetRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.assets.byId(transaction, query.assetId);

      if (found === undefined) return notFound<AssetView>('asset');

      return success(assetView(found));
    }),
});

/**
 * The inventory, narrowed and paged.
 *
 * **Filters are optional and the tenant is not one of them.** A caller cannot name a tenant here or
 * anywhere else — the execution context determines it and row-level security filters beneath that.
 * A filter naming an unknown category or an unknown status simply matches nothing, which is the same
 * answer as a category belonging to somebody else.
 */
export interface SearchAssets extends Query, PageRequest {
  readonly queryName: 'assets.search-assets';
  readonly assetCategoryId?: string;
  readonly status?: string;
}

export const searchAssetsHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<SearchAssets, AssetPageView> => ({
  queryName: 'assets.search-assets',
  permission: AssetsPermissions.assetRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.assets.search(
        transaction,
        {
          ...(query.assetCategoryId === undefined
            ? {}
            : { assetCategoryId: query.assetCategoryId }),
          ...(query.status === undefined ? {} : { status: query.status }),
        },
        pagedFrom(query),
      );

      return success({ items: found.items.map(assetView), total: found.total });
    }),
});
