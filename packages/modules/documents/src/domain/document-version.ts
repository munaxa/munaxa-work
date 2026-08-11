import {
  HASH_ALGORITHM,
  isStorageReference,
  type DocumentSource,
  type VerificationState,
} from './documents-vocabulary.js';
import { accept, refuse, type DocumentsResult } from './documents-rejection.js';

/**
 * One version of one document's file. **Written once, never changed.**
 *
 * There is no function in this file that modifies a version, no repository offers an update or a
 * remove, and a database trigger refuses both. A document somebody disputes is explained by these
 * rows, and the cheapest guarantee that nobody rewrote one is to have no path that could.
 *
 * **What this module knows about the file, and what it does not.** It knows the reference, the name
 * the uploader gave, the media type the *client claimed*, the size and a hash. It does not know
 * whether any of that is true, because knowing would require the bytes and `StoragePort` has no
 * adapter in this repository. That gap is recorded on the row rather than glossed over:
 * `detectedMediaType` stays absent until something inspects content, and `hashVerified` stays false
 * until something re-computes the hash against what was stored. A file is never described as safe
 * or as validated because it was accepted.
 */

export interface DocumentVersionState {
  readonly documentVersionId: string;
  readonly documentId: string;
  readonly versionNumber: number;
  /** Opaque. Not a URL, not a path, not a provider key. */
  readonly storageReference: string;
  readonly originalFileName: string;
  /** What the client said it was. Never trusted on its own. */
  readonly declaredMediaType: string;
  /** What content inspection found. Absent: no inspection infrastructure exists. */
  readonly detectedMediaType?: string;
  readonly sizeInBytes: bigint;
  readonly contentHash: string;
  readonly hashAlgorithm: string;
  /** Whether anything ever checked the hash against the stored bytes. Nothing can today. */
  readonly hashVerified: boolean;
  readonly source: DocumentSource;
  readonly verificationState: VerificationState;
  readonly supersededAt?: Date;
  readonly version: number;
}

export interface AddVersionRequest {
  readonly documentVersionId: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly storageReference: string;
  readonly originalFileName: string;
  readonly declaredMediaType: string;
  readonly sizeInBytes: bigint;
  readonly contentHash: string;
  readonly source: DocumentSource;
}

/** A SHA-256 digest, as 64 lower-case hexadecimal characters. */
const isSha256 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

const MEDIA_TYPE = /^[a-z]+\/[A-Za-z0-9!#$&^_.+-]{1,120}$/;

/**
 * A reference that names a provider or an address, which this module refuses.
 *
 * The shared format three modules already validate (`isStorageReference`) permits `:` and `/`, so
 * `s3://bucket/key` and `https://host/path` both satisfy it — the expression cannot tell an opaque
 * key from a URL, and it was written before anything needed it to. This module needs it to: a
 * reference that carries a scheme has leaked the provider into the domain, and a stored URL is the
 * permanent public address the plan forbids.
 *
 * Refused here rather than by tightening the shared validator, which would be a change to three
 * completed modules for a rule only this one has.
 */
const ADDRESSED = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

export const createVersion = (
  request: AddVersionRequest,
): DocumentsResult<DocumentVersionState> => {
  if (request.versionNumber < 1)
    return refuse('version_number_invalid', { field: 'versionNumber' });
  if (!isStorageReference(request.storageReference) || ADDRESSED.test(request.storageReference)) {
    return refuse('storage_reference_malformed', { field: 'storageReference' });
  }
  if (request.originalFileName.trim() === '' || request.originalFileName.length > 255) {
    return refuse('file_name_invalid', { field: 'originalFileName' });
  }
  if (!MEDIA_TYPE.test(request.declaredMediaType)) {
    return refuse('media_type_malformed', { field: 'declaredMediaType' });
  }
  if (request.sizeInBytes < 0n) return refuse('size_invalid', { field: 'sizeInBytes' });
  // The hash is required and its shape is checked, even though nothing can verify it against the
  // bytes yet. A malformed digest accepted now is a digest that cannot be compared later.
  if (!isSha256(request.contentHash))
    return refuse('content_hash_malformed', { field: 'contentHash' });

  return accept({
    documentVersionId: request.documentVersionId,
    documentId: request.documentId,
    versionNumber: request.versionNumber,
    storageReference: request.storageReference,
    originalFileName: request.originalFileName,
    declaredMediaType: request.declaredMediaType,
    sizeInBytes: request.sizeInBytes,
    contentHash: request.contentHash,
    hashAlgorithm: HASH_ALGORITHM,
    hashVerified: false,
    source: request.source,
    verificationState: 'unverified',
    version: 1,
  });
};

/** The next version number for a document. One-based, and gapless within a document. */
export const nextVersionNumber = (current: number): number => current + 1;

/**
 * Whether two versions hold the same bytes.
 *
 * Duplicate content is **permitted and flagged**, never refused (D-5). One PDF can legitimately
 * evidence two things — a single scan carrying both sides of a licence, a combined certificate —
 * and refusing it would make the honest case impossible. Silently accepting it would hide a
 * mistaken double upload, so reconciliation reports it and a human decides.
 */
export const isSameContent = (
  one: Pick<DocumentVersionState, 'contentHash' | 'hashAlgorithm'>,
  other: Pick<DocumentVersionState, 'contentHash' | 'hashAlgorithm'>,
): boolean => one.hashAlgorithm === other.hashAlgorithm && one.contentHash === other.contentHash;
