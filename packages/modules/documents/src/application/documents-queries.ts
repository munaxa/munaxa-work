import { success, type Query, type QueryHandler } from '@work/kernel';

import { recordAccessFor } from './access-recording.js';
import { hiddenFromCaller } from './confidentiality.js';
import { notFound } from './documents-context.js';
import { DocumentsPermissions } from './documents-permissions.js';
import {
  accessEventView,
  documentTypeView,
  documentVersionView,
  documentView,
  verificationView,
  type ExpiryWindowInput,
} from './documents-views.js';
import { civilToday, type Page, type Paged } from './documents-ports.js';
import type { DocumentsDependencies } from './documents-dependencies.js';
import type {
  AccessEventView,
  DocumentTypeView,
  DocumentVersionView,
  DocumentView,
  ReconciliationFindingView,
  VerificationView,
} from '../contracts/views.js';

/**
 * The reads, and the three rules every one of them keeps.
 *
 * **Bounded.** Every collection takes a page and clamps it. A tenant with two million versions is
 * the ordinary case in this module, and an unbounded read would be the first thing to fall over.
 *
 * **Confidentiality is applied in the query, not after it.** A caller without
 * `document.read-sensitive` does not receive confidential documents and does not learn how many
 * were withheld — a count is itself a disclosure ("this employee has three medical documents").
 * The predicate goes to the database, so the rows never leave it.
 *
 * **Reading metadata is recorded.** `documents.read-document` writes an access event, because "who
 * has looked at this employee's file" is the question the trail exists to answer and a read that
 * left no trace would leave a hole in it.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  readonly page?: number;
  readonly size?: number;
}

export const bounded = (request: PageRequest): Paged => {
  const size = Math.min(Math.max(request.size ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(request.page ?? 1, 1);

  return { limit: size, offset: (page - 1) * size };
};

export interface ListDocumentTypes extends Query {
  readonly queryName: 'documents.types';
}

export const listDocumentTypesHandler = (
  dependencies: DocumentsDependencies,
): QueryHandler<ListDocumentTypes, { readonly items: readonly DocumentTypeView[] }> => ({
  queryName: 'documents.types',
  permission: DocumentsPermissions.typeRead,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const types = await dependencies.stores.types.all(transaction);

      return success({ items: types.map(documentTypeView) });
    }),
});

export interface SearchDocuments extends Query, PageRequest {
  readonly queryName: 'documents.search';
  readonly ownerType?: string;
  readonly ownerId?: string;
  readonly documentTypeId?: string;
  readonly status?: string;
  readonly verificationState?: string;
  /** The expiry queue: documents expiring on or before this civil date. An indexed predicate. */
  readonly expiringOnOrBefore?: string;
  /** Honoured only for a caller holding `document.read-sensitive`; see `sensitive` below. */
  readonly includeConfidential?: boolean;
}

/**
 * Searching documents.
 *
 * The permission this declares is `document.read` — the ordinary one. Confidential documents are
 * excluded unless the caller *also* holds `document.read-sensitive`, which the handler establishes
 * by asking the pipeline rather than by trusting the request. A caller cannot widen their own view
 * by setting a flag.
 */
export const searchDocumentsHandler = (
  dependencies: DocumentsDependencies,
): QueryHandler<SearchDocuments, Page<DocumentView>> => ({
  queryName: 'documents.search',
  permission: DocumentsPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const sensitive = await dependencies.permissions.holds(DocumentsPermissions.readSensitive);
      const found = await dependencies.stores.documents.search(
        transaction,
        {
          includeConfidential: sensitive && (query.includeConfidential ?? true),
          ...(query.ownerType === undefined ? {} : { ownerType: query.ownerType }),
          ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
          ...(query.documentTypeId === undefined ? {} : { documentTypeId: query.documentTypeId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...(query.verificationState === undefined
            ? {}
            : { verificationState: query.verificationState }),
          ...(query.expiringOnOrBefore === undefined
            ? {}
            : { expiringOnOrBefore: query.expiringOnOrBefore }),
        },
        bounded(query),
      );
      const window = await windowFor(dependencies, transaction);

      return success({
        items: found.items.map((state) => documentView(state, window)),
        total: found.total,
      });
    }),
});

/**
 * The widest notice window configured in the tenant, and today.
 *
 * One read per query rather than one per document: the expiry state is derived, and deriving it
 * needs the thresholds. Types are few and change rarely, which is why this is affordable.
 */
