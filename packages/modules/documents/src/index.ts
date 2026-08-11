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
