import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  amendAssetCategoryHandler,
  defineAssetCategoryHandler,
} from './asset-category.use-case.js';
import {
  amendAssetHandler,
  changeAssetStatusHandler,
  registerAssetHandler,
} from './asset.use-case.js';
import {
  listAssetCategoriesHandler,
  readAssetHandler,
  searchAssetsHandler,
} from './assets-queries.js';
import { issueCustodyHandler, returnCustodyHandler } from './custody.use-case.js';
import {
  readAssetCustodyHandler,
  readCustodySummaryHandler,
  readEmploymentCustodyHandler,
} from './custody-queries.js';
import { ALL_ASSETS_PERMISSIONS, AssetsPermissions } from './assets-permissions.js';
import type { AssetsDependencies } from './assets-dependencies.js';

/**
 * Assets & Custody's module declaration: seven commands, six queries, one navigation entry.
 *
 * Registered on the same dispatcher as every other module. **Nothing here subscribes to an event and
 * nothing raises one.** The specification names eight domain events; dispatch in this repository is
 * at-most-once with no outbox (ADR-0053/0064), so a module whose correctness depended on delivery
 * would be wrong the first time a process restarted mid-dispatch. Checkpoint 2 builds the custody
 * three of them describe — `AssetIssued`, `AssetReturned`, `CustodyAcknowledged` — and still raises
 * none, because none has a consumer: Onboarding, Offboarding and Payroll will *pull* what they need
 * when they need it, and an event nobody receives is a promise about delivery to nobody.
 *
 * **The navigation entry is behind `assets.asset.read`, not the catalogue permission.** The screen it
 * points at is the inventory; somebody who may only maintain the list of categories has no business
 * finding a link to every item the company owns.
 */
export const assetsModule = (dependencies: AssetsDependencies): WorkModule => ({
  name: 'assets',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'assets.inventory',
      path: '/assets',
      permission: AssetsPermissions.assetRead,
      order: 70,
    },
  ],

  // Stated in full so the administration screen offers the whole set rather than the subset that
  // happens to be some handler's own declaration.
  permissions: ALL_ASSETS_PERMISSIONS,
});

const commandsOf = (
  dependencies: AssetsDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    defineAssetCategoryHandler(dependencies),
    amendAssetCategoryHandler(dependencies),

    registerAssetHandler(dependencies),
    amendAssetHandler(dependencies),
    changeAssetStatusHandler(dependencies),

    issueCustodyHandler(dependencies),
    returnCustodyHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: AssetsDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    listAssetCategoriesHandler(dependencies),

    readAssetHandler(dependencies),
    searchAssetsHandler(dependencies),

    readAssetCustodyHandler(dependencies),
    readEmploymentCustodyHandler(dependencies),
    readCustodySummaryHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
