import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { DocumentState } from '../domain/document.js';
import type { DocumentTypeState } from '../domain/document-type.js';
import type {
  DocumentFilters,
  DocumentStore,
  DocumentTypeStore,
  Page,
  Paged,
} from '../application/documents-ports.js';
import {
  documentState,
  documentTypeState,
  documentTypeValues,
  documentValues,
  type DocumentRow,
  type DocumentTypeRow,
} from './document-rows.js';
import {
  civilDateColumn,
  insertRow,
  mutable,
  pageOf,
  predicateFor,
  type Filter,
} from './row-writer.js';

/** Document types and documents, in PostgreSQL. */

export class PostgresDocumentTypeRepository
  extends Repository<DocumentTypeRow & { version: number }>
  implements DocumentTypeStore
{
  public constructor() {
    super('document_type');
  }

  public async byId(transaction: Transaction, id: string): Promise<DocumentTypeState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : documentTypeState(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<DocumentTypeState | undefined> {
    const rows = await transaction.execute<DocumentTypeRow>(
      `select * from document_type
         where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : documentTypeState(rows[0]);
  }

  public async all(transaction: Transaction): Promise<readonly DocumentTypeState[]> {
    const rows = await transaction.execute<DocumentTypeRow>(
      `select * from document_type
         where tenant_id = $1 and deleted_at is null
         order by code`,
      [transaction.tenantId],
    );

    return rows.map(documentTypeState);
  }

  public insert(transaction: Transaction, state: DocumentTypeState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      documentTypeValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: DocumentTypeState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.documentTypeId,
      expected,
      mutable(documentTypeValues(state, transaction.tenantId)),
    );
  }
}

/**
 * The document itself.
 *
 * The search is where the confidentiality rule lives, and it lives **in the predicate** rather than
 * in a filter applied to the rows afterwards. Filtering after the page is cut would return short
 * pages and a total that counted rows the caller may not see — and the total is itself a disclosure
 * ("this employee has three medical documents"). The row never leaves the database.
 *
 * The expiry filter is a plain indexed comparison on `expiry_date`, never a text search. It is the
 * highest-value query in this module — "what is about to expire" — and it runs against the partial
 * index the migration creates.
 */
export class PostgresDocumentRepository
  extends Repository<DocumentRow & { version: number }>
  implements DocumentStore
{
  public constructor() {
    super('document');
  }

  public async byId(transaction: Transaction, id: string): Promise<DocumentState | undefined> {
    const rows = await transaction.execute<DocumentRow>(
      `select ${DOCUMENT_COLUMNS} from document d
         where d.id = $1 and d.tenant_id = $2 and d.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : documentState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: DocumentFilters,
    paged: Paged,
  ): Promise<Page<DocumentState>> {
    const predicate = predicateFor('d', transaction.tenantId, filtersOf(filters));
    const clause = filters.includeConfidential
      ? predicate.clause
      : `${predicate.clause} and d.confidentiality <> 'confidential'`;

    return pageOf<DocumentRow, DocumentState>(
      transaction,
      {
        select: `select ${DOCUMENT_COLUMNS} from document d
                   where ${clause}
                   order by d.created_at desc, d.id desc
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from document d where ${clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      documentState,
    );
  }

  public insert(transaction: Transaction, state: DocumentState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      documentValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: DocumentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.documentId,
      expected,
      mutable(documentValues(state, transaction.tenantId)),
    );
  }
}

const filtersOf = (filters: DocumentFilters): readonly Filter[] => [
  { column: 'd.owner_type', value: filters.ownerType },
  { column: 'd.owner_id', value: filters.ownerId },
  { column: 'd.document_type_id', value: filters.documentTypeId },
  { column: 'd.status', value: filters.status },
  { column: 'd.verification_state', value: filters.verificationState },
  // An indexed comparison, never `ILIKE`. This is the expiry queue.
  { column: 'd.expiry_date', value: filters.expiringOnOrBefore, operator: '<=' },
];

/**
 * Every column, with the two dates read as text.
 *
 * `select *` would return `issue_date` and `expiry_date` as `Date` values built at the process's
 * local midnight, which on a server west of UTC reports a valid passport as expired.
 */
const DOCUMENT_COLUMNS = [
  'd.id',
  'd.document_type_id',
  'd.owner_type',
  'd.owner_id',
  'd.person_identifier_id',
  'd.title',
  'd.status',
  'd.confidentiality',
  civilDateColumn('d.issue_date', 'issue_date'),
  civilDateColumn('d.expiry_date', 'expiry_date'),
  'd.verification_state',
  'd.current_version_id',
  'd.version_count',
  'd.source',
  'd.source_reference',
  'd.legal_hold',
  'd.legal_hold_reason',
  'd.retention_policy_code',
  'd.archived_at',
  'd.archived_by',
  'd.version',
].join(', ');
