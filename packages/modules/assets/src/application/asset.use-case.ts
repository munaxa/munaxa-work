import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { acceptsNewAssets } from '../domain/asset-category.js';
import { amendAsset, changeAssetStatus, registerAsset } from '../domain/asset.js';
import { conflicted, notFound, refusedBy } from './assets-context.js';
import { AssetsPermissions } from './assets-permissions.js';
import type { AssetState } from '../domain/asset.js';
import type { AssetsDependencies } from './assets-dependencies.js';

/**
 * The inventory: registering an item, correcting what is recorded about it, and moving it through
 * the in-service lifecycle.
 *
 * **Three commands, one permission, and no custody anywhere.** Nothing here issues an asset to
 * anybody, records an acknowledgement, references an employment or names a person. Checkpoint 1 knows
 * what the company owns; who holds it is Checkpoint 2's table and Checkpoint 2's decisions.
 *
 * **A tag or a serial number already in use is refused readably, and settled by an index.** The reads
 * below exist so a storekeeper meets a sentence rather than a constraint violation; the partial
 * unique indexes are what actually decide two people registering the same laptop at the same instant
 * (ADR-0071). Both are needed and neither replaces the other.
 *
 * **Nothing here is deleted.** An asset leaves service by retirement.
 */

export interface RegisterAssetCommand extends Command {
  readonly commandName: 'assets.register-asset';
  readonly assetCategoryId: string;
  readonly assetTag: string;
  readonly serialNumber?: string;
  readonly description?: string;
  readonly locationNote?: string;
  readonly purchaseReference?: string;
}

export interface AssetIdentified {
  readonly assetId: string;
}

export const registerAssetHandler = (
  dependencies: AssetsDependencies,
): CommandHandler<RegisterAssetCommand, AssetIdentified> => ({
  commandName: 'assets.register-asset',
  permission: AssetsPermissions.assetManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const category = await dependencies.stores.categories.byId(
        transaction,
        command.assetCategoryId,
      );

      // A category in another tenant reads as absent, so an identifier cannot be probed by
      // registering against it.
      if (category === undefined) return notFound<AssetIdentified>('asset_category');
      if (!acceptsNewAssets(category)) {
        // A deactivated entry keeps classifying every asset already under it and classifies no new
        // one — which is the whole reason deactivation exists instead of deletion.
        return conflicted<AssetIdentified>('category_inactive');
      }

      const clash = await identifierClash(dependencies, transaction, command);

      if (clash !== undefined) return conflicted<AssetIdentified>(clash);

      const registered = registerAsset({ assetId: uuidV7(), ...command });

      if (!registered.ok) return refusedBy<AssetIdentified>(registered.error);

      await dependencies.stores.assets.insert(transaction, registered.value);
      return success({ assetId: registered.value.assetId });
    }),
});

interface Identifiers {
  readonly assetTag?: string;
  readonly serialNumber?: string;
}

/**
 * Whether either identifier is already in use in this tenant, as a readable reason or nothing.
 *
 * Extracted so the handler stays inside its budget, and because the same question is asked by the
 * amendment — a serial number entered late must not collide any more than one entered at
 * registration. `exceptAssetId` is what lets an amendment re-send the value it already holds without
 * colliding with itself.
 */
const identifierClash = async (
  dependencies: AssetsDependencies,
  transaction: Transaction,
  identifiers: Identifiers,
  exceptAssetId?: string,
): Promise<string | undefined> => {
  const byTag = (value: string): Promise<AssetState | undefined> =>
    dependencies.stores.assets.byTag(transaction, value);
  const bySerial = (value: string): Promise<AssetState | undefined> =>
    dependencies.stores.assets.bySerialNumber(transaction, value);

  if (await takenBySomebodyElse(identifiers.assetTag, byTag, exceptAssetId)) {
    return 'asset_tag_taken';
  }
  if (await takenBySomebodyElse(identifiers.serialNumber, bySerial, exceptAssetId)) {
    return 'serial_number_taken';
  }
  return undefined;
};

/**
 * Whether one identifier is already held by a *different* item.
 *
 * Both checks are the same three questions — is a value given, does something hold it, and is that
 * something this item — so they are asked once here rather than written twice. Split when the
 * combined function passed the complexity budget: split, not exempted, and split where the repetition
 * already was.
 *
 * A blank value is *not given*: the domain stores a blank as absent, and a lookup for `''` that
 * matched would refuse every item that has no serial number.
 */
const takenBySomebodyElse = async (
  value: string | undefined,
  lookup: (value: string) => Promise<AssetState | undefined>,
  exceptAssetId: string | undefined,
): Promise<boolean> => {
  const wanted = value?.trim() ?? '';

  if (wanted === '') return false;

  const held = await lookup(wanted);

  return held !== undefined && held.assetId !== exceptAssetId;
};

export interface AmendAssetCommand extends Command {
  readonly commandName: 'assets.amend-asset';
  readonly assetId: string;
  readonly expectedVersion: number;
  readonly serialNumber?: string;
  readonly description?: string;
  readonly locationNote?: string;
  readonly purchaseReference?: string;
}

/**
 * Correcting what is recorded about an item.
 *
 * **The category, the tag and the status are not in the command**, and the domain would refuse them
 * if they were: the first two are the item's identity and the third moves only through a validated
 * transition. What remains is the text somebody typed, which is exactly what gets typed wrongly.
 */
export const amendAssetHandler = (
  dependencies: AssetsDependencies,
): CommandHandler<AmendAssetCommand, AssetIdentified> => ({
  commandName: 'assets.amend-asset',
  permission: AssetsPermissions.assetManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.assets.byId(transaction, command.assetId);

      if (held === undefined) return notFound<AssetIdentified>('asset');

      const clash = await identifierClash(
        dependencies,
        transaction,
        command.serialNumber === undefined ? {} : { serialNumber: command.serialNumber },
        held.assetId,
      );

      if (clash !== undefined) return conflicted<AssetIdentified>(clash);

      const amended = amendAsset({ asset: held, ...command });

      if (!amended.ok) return refusedBy<AssetIdentified>(amended.error);

      await dependencies.stores.assets.update(transaction, amended.value, command.expectedVersion);
      return success({ assetId: held.assetId });
    }),
});

export interface ChangeAssetStatusCommand extends Command {
  readonly commandName: 'assets.change-asset-status';
  readonly assetId: string;
  readonly expectedVersion: number;
  readonly status: string;
}

/**
 * The only path that moves an asset's status, and it validates the move.
 *
 * `retired` is terminal, repair round-trips, and a move to the status the asset already holds is
 * refused rather than reported as a success. **No status here says anything about custody**: an asset
 * does not become `issued`, because a custody row is what says who holds it.
 */
export const changeAssetStatusHandler = (
  dependencies: AssetsDependencies,
): CommandHandler<ChangeAssetStatusCommand, AssetIdentified> => ({
  commandName: 'assets.change-asset-status',
  permission: AssetsPermissions.assetManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.assets.byId(transaction, command.assetId);

      if (held === undefined) return notFound<AssetIdentified>('asset');

      const moved = changeAssetStatus({ asset: held, status: command.status });

      if (!moved.ok) return refusedBy<AssetIdentified>(moved.error);

      await dependencies.stores.assets.update(transaction, moved.value, command.expectedVersion);
      return success({ assetId: held.assetId });
    }),
});
