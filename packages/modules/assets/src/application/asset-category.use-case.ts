import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  createAssetCategory,
  type AssetCategoryState,
  type DefineAssetCategoryRequest,
  type LocalizedName,
} from '../domain/asset-category.js';
import { conflicted, notFound, refusedBy } from './assets-context.js';
import { AssetsPermissions } from './assets-permissions.js';
import type { AssetsDependencies } from './assets-dependencies.js';

/**
 * Defining and amending what a tenant calls a kind of asset.
 *
 * **Nothing ships in the catalogue.** No asset type, no condition scale, no valuation rule and no
 * depreciation schedule — every entry is a row a customer writes (AD-002).
 *
 * Amendment is deliberately narrow. **`code` is not editable**: assets point at the entry by
 * identifier, and a code a tenant could reuse for something else would silently reclassify an
 * inventory nobody touched. Name, ordering and active state may change, because those govern how the
 * catalogue is read rather than what an existing asset is.
 *
 * **Deactivation is how an entry leaves service, and there is no delete.** Assets classified under it
 * must still read correctly years later, and Checkpoint 2's custody history will point at items whose
 * category left service long before.
 */

export interface DefineAssetCategoryCommand extends Command {
  readonly commandName: 'assets.define-category';
  readonly code: string;
  readonly name: LocalizedName;
  readonly sequence: number;
}

export interface AssetCategoryDefined {
  readonly assetCategoryId: string;
}

export const defineAssetCategoryHandler = (
  dependencies: AssetsDependencies,
): CommandHandler<DefineAssetCategoryCommand, AssetCategoryDefined> => ({
  commandName: 'assets.define-category',
  permission: AssetsPermissions.categoryManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.categories.byCode(transaction, command.code);

      // Checked before the insert for a readable refusal; the unique index is what actually settles
      // two administrators defining the same code at the same moment (ADR-0071).
      if (existing !== undefined) return conflicted<AssetCategoryDefined>('category_code_taken');

      const created = createAssetCategory({ assetCategoryId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<AssetCategoryDefined>(created.error);

      await dependencies.stores.categories.insert(transaction, created.value);
      return success({ assetCategoryId: created.value.assetCategoryId });
    }),
});

export interface AmendAssetCategoryCommand extends Command {
  readonly commandName: 'assets.amend-category';
  readonly assetCategoryId: string;
  readonly expectedVersion: number;
  readonly name?: LocalizedName;
  readonly sequence?: number;
  readonly active?: boolean;
}

export const amendAssetCategoryHandler = (
  dependencies: AssetsDependencies,
): CommandHandler<AmendAssetCategoryCommand, AssetCategoryDefined> => ({
  commandName: 'assets.amend-category',
  permission: AssetsPermissions.categoryManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.categories.byId(transaction, command.assetCategoryId);

      if (held === undefined) return notFound<AssetCategoryDefined>('asset_category');

      const amended = createAssetCategory(amendedShape(held, command));

      if (!amended.ok) return refusedBy<AssetCategoryDefined>(amended.error);

      await dependencies.stores.categories.update(
        transaction,
        // `version` is not written by the caller: the repository appends `version = version + 1`,
        // and supplying it here would assign the column twice in one statement.
        { ...amended.value, version: held.version },
        command.expectedVersion,
      );
      return success({ assetCategoryId: held.assetCategoryId });
    }),
});

/**
 * The amended entry, rebuilt through the aggregate's own constructor.
 *
 * Rebuilt rather than field-assigned so every invariant is re-checked against the amended shape
 * instead of only against the original — a sequence amended to `-1` is refused for the same reason
 * one defined as `-1` is. `code` is carried over unchanged, for the reason above.
 */
const amendedShape = (
  held: AssetCategoryState,
  command: AmendAssetCategoryCommand,
): DefineAssetCategoryRequest => ({
  assetCategoryId: held.assetCategoryId,
  code: held.code,
  name: command.name ?? held.name,
  sequence: command.sequence ?? held.sequence,
  active: command.active ?? held.active,
});
