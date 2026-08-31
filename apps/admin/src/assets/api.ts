import { apiOutcome } from '../shell/api-request.js';
import type {
  AssetCategoryView,
  AssetCustodyView,
  AssetView,
  CustodySummaryView,
} from '@work/assets/contracts';

/**
 * Reading Assets & Custody from the API.
 *
 * The types come from the module's published *contracts*, never from its internals. Four of them —
 * `AssetCustodyView`, `CustodyView`, `CustodyPageView` and `CustodySummaryView` — were written for
 * `contracts/views.ts` and had never been re-exported, so this slice added the export and nothing
 * else. No route changed, no permission changed, and the three custody reads answer exactly what
 * they answered before.
 *
 * **Three permissions, three independent refusals.** `assets.asset.read` answers the inventory and
 * one asset; `assets.category.read` answers the catalogue; `assets.custody.read` answers the
 * summary and an asset's custody. A caller may hold any subset, so each read is kept as its own
 * value and an absent one renders as withheld rather than as an empty table. A storekeeper who
 * maintains the catalogue is not necessarily somebody who may see who is holding what — the module
 * separated those grants deliberately, and this screen respects the separation instead of
 * flattening it into one "assets" section.
 *
 * **There is deliberately no tenant-wide custody listing.** `GET /assets/custody` requires an
 * `employmentId`; the module publishes no read that enumerates every custody in the tenant. So this
 * slice does not have a custody register screen, and does not assemble one from the inventory. What
 * one employment holds is already on the Employee Record, which reads
 * `/assets/custody/clearance`; this slice opens the other end — the asset, and everyone who has
 * held it.
 *
 * **Every figure is the server's.** `daysOutstanding`, `daysHeld`, `openCount`,
 * `longestDaysOutstanding` and `total` are all published, all derived inside the module against an
 * `asAt` it echoes. Nothing here subtracts two dates. There is no overdue, no due date, no value,
 * no cost and no depreciation, because the module records none of them and says so in its own
 * catalogue.
 */

/** What one screen shows at once. The server clamps its own bound; this is the request. */
const PAGE = 'page=1&pageSize=50';

/**
 * What a read that defines a route actually answered.
 *
 * `missing` is a 404 the module raised; `refused` is a 401 or a 403. Collapsing them would render a
 * not-found page at a caller who simply lacks a permission — telling them the asset does not exist,
 * which is the opposite of true.
 */
export type Outcome<TValue> =
  | { readonly kind: 'ok'; readonly value: TValue }
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused' };

const outcome = async <TValue>(path: string): Promise<Outcome<TValue>> => {
  const answer = await apiOutcome<TValue>(`${path}`);

  if (answer.kind === 'ok') return { kind: 'ok', value: answer.value };
  return answer.kind === 'missing' ? { kind: 'missing' } : { kind: 'refused' };
};

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because a custody row says which employment is holding a piece of company
 * property, and a cached copy of it is that fact sitting somewhere nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  const answer = await outcome<TValue>(path);

  return answer.kind === 'ok' ? answer.value : undefined;
};

/** A page, or the fact that there was not one. Rows and the server's total travel together. */
export interface Listing<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

const listing = <TItem>(
  page: { readonly items: readonly TItem[]; readonly total: number } | undefined,
): Listing<TItem> | undefined =>
  page === undefined ? undefined : { items: page.items, total: page.total };

/**
 * The catalogue answers a bare array, not a page.
 *
 * `assets.categories` returns `readonly AssetCategoryView[]` — the tenant's whole catalogue, ordered
 * `(sequence, code)`. There is no `total` to render beside it because there is no paging to report,
 * and inventing one from `length` would be the very thing every slice since the first has refused.
 */
const catalogue = async (): Promise<readonly AssetCategoryView[] | undefined> =>
  read<readonly AssetCategoryView[]>('/assets/categories');

/** The inventory screen: three reads, three permissions, three separable refusals. */
export interface AssetsInventory {
  readonly assets: Listing<AssetView> | undefined;
  readonly categories: readonly AssetCategoryView[] | undefined;
  readonly summary: CustodySummaryView | undefined;
}

export const loadInventory = async (): Promise<AssetsInventory> => {
  const [assets, categories, summary] = await Promise.all([
    read<{ readonly items: readonly AssetView[]; readonly total: number }>(`/assets?${PAGE}`),
    catalogue(),
    read<CustodySummaryView>('/assets/custody/summary'),
  ]);

  return { assets: listing(assets), categories, summary };
};

/** One asset: the read that defines the route, so its outcome is kept whole. */
export const loadAsset = async (assetId: string): Promise<Outcome<AssetView>> =>
  outcome<AssetView>(`/assets/${assetId}`);

/**
 * What surrounds one asset once it is known to exist.
 *
 * The custody chain sits behind a **different permission** from the asset itself, so a caller can
 * open an asset and be refused its custody. That is withheld, never an asset nobody has ever held.
 *
 * The catalogue comes along because an asset carries `assetCategoryId` and no name. Assets holds
 * the name — it is this module's own catalogue, not another module's — so resolving it here is
 * reading a published bounded list, not building a cross-module lookup.
 */
export interface AssetContext {
  readonly custody: AssetCustodyView | undefined;
  readonly categories: readonly AssetCategoryView[] | undefined;
}

export const loadAssetContext = async (assetId: string): Promise<AssetContext> => {
  const [custody, categories] = await Promise.all([
    read<AssetCustodyView>(`/assets/${assetId}/custody`),
    catalogue(),
  ]);

  return { custody, categories };
};

/**
 * The catalogue entry for one asset, or nothing.
 *
 * Nothing is invented when the catalogue was withheld or the entry is absent: the screen shows the
 * identifier it does hold rather than a blank where a name would be.
 */
export const categoryAmong = (
  categories: readonly AssetCategoryView[] | undefined,
  assetCategoryId: string,
): AssetCategoryView | undefined =>
  categories?.find((category) => category.assetCategoryId === assetCategoryId);
