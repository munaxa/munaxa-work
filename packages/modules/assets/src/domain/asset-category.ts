import { accept, refuse, type AssetsResult } from './assets-rejection.js';
import { isEntityCode } from './assets-vocabulary.js';

/**
 * What a tenant calls a kind of asset — the catalogue its inventory is classified in.
 *
 * **Nothing ships in it.** Not "laptop", not "vehicle", not "access card". Every entry is a row a
 * tenant writes (AD-002); a search of this package for an asset type finds nothing, and a test
 * asserts that.
 *
 * Three fields are load-bearing, and the fields that are *absent* are as deliberate as the ones here:
 *
 * - **`code`** is how a tenant refers to the entry for ever. Unique per tenant, never editable. An
 *   asset points at the entry by identifier, so a code that could be reused for something else would
 *   silently reclassify an inventory.
 * - **`sequence`** is what ordering actually uses (D-5.2-07): an integer, persisted as data, and
 *   deliberately **not** unique — reads order by `(sequence, code)`, which is deterministic whether
 *   or not two entries share a rank, so a tenant is never forced to renumber a catalogue to insert an
 *   entry into it.
 * - **`active` is how an entry leaves service, and there is no delete.** Assets classified under an
 *   entry must still read correctly years later, so entries are deactivated rather than removed — and
 *   a deactivated entry cannot classify a *new* asset while every existing one keeps pointing at it.
 *
 * **There is no condition scale, no acknowledgement requirement, no return requirement and no
 * valuation basis**, all of which the specification puts on this entity. Each configures custody or a
 * deduction, and Checkpoint 1 builds neither. Two of them are downstream of decisions that are still
 * open (D-5.3-05, D-5.3-03). Shipping configuration that no code reads is exactly what
 * `relation_violation_category.repeat_window_days` did for two checkpoints, and ADR-0070 names why it
 * is worse than nothing: a stored flag nothing maintains is a value a screen will eventually present
 * as meaningful.
 */

export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

export interface AssetCategoryState {
  readonly assetCategoryId: string;
  readonly code: string;
  readonly name: LocalizedName;
  /** Deterministic ordering, as data. Non-negative; ties break on `code`. */
  readonly sequence: number;
  readonly active: boolean;
  readonly version: number;
}

export interface DefineAssetCategoryRequest {
  readonly assetCategoryId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly sequence: number;
  readonly active?: boolean;
}

export const createAssetCategory = (
  request: DefineAssetCategoryRequest,
): AssetsResult<AssetCategoryState> => {
  const checked = validate(request);

  if (!checked.ok) return checked;

  return accept({
    assetCategoryId: request.assetCategoryId,
    code: request.code,
    name: request.name,
    sequence: request.sequence,
    active: request.active ?? true,
    version: 1,
  });
};

const validate = (request: DefineAssetCategoryRequest): AssetsResult<true> => {
  if (!isEntityCode(request.code)) return refuse('category_code_malformed', { field: 'code' });
  if (request.name.en.trim() === '' || request.name.ar.trim() === '') {
    // Both languages are required by the domain rather than by a screen. A category named only in
    // English is a dropdown an Arabic-speaking storekeeper cannot read — and this is the dropdown
    // somebody picks from while registering every item the company owns.
    return refuse('category_name_incomplete', { field: 'name' });
  }
  if (!Number.isInteger(request.sequence) || request.sequence < 0) {
    return refuse('category_sequence_invalid', { field: 'sequence' });
  }
  return accept(true);
};

/**
 * Whether a *new* asset may be classified under this entry.
 *
 * Only `active` is asked. Nothing here consults a country pack, a jurisdiction, a valuation rule or a
 * depreciation schedule: those are non-goals of the phase, and a function that pretended to answer
 * one would be the invented content this module must not create.
 */
export const acceptsNewAssets = (state: AssetCategoryState): boolean => state.active;
