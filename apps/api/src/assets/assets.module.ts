import { Module } from '@nestjs/common';
import { AssetCategoryController, AssetController, AssetsDispatcher } from '@work/assets';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Assets & Custody's transport, dispatching through the pipeline the identity module assembled.
 *
 * The module's *composition* lives in `assets.composition.ts` rather than here, because the identity
 * module's composition registers Assets on the shared registry while this file imports the identity
 * module to reach the dispatcher. Keeping both in one file would make those two facts a cycle — the
 * same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared. `AssetCategoryController` owns the literal `assets/categories`
  // prefix and is declared first; `AssetController` would otherwise swallow it with `:assetId`. A
  // route test asserts the resolution rather than trusting this comment.
  controllers: [AssetCategoryController, AssetController],
  providers: [
    {
      provide: AssetsDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): AssetsDispatcher => new AssetsDispatcher(dispatcher),
    },
  ],
})
export class AssetsModule {}
