import type { Transaction } from '@work/kernel';

import type { AccessEventState } from '../domain/access-event.js';
import type { DocumentState } from '../domain/document.js';
import type { DocumentTypeState } from '../domain/document-type.js';
import type { DocumentVersionState } from '../domain/document-version.js';
import type { VerificationDecisionState } from '../domain/verification.js';
import type {
  DocumentFilters,
  DocumentsStores,
  Page,
  Paged,
  ReconciliationFinding,
} from './documents-ports.js';

/**
 * In-memory stores, for the suites that test **behaviour** rather than persistence.
 *
 * They implement the same interfaces the PostgreSQL repositories do, so a handler cannot tell them
 * apart. The integration suites then prove the same behaviour survives real SQL, real constraints
 * and real row-level security.
 *
 * **Three production rules are enforced here too**, because a fake more permissive than the database
 * hides exactly the defects these suites exist to find: a version number is unique per document, a
 * version already decided cannot receive a second decision, and neither a version nor an access
 * event can be rewritten — the interfaces offer no method that could, and the maps are never
 * overwritten in place.
 */

/** The SQLSTATE a real unique index raises, so the repository's translation is exercised too. */
export class ConstraintViolation extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}

const UNIQUE_VIOLATION = '23505';

const paged = <TState>(items: readonly TState[], page: Paged): Page<TState> => ({
  items: items.slice(page.offset, page.offset + page.limit),
  total: items.length,
});

interface Tables {
  readonly types: Map<string, DocumentTypeState>;
  readonly documents: Map<string, DocumentState>;
  readonly versions: Map<string, DocumentVersionState>;
  readonly verifications: Map<string, VerificationDecisionState>;
  readonly access: AccessEventState[];
}

export const inMemoryDocumentsStores = (): DocumentsStores => {
  const tables: Tables = {
    types: new Map(),
    documents: new Map(),
    versions: new Map(),
    verifications: new Map(),
    access: [],
  };

  return {
    types: typeStore(tables),
    documents: documentStore(tables),
    versions: versionStore(tables),
    verifications: verificationStore(tables),
    access: accessStore(tables),
    reconciliation: reconciliationStore(tables),
  };
};

const typeStore = (tables: Tables): DocumentsStores['types'] => ({
  byId: (_transaction: Transaction, id) => Promise.resolve(tables.types.get(id)),
  byCode: (_transaction, code) =>
    Promise.resolve([...tables.types.values()].find((type) => type.code === code)),
  all: () => Promise.resolve([...tables.types.values()]),

  insert: (_transaction, state) => {
    if ([...tables.types.values()].some((held) => held.code === state.code)) {
      throw new ConstraintViolation(UNIQUE_VIOLATION);
    }
    tables.types.set(state.documentTypeId, state);
    return Promise.resolve();
  },

  update: (_transaction, state, expected) => {
    const held = tables.types.get(state.documentTypeId);

    if (held !== undefined && held.version !== expected) {
      throw new ConstraintViolation('concurrent_modification');
    }
    tables.types.set(state.documentTypeId, { ...state, version: (held?.version ?? 0) + 1 });
    return Promise.resolve();
  },
});

const documentStore = (tables: Tables): DocumentsStores['documents'] => ({
  byId: (_transaction: Transaction, id) => Promise.resolve(tables.documents.get(id)),

  search: (_transaction, filters, page) =>
    Promise.resolve(paged([...tables.documents.values()].filter(matching(filters)), page)),

  insert: (_transaction, state) => {
    tables.documents.set(state.documentId, state);
    return Promise.resolve();
  },

  update: (_transaction, state, expected) => {
    const held = tables.documents.get(state.documentId);

    if (held !== undefined && held.version !== expected) {
      throw new ConstraintViolation('concurrent_modification');
    }
    // The version the repository writes is the held one plus one; the fake does the same so a
    // handler that forgets to re-read cannot pass here and fail against SQL.
    tables.documents.set(state.documentId, { ...state, version: (held?.version ?? 0) + 1 });
    return Promise.resolve();
  },
});

/**
 * The search predicate, confidentiality included.
 *
 * `includeConfidential` is applied here rather than after the page is cut, exactly as the SQL does:
 * filtering afterwards would return short pages and leak a count — "this employee has three
 * documents you may not see" is itself the disclosure.
 */
const matching =
  (filters: DocumentFilters) =>
  (state: DocumentState): boolean =>
    (filters.includeConfidential || state.confidentiality !== 'confidential') &&
    EQUALITIES.every(([of, wanted]) => same(of(state), wanted(filters))) &&
    expiringBy(state, filters.expiringOnOrBefore);

/** The plain equality filters, as pairs, so adding one is a line rather than another branch. */
const EQUALITIES: readonly [
  (state: DocumentState) => string,
  (filters: DocumentFilters) => string | undefined,
][] = [
  [(state) => state.ownerType, (filters) => filters.ownerType],
  [(state) => state.ownerId, (filters) => filters.ownerId],
  [(state) => state.documentTypeId, (filters) => filters.documentTypeId],
  [(state) => state.status, (filters) => filters.status],
  [(state) => state.verificationState, (filters) => filters.verificationState],
];

const same = (held: string, wanted: string | undefined): boolean =>
  wanted === undefined || held === wanted;

