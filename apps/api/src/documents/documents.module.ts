import { Module } from '@nestjs/common';
import {
  DocumentAccessController,
  DocumentController,
  DocumentTypeController,
  DocumentVersionController,
  DocumentsDispatcher,
} from '@work/documents';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Documents' transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `documents.composition.ts` rather than here, because the
 * identity module's composition registers Documents on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts
 * a cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Nest resolves a route by the order
  // its controllers were declared. `DocumentTypeController` owns the literal `documents/types`
  // prefix and is declared first; `DocumentController` declares `reconciliation` before its
  // `:documentId` routes; `DocumentAccessController` comes last because every one of its routes
  // begins with a parameter segment. An API test asserts the resolution rather than trusting this
  // comment.
  controllers: [
    DocumentTypeController,
    DocumentController,
    DocumentVersionController,
    DocumentAccessController,
  ],
  providers: [
    {
      provide: DocumentsDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): DocumentsDispatcher =>
        new DocumentsDispatcher(dispatcher),
    },
  ],
})
export class DocumentsModule {}
