import { accept, refuse, type AssetsResult } from './assets-rejection.js';
import {
  INITIAL_ASSET_STATUS,
  isAssetStatus,
  permitsAssetTransition,
  type AssetStatus,
} from './assets-vocabulary.js';

/**
 * An individual item the company owns — the inventory, as distinct from the catalogue.
 *
 * **The distinction is the design and it is not collapsible.** `asset_category` says *what kind of
 * thing this is*; this says *which one*. One category classifies a thousand laptops, and a tenant
 * that renamed its category has not renamed a thousand items.
 *
 * **Two identifiers, asymmetric on purpose.** `assetTag` is the tenant's own — the thing written on
 * the sticker — and it is required and unique per tenant. `serialNumber` is the manufacturer's, and
 * it is optional and unique per tenant *when present*: a chair has none, and two laptops must never
 * share one. Both uniqueness rules are partial unique indexes rather than reads, because a `select`
 * followed by an `insert` is not idempotent under concurrency (ADR-0071).
 *
 * **`status` says whether the item is in service — never who holds it.** `issued`, `in_custody` and
 * `returned` are absent because they are facts about custody, and Checkpoint 2's custody table is
 * their authority. A copy here would be a flag nothing maintains (ADR-0070).
 *
 * **`locationNote` and `purchaseReference` are free text and explicitly not references.** Organization
 * owns units and no Finance module exists in this repository, so a foreign key from either would be
 * inventing a boundary rather than crossing one. They are notes a human writes and reads back, which
 * is what keeps them from being flags nothing maintains.
 *
 * **Nothing here is immutable.** A description is corrected, a serial number is entered late, an
 * asset is retired. AD-003's immutability is about *custody history*, and reading it across to this
 * table would freeze an inventory the day it was typed — including its typos.
 */

export const ASSET_TAG_LIMIT = 64;
export const SERIAL_NUMBER_LIMIT = 128;
export const DESCRIPTION_LIMIT = 500;
export const LOCATION_NOTE_LIMIT = 255;
export const PURCHASE_REFERENCE_LIMIT = 128;

export interface AssetState {
  readonly assetId: string;
  readonly assetCategoryId: string;
  /** The tenant's own identifier. Required, unique per tenant, and never editable. */
  readonly assetTag: string;
  /** The manufacturer's. Optional, unique per tenant when present. */
  readonly serialNumber?: string;
  readonly description?: string;
  /** A note, deliberately not an Organization reference. */
  readonly locationNote?: string;
  /** A note, deliberately not a Finance reference. No amount, ever. */
  readonly purchaseReference?: string;
  readonly status: AssetStatus;
  readonly version: number;
}

/** The optional text an asset carries, in one shape, so the rules run over it once. */
interface AssetNotes {
  readonly serialNumber?: string;
  readonly description?: string;
  readonly locationNote?: string;
  readonly purchaseReference?: string;
}

export interface RegisterAssetRequest extends AssetNotes {
  readonly assetId: string;
  readonly assetCategoryId: string;
  readonly assetTag: string;
}

/**
 * Registering an item.
 *
 * **The caller does not choose the status.** Every asset starts `registered` — known to exist, not
 * yet in service — and reaches `available` through the transition command, which is a decision
 * somebody makes rather than a field somebody fills in. A caller who could set the initial status
 * could register an asset directly as `retired`, which is a disposal nobody recorded.
 */
export const registerAsset = (request: RegisterAssetRequest): AssetsResult<AssetState> => {
  const tag = request.assetTag.trim();

  if (tag === '') return refuse('asset_tag_missing', { field: 'assetTag' });
  if (tag.length > ASSET_TAG_LIMIT) return refuse('asset_tag_too_long', { field: 'assetTag' });

  const notes = checkedNotes(request);

  if (!notes.ok) return notes;

  return accept({
    assetId: request.assetId,
    assetCategoryId: request.assetCategoryId,
    assetTag: tag,
    status: INITIAL_ASSET_STATUS,
    version: 1,
    ...notes.value,
  });
};

export interface AmendAssetRequest extends AssetNotes {
  readonly asset: AssetState;
}

/**
 * An amendment. **`assetCategoryId`, `assetTag` and `status` are absent, and that is the contract.**
 *
 * The first two are the item's identity — what kind of thing it is, and which one — and an amendment
 * that could change either would silently turn one asset into another while every record pointing at
 * it kept pointing. The third moves only through `changeAssetStatus`, which validates the move: a
 * status settable by amendment is a lifecycle with no transitions.
 *
 * An absent field means *unchanged*, never *cleared*. Nothing in Checkpoint 1 clears a serial number,
 * because a serial number that was there and is now gone is either a correction — send the right one
 * — or a different asset.
 */
