import type { AssetCategoryState } from '../domain/asset-category.js';
import type { AssetState } from '../domain/asset.js';
import { custodyAgeing } from '../domain/custody-ageing.js';
import type { CustodyRecord } from '../domain/custody.js';
import type { AssetCategoryView, AssetView, CustodyView } from '../contracts/views.js';

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

/**
 * A custody, published.
 *
 * `employmentId` is the only personal reference that leaves this module, and it is an employment
 * rather than a person (AD-001). No name is resolved, joined or cached on the way out — a screen that
 * wants one asks the module that owns it.
 *
 * **`asAt` is a parameter rather than a clock read.** The ageing figures are computed here, from the
 * dates already on the row, against a date the caller can see in the response. A view that reached for
 * the clock itself would publish a number nobody could reproduce.
 */
export const custodyView = (state: CustodyRecord, asAt: string): CustodyView => ({
  assetCustodyId: state.assetCustodyId,
  assetId: state.assetId,
  employmentId: state.employmentId,
  issuedOn: state.issuedOn,
  state: state.state,
  version: state.version,
  ...(state.returnedOn === undefined ? {} : { returnedOn: state.returnedOn }),
  ...(state.issueNote === undefined ? {} : { issueNote: state.issueNote }),
  ...(state.returnNote === undefined ? {} : { returnNote: state.returnNote }),
  ...custodyAgeing(state, asAt),
});