const expiringBy = (state: DocumentState, on: string | undefined): boolean =>
  on === undefined || (state.expiryDate !== undefined && state.expiryDate <= on);

const versionStore = (tables: Tables): DocumentsStores['versions'] => ({
  byId: (_transaction: Transaction, id) => Promise.resolve(tables.versions.get(id)),

  forDocument: (_transaction, documentId) =>
    Promise.resolve(
      [...tables.versions.values()]
        .filter((state) => state.documentId === documentId)
        .sort((one, other) => one.versionNumber - other.versionNumber),
    ),

  highestVersionNumber: (_transaction, documentId) =>
    Promise.resolve(
      [...tables.versions.values()]
        .filter((state) => state.documentId === documentId)
        .reduce((highest, state) => Math.max(highest, state.versionNumber), 0),
    ),

  byContentHash: (_transaction, contentHash, limit) =>
    Promise.resolve(
      [...tables.versions.values()]
        .filter((state) => state.contentHash === contentHash)
        .slice(0, limit),
    ),

  insert: (_transaction, state) => {
    // The unique index, in memory: two administrators replacing the same file at the same moment
    // produce one version and one refusal, never two rows both calling themselves "version 2".
    const taken = [...tables.versions.values()].some(
      (held) => held.documentId === state.documentId && held.versionNumber === state.versionNumber,
    );

    if (taken) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.versions.set(state.documentVersionId, state);
    return Promise.resolve();
  },

  supersede: (_transaction, id, moment) => {
    const held = tables.versions.get(id);

    // The one column the immutability trigger permits. Everything else about the row is untouched.
    if (held !== undefined) tables.versions.set(id, { ...held, supersededAt: moment });
    return Promise.resolve();
  },
});

const verificationStore = (tables: Tables): DocumentsStores['verifications'] => ({
  forDocument: (_transaction: Transaction, documentId) =>
    Promise.resolve(
      [...tables.verifications.values()]
        .filter((state) => state.documentId === documentId)
        .sort((one, other) => one.decidedAt.getTime() - other.decidedAt.getTime()),
    ),

  forVersion: (_transaction, versionId) =>
    Promise.resolve(
      [...tables.verifications.values()].find((state) => state.documentVersionId === versionId),
    ),

  insert: (_transaction, state) => {
    const decided = [...tables.verifications.values()].some(
      (held) => held.documentVersionId === state.documentVersionId,
    );

    if (decided) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.verifications.set(state.verificationId, state);
    return Promise.resolve();
  },
});

/** Insert and read, and nothing else — the same surface the interface and the trigger allow. */
const accessStore = (tables: Tables): DocumentsStores['access'] => ({
  forDocument: (_transaction: Transaction, documentId, page) =>
    Promise.resolve(
      paged(
        tables.access
          .filter((state) => state.documentId === documentId)
          .sort((one, other) => other.occurredAt.getTime() - one.occurredAt.getTime()),
        page,
      ),
    ),

  insert: (_transaction, state) => {
    tables.access.push(state);
    return Promise.resolve();
  },
});

/**
 * Reconciliation over the in-memory tables. It reports; it repairs nothing (D-22).
 *
 * The storage checks — a missing object, a checksum mismatch — are absent here as they are
 * everywhere: both require reading bytes, and no storage adapter exists.
 */
const reconciliationStore = (tables: Tables): DocumentsStores['reconciliation'] => ({
  inconsistentVersions: (_transaction: Transaction, limit) =>
    Promise.resolve(inconsistent(tables).slice(0, limit)),
  duplicateContent: (_transaction, limit) => Promise.resolve(duplicates(tables).slice(0, limit)),
  staleVerifications: (_transaction, limit) => Promise.resolve(stale(tables).slice(0, limit)),
});

const inconsistent = (tables: Tables): readonly ReconciliationFinding[] =>
  [...tables.documents.values()].flatMap((document) => {
    const held = [...tables.versions.values()].filter(
      (version) => version.documentId === document.documentId,
    );

    if (document.currentVersionId === undefined) {
      return held.length === 0
        ? []
        : [{ finding: 'versions_without_current', documentId: document.documentId }];
    }
    return tables.versions.has(document.currentVersionId)
      ? []
      : [{ finding: 'current_version_missing', documentId: document.documentId }];
  });

const duplicates = (tables: Tables): readonly ReconciliationFinding[] => {
  const byHash = new Map<string, DocumentVersionState[]>();

  for (const version of tables.versions.values()) {
    byHash.set(version.contentHash, [...(byHash.get(version.contentHash) ?? []), version]);
  }
  return [...byHash.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) =>
      group.map((version) => ({
        finding: 'duplicate_content',
        documentId: version.documentId,
        documentVersionId: version.documentVersionId,
        detail: { contentHash: version.contentHash, copies: String(group.length) },
      })),
    );
};

const stale = (tables: Tables): readonly ReconciliationFinding[] =>
  [...tables.documents.values()]
    .filter((document) => document.verificationState === 'verified')
    .filter((document) => {
      const decided = [...tables.verifications.values()].filter(
        (one) => one.documentId === document.documentId && one.decision === 'verified',
      );

      return !decided.some((one) => one.documentVersionId === document.currentVersionId);
    })
    .map((document) => ({ finding: 'stale_verification', documentId: document.documentId }));