export const amendAsset = (request: AmendAssetRequest): AssetsResult<AssetState> => {
  const { asset } = request;
  // Re-checked through the same rules as a registration rather than field-assigned, so a description
  // amended past its limit is refused for the same reason one registered past it is.
  const notes = checkedNotes(
    // Spread conditionally rather than assigned: with `exactOptionalPropertyTypes`, a property
    // present and holding `undefined` is not the same as an absent one, and here the difference is
    // exactly the "unchanged, never cleared" rule this function is built on.
    merged({
      serialNumber: request.serialNumber ?? asset.serialNumber,
      description: request.description ?? asset.description,
      locationNote: request.locationNote ?? asset.locationNote,
      purchaseReference: request.purchaseReference ?? asset.purchaseReference,
    }),
  );

  if (!notes.ok) return notes;

  return accept({
    assetId: asset.assetId,
    assetCategoryId: asset.assetCategoryId,
    assetTag: asset.assetTag,
    status: asset.status,
    version: asset.version,
    ...notes.value,
  });
};

export interface ChangeAssetStatusRequest {
  readonly asset: AssetState;
  readonly status: string;
}

/**
 * Moving an asset through the in-service lifecycle.
 *
 * The move is validated against the transition table rather than assigned, so `retired` is genuinely
 * terminal and a repair genuinely round-trips. **A move to the same status is refused** rather than
 * treated as a no-op: an operation that reports success without changing anything is how a caller
 * comes to believe a state machine advanced when it did not.
 */
export const changeAssetStatus = (request: ChangeAssetStatusRequest): AssetsResult<AssetState> => {
  if (!isAssetStatus(request.status)) return refuse('asset_status_unknown', { field: 'status' });
  if (!permitsAssetTransition(request.asset.status, request.status)) {
    return refuse('asset_transition_refused', {
      field: 'status',
      from: request.asset.status,
      to: request.status,
    });
  }
  return accept({ ...request.asset, status: request.status });
};

/**
 * The optional text, trimmed, bounded, and **absent rather than empty**.
 *
 * A blank string and an absent value would otherwise be two ways of saying the same thing, and a
 * screen would eventually render one of them as a location nobody wrote. Each refusal names its own
 * key rather than being built from the field name, so every key in this module is greppable and the
 * localization check can actually find it.
 */
const checkedNotes = (notes: AssetNotes): AssetsResult<AssetNotes> => {
  const serialNumber = trimmed(notes.serialNumber);
  const description = trimmed(notes.description);
  const locationNote = trimmed(notes.locationNote);
  const purchaseReference = trimmed(notes.purchaseReference);

  if (over(serialNumber, SERIAL_NUMBER_LIMIT)) {
    return refuse('serial_number_too_long', { field: 'serialNumber' });
  }
  if (over(description, DESCRIPTION_LIMIT)) {
    return refuse('description_too_long', { field: 'description' });
  }
  if (over(locationNote, LOCATION_NOTE_LIMIT)) {
    return refuse('location_note_too_long', { field: 'locationNote' });
  }
  if (over(purchaseReference, PURCHASE_REFERENCE_LIMIT)) {
    return refuse('purchase_reference_too_long', { field: 'purchaseReference' });
  }
  return accept({
    ...(serialNumber === undefined ? {} : { serialNumber }),
    ...(description === undefined ? {} : { description }),
    ...(locationNote === undefined ? {} : { locationNote }),
    ...(purchaseReference === undefined ? {} : { purchaseReference }),
  });
};

/** An `AssetNotes` in which an absent value is genuinely absent rather than present and `undefined`. */
const merged = (notes: {
  readonly serialNumber: string | undefined;
  readonly description: string | undefined;
  readonly locationNote: string | undefined;
  readonly purchaseReference: string | undefined;
}): AssetNotes => ({
  ...(notes.serialNumber === undefined ? {} : { serialNumber: notes.serialNumber }),
  ...(notes.description === undefined ? {} : { description: notes.description }),
  ...(notes.locationNote === undefined ? {} : { locationNote: notes.locationNote }),
  ...(notes.purchaseReference === undefined ? {} : { purchaseReference: notes.purchaseReference }),
});

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim() ?? '';

  return text === '' ? undefined : text;
};

const over = (value: string | undefined, limit: number): boolean =>
  value !== undefined && value.length > limit;
