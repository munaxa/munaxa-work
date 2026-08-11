/**
 * Employee documents: metadata, versions, verification, expiry and a queryable access trail.
 *
 * This module holds **no bytes**. `storage_reference` is opaque and `StoragePort` has no adapter in
 * this repository, so binary storage, upload, download, content inspection and malware scanning are
 * all `NOT VERIFIED` — recorded as absent rather than approximated.
 */
export * from './domain/documents-vocabulary.js';
export * from './domain/documents-rejection.js';
export * from './domain/document-type.js';
export * from './domain/document.js';
export * from './domain/document-version.js';
export * from './domain/verification.js';
export * from './domain/expiry.js';
export * from './domain/access-event.js';

export * from './contracts/views.js';

export { documentsModule } from './application/documents-module.js';
export {
  ALL_DOCUMENTS_PERMISSIONS,
  DocumentsPermissions,
} from './application/documents-permissions.js';
export type { DocumentsPermission } from './application/documents-permissions.js';

export type { DocumentsDependencies } from './application/documents-dependencies.js';

/**
 * The ports, as types — the composition root implements them against the owning modules' published
 * queries under bounded service grants (ADR-0043). A concrete adapter exported from here would be
 * Documents deciding how People and Employment are reached.
 *
 * `storageUnavailable` **is** exported, because it is the honest adapter for a composition with no
 * object store: it answers "no URL" rather than fabricating one, and it is the only implementation
 * of `StorageAccessPort` that exists anywhere in this repository.
 */
export { civilToday, storageUnavailable } from './application/documents-ports.js';
export type {
  Clock,
  DocumentFilters,
  DocumentsStores,
  IdentifierFacts,
  OwnerDirectoryPort,
  Page,
  Paged,
  PersonIdentifierPort,
  ReconciliationFinding,
  SignedUrlRequest,
  StorageAccessPort,
} from './application/documents-ports.js';

export { inMemoryDocumentsStores } from './application/in-memory-stores.js';
export { FixedClock } from './application/documents-test-harness.js';
