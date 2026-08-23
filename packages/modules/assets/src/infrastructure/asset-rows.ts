import type { AssetCategoryState, LocalizedName } from '../domain/asset-category.js';
import type { AssetState } from '../domain/asset.js';
import type { AssetStatus } from '../domain/assets-vocabulary.js';
import { asNumber, orNull, orUndefined, type RowValues } from './row-writer.js';

/**
 * Rows into domain state and back, in one file.
 *
 * The mapping is deliberately explicit rather than a spread: a column added to a table does not reach
 * the domain until somebody writes it here, and a field added to the domain does not reach the
 * database either. An accidental round-trip is how a value nobody chose ends up on a record.
 *
 * **`version` never appears in a values map** — `auditForInsert` writes it on insert and
 * `Repository.updateRow` appends `version = version + 1`, so emitting it here would assign the same
 * column twice in one statement. That is the defect Phase 5.2's integration suite found, and this
 * module inherits the rule rather than rediscovering it.
 *
 * **Every select names its columns.** There is no civil date on either table in this checkpoint, so
 * the `to_char` projection Phase 5.2 needed does not appear — but the reason it was needed does: the
 * driver decides how a column type arrives, and `select *` hands the mapper whatever the driver chose.
 * Naming the columns is what makes the row interface a description of the query rather than a hope
 * about the table. The first date column this module stores will be projected as text on the way out.
 */

export const ASSET_CATEGORY_COLUMNS = `id, tenant_id, code, name, sequence, active, version`;

export const ASSET_COLUMNS = `id, tenant_id, asset_category_id, asset_tag, serial_number,
  description, location_note, purchase_reference, status, version`;

export interface AssetCategoryRow {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly sequence: number | string;
  readonly active: boolean;
  readonly version: number | string;
}

export const assetCategoryState = (row: AssetCategoryRow): AssetCategoryState => ({
  assetCategoryId: row.id,
  code: row.code,
  name: row.name,
  sequence: asNumber(row.sequence),
  active: row.active,
  version: asNumber(row.version),
});

export const assetCategoryValues = (state: AssetCategoryState, tenantId: string): RowValues => ({
  id: state.assetCategoryId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  sequence: state.sequence,
  active: state.active,
});

export interface AssetRow {
  readonly id: string;
  readonly asset_category_id: string;
  readonly asset_tag: string;
  readonly serial_number: string | null;
  readonly description: string | null;
  readonly location_note: string | null;
  readonly purchase_reference: string | null;
  readonly status: string;
  readonly version: number | string;
}

export const assetState = (row: AssetRow): AssetState => ({
  assetId: row.id,
  assetCategoryId: row.asset_category_id,
  assetTag: row.asset_tag,
  status: row.status as AssetStatus,
  version: asNumber(row.version),
  ...(orUndefined(row.serial_number) === undefined
    ? {}
    : { serialNumber: row.serial_number as string }),
  ...(orUndefined(row.description) === undefined ? {} : { description: row.description as string }),
  ...(orUndefined(row.location_note) === undefined
    ? {}
    : { locationNote: row.location_note as string }),
  ...(orUndefined(row.purchase_reference) === undefined
    ? {}
    : { purchaseReference: row.purchase_reference as string }),
});

export const assetValues = (state: AssetState, tenantId: string): RowValues => ({
  id: state.assetId,
  tenant_id: tenantId,
  asset_category_id: state.assetCategoryId,
  asset_tag: state.assetTag,
  serial_number: orNull(state.serialNumber),
  description: orNull(state.description),
  location_note: orNull(state.locationNote),
  purchase_reference: orNull(state.purchaseReference),
  status: state.status,
});