const windowFor = async (
  dependencies: DocumentsDependencies,
  transaction: Parameters<typeof dependencies.stores.types.all>[0],
): Promise<ExpiryWindowInput> => {
  const types = await dependencies.stores.types.all(transaction);

  return {
    today: civilToday(dependencies.clock),
    noticeDays: [...new Set(types.flatMap((type) => type.noticeDays))],
  };
};

export interface ReadDocument extends Query {
  readonly queryName: 'documents.read-document';
  readonly documentId: string;
}

export interface DocumentDetail {
  readonly document: DocumentView;
  readonly versions: readonly DocumentVersionView[];
  readonly verifications: readonly VerificationView[];
}

/**
 * One document, its versions and its verification history.
 *
 * **The read is recorded.** A metadata read of somebody's file is exactly what the access trail
 * exists to capture, and recording only downloads would leave the question "who has been looking at
 * this employee" unanswerable.
 */
export const readDocumentHandler = (
  dependencies: DocumentsDependencies,
): QueryHandler<ReadDocument, DocumentDetail> => ({
  queryName: 'documents.read-document',
  permission: DocumentsPermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const document = await dependencies.stores.documents.byId(transaction, query.documentId);

      if (document === undefined) return notFound<DocumentDetail>('document');
      // A confidential document is *not found* rather than forbidden for a caller without
      // `document.read-sensitive`: "forbidden" on an identifier confirms that a document of that
      // kind exists for that employee, which in this module is itself the disclosure.
      if (await hiddenFromCaller(dependencies, document)) {
        return notFound<DocumentDetail>('document');
      }

      const [versions, verifications, window] = await Promise.all([
        dependencies.stores.versions.forDocument(transaction, document.documentId),
        dependencies.stores.verifications.forDocument(transaction, document.documentId),
        windowFor(dependencies, transaction),
      ]);
      // Where People owns the expiry, the view reports People's date rather than a blank.
      const identifier =
        document.personIdentifierId === undefined
          ? undefined
          : await dependencies.identifiers.factsFor(document.ownerId, document.personIdentifierId);

      await recordAccessFor(dependencies, transaction, {
        documentId: document.documentId,
        action: 'metadata_read',
      });

      return success({
        document: documentView(document, window, identifier),
        versions: versions.map(documentVersionView),
        verifications: verifications.map(verificationView),
      });
    }),
});

export interface ReadDocumentAudit extends Query, PageRequest {
  readonly queryName: 'documents.audit';
  readonly documentId: string;
}

/** The access trail for one document, behind its own permission. Reading it is itself sensitive. */
export const readDocumentAuditHandler = (
  dependencies: DocumentsDependencies,
): QueryHandler<ReadDocumentAudit, Page<AccessEventView>> => ({
  queryName: 'documents.audit',
  permission: DocumentsPermissions.audit,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.access.forDocument(
        transaction,
        query.documentId,
        bounded(query),
      );

      return success({ items: found.items.map(accessEventView), total: found.total });
    }),
});

export interface ReadReconciliation extends Query {
  readonly queryName: 'documents.reconciliation';
}

/**
 * What reconciliation found. **It reports; it repairs nothing** (D-22).
 *
 * Pull-based, following Payroll: correctness never depends on an event having been delivered. Every
 * check here is a query somebody can run at any moment, and none of them modifies a row —
 * automatically deleting or rewriting a document because a check disagreed is how an audit trail
 * loses the evidence it existed for.
 *
 * The storage checks the plan names — a missing object, a checksum mismatch — are **not here and
 * cannot be**: both require reading the bytes, and no storage adapter exists. They are `NOT
 * VERIFIED` rather than approximated.
 */
export const readReconciliationHandler = (
  dependencies: DocumentsDependencies,
): QueryHandler<
  ReadReconciliation,
  { readonly findings: readonly ReconciliationFindingView[] }
> => ({
  queryName: 'documents.reconciliation',
  permission: DocumentsPermissions.manage,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const [inconsistent, duplicates, stale] = await Promise.all([
        dependencies.stores.reconciliation.inconsistentVersions(transaction, FINDING_LIMIT),
        dependencies.stores.reconciliation.duplicateContent(transaction, FINDING_LIMIT),
        dependencies.stores.reconciliation.staleVerifications(transaction, FINDING_LIMIT),
      ]);

      return success({ findings: [...inconsistent, ...duplicates, ...stale] });
    }),
});

/** Bounded like everything else: a reconciliation that returns a million rows helps nobody. */
const FINDING_LIMIT = 200;
