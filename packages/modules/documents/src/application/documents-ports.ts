import type { Transaction } from '@work/kernel';

import type { AccessEventState } from '../domain/access-event.js';
import type { DocumentState } from '../domain/document.js';
import type { DocumentTypeState } from '../domain/document-type.js';
import type { DocumentVersionState } from '../domain/document-version.js';
import type { VerificationDecisionState } from '../domain/verification.js';

/**
 * The persistence this module needs, as interfaces the domain never sees.
 *
 * Two stores are **deliberately narrower than the rest**. `VersionStore` and `AccessEventStore`
 * offer inserts and reads and **no update, no remove**. A document somebody disputes is explained
 * by those rows, and the cheapest guarantee that nobody rewrote one is to have no method that
 * could. The database refuses it too, with a trigger; this is the same rule expressed where a
 * developer meets it first.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id`, and every collection read takes
 * a bound. There is no unbounded document query in this module — a tenant with two million versions
 * is the ordinary case, not the exception.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface DocumentTypeStore {
  byId(transaction: Transaction, id: string): Promise<DocumentTypeState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<DocumentTypeState | undefined>;
  all(transaction: Transaction): Promise<readonly DocumentTypeState[]>;
  insert(transaction: Transaction, state: DocumentTypeState): Promise<void>;
  update(transaction: Transaction, state: DocumentTypeState, expected: number): Promise<void>;
}

/** How a document search may be narrowed. Every field optional; the tenant bound is not. */
export interface DocumentFilters {
  readonly ownerType?: string;
  readonly ownerId?: string;
  readonly documentTypeId?: string;
  readonly status?: string;
  readonly verificationState?: string;
  /** Documents expiring on or before this civil date. The expiry queue, as an indexed predicate. */
  readonly expiringOnOrBefore?: string;
  /** Excluded unless the caller holds `document.read-sensitive`. Applied in the repository. */
  readonly includeConfidential: boolean;
}

export interface DocumentStore {
  byId(transaction: Transaction, id: string): Promise<DocumentState | undefined>;
  search(
    transaction: Transaction,
    filters: DocumentFilters,
    paged: Paged,
  ): Promise<Page<DocumentState>>;
  insert(transaction: Transaction, state: DocumentState): Promise<void>;
  update(transaction: Transaction, state: DocumentState, expected: number): Promise<void>;
}

export interface VersionStore {
  byId(transaction: Transaction, id: string): Promise<DocumentVersionState | undefined>;
  forDocument(
    transaction: Transaction,
    documentId: string,
  ): Promise<readonly DocumentVersionState[]>;
  /** The highest version number written for a document, or 0. Read inside the writing transaction. */
  highestVersionNumber(transaction: Transaction, documentId: string): Promise<number>;
  /** Versions across the tenant carrying this content hash. Duplicate detection (D-5). */
  byContentHash(
    transaction: Transaction,
    contentHash: string,
    limit: number,
  ): Promise<readonly DocumentVersionState[]>;
  insert(transaction: Transaction, state: DocumentVersionState): Promise<void>;
  /** Marks the previous current version superseded. The only permitted touch, and it is a stamp. */
  supersede(transaction: Transaction, id: string, moment: Date): Promise<void>;
}

export interface VerificationStore {
  forDocument(
    transaction: Transaction,
    documentId: string,
  ): Promise<readonly VerificationDecisionState[]>;
  forVersion(
    transaction: Transaction,
    versionId: string,
  ): Promise<VerificationDecisionState | undefined>;
  insert(transaction: Transaction, state: VerificationDecisionState): Promise<void>;
}

export interface AccessEventStore {
  forDocument(
    transaction: Transaction,
    documentId: string,
    paged: Paged,
  ): Promise<Page<AccessEventState>>;
  insert(transaction: Transaction, state: AccessEventState): Promise<void>;
}

/** What reconciliation found. It reports; it repairs nothing (D-22). */
export interface ReconciliationFinding {
  readonly finding: string;
  readonly documentId: string;
  readonly documentVersionId?: string;
  readonly detail?: Readonly<Record<string, string>>;
}

export interface ReconciliationStore {
  /** Documents whose current version is missing, or which have versions but no current one. */
  inconsistentVersions(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]>;
  /** Content held by more than one version in the tenant. Permitted, and worth a human's eye. */
  duplicateContent(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]>;
  /** Verified documents whose verified version is no longer the current one. */
  staleVerifications(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]>;
}

export interface DocumentsStores {
  readonly types: DocumentTypeStore;
  readonly documents: DocumentStore;
  readonly versions: VersionStore;
  readonly verifications: VerificationStore;
  readonly access: AccessEventStore;
  readonly reconciliation: ReconciliationStore;
}

/**
 * Whether an owner this module was handed actually exists, asked of the module that owns it.
 *
 * Documents holds a polymorphic `owner_type` + `owner_id` and **no foreign key** — a polymorphic
 * reference cannot carry one, and Phase 11 established that a cross-module foreign key does not
 * enforce tenant isolation anyway (ADR-0042). So the check is a published contract read, and an
 * owner that cannot be confirmed is a refusal rather than a row nobody can explain later.
 */
export interface OwnerDirectoryPort {
  exists(ownerType: string, ownerId: string): Promise<boolean>;
}

/**
 * Whether a People identifier exists, and what People says about it.
 *
 * This is the D-1a boundary in one interface. Documents never stores an identifier's number,
 * issuing country or expiry; when a document evidences one it holds the identifier's id, and
 * anything else about it is read from People at the moment somebody asks. There is exactly one
 * authoritative answer to when a passport expires and it is not in this module.
 */
export interface IdentifierFacts {
  readonly personIdentifierId: string;
  readonly identifierType: string;
  readonly issuingCountry?: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
}

export interface PersonIdentifierPort {
  factsFor(personId: string, personIdentifierId: string): Promise<IdentifierFacts | undefined>;
}

/**
 * The storage boundary, and the honest shape of its absence.
 *
 * `StoragePort` exists in the kernel and **has no implementer anywhere in this repository**. Rather
 * than let every handler discover that separately, this port answers `available` and every caller
 * branches on it once. A caller is told the capability is unavailable; nothing returns a fabricated
 * URL, a placeholder path or a success that did not happen.
 */
export interface SignedUrlRequest {
  readonly storageReference: string;
  readonly expiresInSeconds: number;
}

export interface StorageAccessPort {
  /** False everywhere today. When an adapter exists this becomes true and nothing else changes. */
  readonly available: boolean;
  signedUrl(request: SignedUrlRequest): Promise<string | undefined>;
}

/**
 * The storage boundary with nothing behind it.
 *
 * Not a fake: a fake would return a URL. This returns nothing and says so, which is the difference
 * between "unavailable" and "broken" at the API edge.
 */
export const storageUnavailable: StorageAccessPort = {
  available: false,
  signedUrl: () => Promise.resolve(undefined),
};

export interface Clock {
  now(): Date;
}

/** Today as a civil date, for the expiry predicates. Never a `Date` where a calendar day is meant. */
export const civilToday = (clock: Clock): string => clock.now().toISOString().slice(0, 10);
