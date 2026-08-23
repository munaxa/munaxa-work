import type { AssetCategoryState } from '../domain/asset-category.js';
import type { AssetState } from '../domain/asset.js';
import type { AssetCategoryView, AssetView } from '../contracts/views.js';

/**
 * Domain state into published view, in one direction only.
 *
 * Here rather than in the query handlers so there is exactly one place that decides what leaves this
 * module. A field added to an aggregate does not reach a consumer until somebody adds it here, which
 * is the point: an accidentally published field is an accidental disclosure, and the day custody
 * exists the field in question will name somebody.
 *
 * **An absent optional is omitted, never rendered as an empty string.** A serial number nobody
 * recorded and a serial number recorded as blank are different facts, and a screen must be able to
 * tell them apart.
 */

export const assetCategoryView = (state: AssetCategoryState): AssetCategoryView => ({
  assetCategoryId: state.assetCategoryId,
  code: state.code,
  name: state.name,
  sequence: state.sequence,
  active: state.active,
  version: state.version,
});

export const assetView = (state: AssetState): AssetView => ({
  assetId: state.assetId,
  assetCategoryId: state.assetCategoryId,
  assetTag: state.assetTag,
  status: state.status,
  version: state.version,
  ...(state.serialNumber === undefined ? {} : { serialNumber: state.serialNumber }),
  ...(state.description === undefined ? {} : { description: state.description }),
  ...(state.locationNote === undefined ? {} : { locationNote: state.locationNote }),
  ...(state.purchaseReference === undefined ? {} : { purchaseReference: state.purchaseReference }),
});
