import type {
  AssetCategoryView,
  AssetCustodyView,
  AssetView,
  CustodySummaryView,
  CustodyView,
} from '@work/assets/contracts';

import type { AssetContext, AssetsInventory } from './api';

/**
 * Fixtures shaped by the module's published contracts, and by nothing else.
 *
 * **Every field here exists on the view it belongs to.** A fixture that carried a `value`, a
 * `dueBack` or an `overdue` would let a test pass on a field the API never sends, and the screen
 * would then be written against a fiction. The three fields a reader most expects and the module
 * does not publish — a valuation, an expected return and an overdue flag — are absent from these
 * fixtures for the same reason they are absent from the screens.
 *
 * Identifiers are UUIDv7-shaped and differ well past the first eight characters, because that is
 * the run of a UUIDv7 that is a millisecond timestamp: two assets registered in the same afternoon
 * share it, and a fixture that let `short()` look sufficient would hide the defect the Employee
 * Record slice found.
 */

export const ASSET_A = '01900000-0000-7000-8000-0000000a5501';
export const ASSET_B = '01900000-0000-7000-8000-0000000a5502';
export const CATEGORY_LAPTOP = '01900000-0000-7000-8000-0000000ca701';
export const CATEGORY_PHONE = '01900000-0000-7000-8000-0000000ca702';
export const EMPLOYMENT_A = '01900000-0000-7000-8000-00000000e001';
export const EMPLOYMENT_B = '01900000-0000-7000-8000-00000000e002';
export const CUSTODY_OPEN = '01900000-0000-7000-8000-0000000cd001';
export const CUSTODY_CLOSED = '01900000-0000-7000-8000-0000000cd002';

export const LAPTOP: AssetCategoryView = {
  assetCategoryId: CATEGORY_LAPTOP,
  code: 'laptop',
  name: { en: 'Laptop', ar: 'حاسوب محمول' },
  sequence: 1,
  active: true,
  version: 1,
};

export const PHONE: AssetCategoryView = {
  assetCategoryId: CATEGORY_PHONE,
  code: 'phone',
  name: { en: 'Mobile phone', ar: 'هاتف محمول' },
  sequence: 2,
  active: false,
  version: 1,
};

/**
 * An asset whose free-text fields are English, on purpose.
 *
 * A location note and a purchase reference are whatever somebody typed, and in a bilingual tenant
 * that is often the other language from the one being read. These are the values the RTL test
 * checks are isolated.
 */
export const LAPTOP_ASSET: AssetView = {
  assetId: ASSET_A,
  assetCategoryId: CATEGORY_LAPTOP,
  assetTag: 'LT-000418',
  serialNumber: 'C02XK1FTJGH5',
  description: 'MacBook Pro 14",  2025',
  locationNote: 'Riyadh office, 3rd floor store.',
  purchaseReference: 'PO-2025-0417',
  status: 'available',
  version: 3,
};

/** An asset with nothing optional recorded. Every absence renders as a dash, never as a blank. */
export const BARE_ASSET: AssetView = {
  assetId: ASSET_B,
  assetCategoryId: CATEGORY_PHONE,
  assetTag: 'PH-000092',
  status: 'under_repair',
  version: 1,
};

export const OPEN_CUSTODY: CustodyView = {
  assetCustodyId: CUSTODY_OPEN,
  assetId: ASSET_A,
  employmentId: EMPLOYMENT_A,
  issuedOn: '2026-06-01',
  state: 'open',
  issueNote: 'Issued for the Riyadh rollout.',
  daysOutstanding: 87,
  version: 1,
};

export const RETURNED_CUSTODY: CustodyView = {
  assetCustodyId: CUSTODY_CLOSED,
  assetId: ASSET_A,
  employmentId: EMPLOYMENT_B,
  issuedOn: '2025-11-02',
  returnedOn: '2026-05-28',
  state: 'returned',
  returnNote: 'Returned at end of secondment.',
  daysHeld: 207,
  version: 2,
};

export const anAssetCustody = (): AssetCustodyView => ({
  assetId: ASSET_A,
  current: OPEN_CUSTODY,
  history: { items: [OPEN_CUSTODY, RETURNED_CUSTODY], asAt: '2026-08-27', total: 2 },
  asAt: '2026-08-27',
});

/** An asset nobody holds: `current` absent, and the history not empty. Two different facts. */
export const anUnheldAssetCustody = (): AssetCustodyView => ({
  assetId: ASSET_A,
  history: { items: [RETURNED_CUSTODY], asAt: '2026-08-27', total: 1 },
  asAt: '2026-08-27',
});

export const aNeverIssuedAsset = (): AssetCustodyView => ({
  assetId: ASSET_B,
  history: { items: [], asAt: '2026-08-27', total: 0 },
  asAt: '2026-08-27',
});

export const SUMMARY: CustodySummaryView = {
  asAt: '2026-08-27',
  openCount: 14,
  oldestIssuedOn: '2025-09-15',
  longestDaysOutstanding: 346,
};

/** Nothing is out. The two ageing figures are absent, and their absence is the answer. */
export const NOTHING_OUT: CustodySummaryView = { asAt: '2026-08-27', openCount: 0 };

/**
 * The whole inventory screen answered.
 *
 * `total` is 26 against two rows on purpose: every count on the screen must be the server's, and a
 * fixture whose total equalled its page length could not tell a correct screen from one counting
 * `items.length`.
 */
export const aFullInventory = (): AssetsInventory => ({
  assets: { items: [LAPTOP_ASSET, BARE_ASSET], total: 26 },
  categories: [LAPTOP, PHONE],
  summary: SUMMARY,
});

export const anEmptyInventory = (): AssetsInventory => ({
  assets: { items: [], total: 0 },
  categories: [],
  summary: NOTHING_OUT,
});

/** Every read refused. Three permissions, so three sections, and not one of them is "empty". */
export const aRefusedInventory = (): AssetsInventory => ({
  assets: undefined,
  categories: undefined,
  summary: undefined,
});

/**
 * The inventory readable and the custody summary not.
 *
 * `assets.asset.read` and `assets.custody.read` are separate grants, and this is the caller who
 * holds one. The screen must show the inventory and withhold the summary, rather than deciding the
 * whole page is refused.
 */
export const aPartlyWithheldInventory = (): AssetsInventory => ({
  assets: { items: [LAPTOP_ASSET], total: 26 },
  categories: [LAPTOP],
  summary: undefined,
});

export const anAssetContext = (): AssetContext => ({
  custody: anAssetCustody(),
  categories: [LAPTOP, PHONE],
});

/** The asset readable, its custody refused. One refusal, not two. */
export const aWithheldCustodyContext = (): AssetContext => ({
  custody: undefined,
  categories: [LAPTOP, PHONE],
});

/** The catalogue refused, so a category identifier has no name to resolve to. */
export const anUnnamedCategoryContext = (): AssetContext => ({
  custody: anAssetCustody(),
  categories: undefined,
});
