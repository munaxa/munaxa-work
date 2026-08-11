import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import { amendDocumentTypeHandler, defineDocumentTypeHandler } from './document-type.use-case.js';
import {
  addVersionHandler,
  createDocumentHandler,
  moveDocumentHandler,
} from './document.use-case.js';
import {
  authorizeDownloadHandler,
  placeLegalHoldHandler,
  verifyDocumentHandler,
} from './verification.use-case.js';
import {
  listDocumentTypesHandler,
  readDocumentAuditHandler,
  readDocumentHandler,
  readReconciliationHandler,
  searchDocumentsHandler,
} from './documents-queries.js';
import { ALL_DOCUMENTS_PERMISSIONS, DocumentsPermissions } from './documents-permissions.js';
import type { DocumentsDependencies } from './documents-dependencies.js';

/**
 * Documents' module declaration: eight commands, five queries, one navigation entry.
 *
 * Registered on the same dispatcher as every other module. **Nothing here subscribes to an event.**
 * The dispatch is at-most-once with no outbox, so a module whose correctness depended on delivery
 * would be wrong the first time a process restarted mid-dispatch — every cross-module fact this
 * module needs is pulled at the moment it is needed (ADR-0064). Reconciliation is a query somebody
 * runs, for the same reason.
 *
 * `documents.authorize-download` is declared a **command**, not a query, though it returns a URL and
 * changes no document. It writes an access event, and a read that writes is a command; routing it as
 * a query would put a write on the read path and make the trail look optional.
 */
export const documentsModule = (dependencies: DocumentsDependencies): WorkModule => ({
  name: 'documents',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'documents.register',
      path: '/documents',
      permission: DocumentsPermissions.read,
      order: 60,
    },
  ],

  // Stated in full so the administration screen offers the whole set rather than the subset that
  // happens to be some handler's own declaration.
  permissions: ALL_DOCUMENTS_PERMISSIONS,
});

const commandsOf = (
  dependencies: DocumentsDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    defineDocumentTypeHandler(dependencies),
    amendDocumentTypeHandler(dependencies),

    createDocumentHandler(dependencies),
    addVersionHandler(dependencies),
    moveDocumentHandler(dependencies),

    verifyDocumentHandler(dependencies),
    placeLegalHoldHandler(dependencies),

    authorizeDownloadHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: DocumentsDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    listDocumentTypesHandler(dependencies),
    searchDocumentsHandler(dependencies),
    readDocumentHandler(dependencies),

    // The trail, and what reconciliation found — each behind its own permission.
    readDocumentAuditHandler(dependencies),
    readReconciliationHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
