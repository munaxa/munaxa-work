import { Module } from '@nestjs/common';
import {
  RelationsDispatcher,
  ViolationCategoryController,
  ViolationController,
} from '@work/relations';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Employee Relations' transport, dispatching through the pipeline the identity module assembled.
 *
 * The module's *composition* lives in `relations.composition.ts` rather than here, because the
 * identity module's composition registers Relations on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts
 * a cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared. `ViolationCategoryController` owns the literal
  // `relations/categories` prefix and is declared first; `ViolationController` declares its
  // collection and create routes before its `:violationId` route. An API test asserts the
  // resolution rather than trusting this comment.
  controllers: [ViolationCategoryController, ViolationController],
  providers: [
    {
      provide: RelationsDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): RelationsDispatcher =>
        new RelationsDispatcher(dispatcher),
    },
  ],
})
export class RelationsModule {}
