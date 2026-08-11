import { auditForUpdate } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { AccessEventState } from '../domain/access-event.js';
import type { DocumentVersionState } from '../domain/document-version.js';
import type { VerificationDecisionState } from '../domain/verification.js';
import type {
  AccessEventStore,
  Page,
  Paged,
  VerificationStore,
  VersionStore,
} from '../application/documents-ports.js';
import {
  accessEventState,
  accessEventValues,
  documentVersionState,
  documentVersionValues,
  verificationState,
  verificationValues,
  type AccessEventRow,
  type DocumentVersionRow,
  type VerificationRow,
} from './document-rows.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * The three insert-only tables: versions, verification decisions and the access trail.
 *
 * **None of them extends `Repository`.** That base provides `updateRow`, `softDeleteRow` and
 * `restoreRow`, and none of those may exist for these tables: a document somebody disputes is
 * explained by these rows, and the cheapest guarantee that nobody rewrote one is to have no method
 * that could. Database triggers refuse the same operations from any path including SQL nobody wrote
 * in TypeScript; this is the same rule expressed where a developer meets it first.
 *
 * The one exception is `supersede`, which stamps `superseded_at` on a version that is no longer
 * current. The trigger permits exactly that column and refuses every other change to the row.
 */

export class PostgresVersionRepository implements VersionStore {
  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<DocumentVersionState | undefined> {
    const rows = await transaction.execute<DocumentVersionRow>(
      `select * from document_version
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : documentVersionState(rows[0]);
  }

  public async forDocument(
    transaction: Transaction,
    documentId: string,
  ): Promise<readonly DocumentVersionState[]> {
    const rows = await transaction.execute<DocumentVersionRow>(
      `select * from document_version
         where tenant_id = $1 and document_id = $2 and deleted_at is null
         order by version_number`,
      [transaction.tenantId, documentId],
    );

    return rows.map(documentVersionState);
  }

  /**
   * The highest version number written for a document, or 0.
   *
   * Read inside the writing transaction, and the unique index on
   * `(tenant_id, document_id, version_number)` is what actually settles two administrators replacing
   * the same file at the same moment — the loser is refused rather than silently producing a second
   * "version 2".
   */
  public async highestVersionNumber(transaction: Transaction, documentId: string): Promise<number> {
    const rows = await transaction.execute<{ highest: string | null }>(
      `select max(version_number)::text as highest from document_version
         where tenant_id = $1 and document_id = $2 and deleted_at is null`,
      [transaction.tenantId, documentId],
    );

    return Number(rows[0]?.highest ?? '0');
  }

  public async byContentHash(
    transaction: Transaction,
    contentHash: string,
    limit: number,
  ): Promise<readonly DocumentVersionState[]> {
    const rows = await transaction.execute<DocumentVersionRow>(
      `select * from document_version
         where tenant_id = $1 and content_hash = $2 and deleted_at is null
         order by created_at
         limit $3`,
      [transaction.tenantId, contentHash, limit],
    );

    return rows.map(documentVersionState);
  }

  public insert(transaction: Transaction, state: DocumentVersionState): Promise<void> {
    return insertRow(
      transaction,
      'document_version',
      documentVersionValues(state, transaction.tenantId),
      new Date(),
    );
  }

  /**
   * The one column the immutability trigger permits, and it is a stamp rather than a change.
   *
   * The audit columns move with it because every other write in this product records who and when,
   * and the trigger excludes exactly those three from the byte-for-byte comparison it makes before
   * allowing the stamp. `superseded_at is null` in the predicate means a second supersession is a
   * no-op here and a refusal at the trigger — belt and braces on the column that says which file is
   * current.
   */
  public async supersede(transaction: Transaction, id: string, moment: Date): Promise<void> {
    const audit = auditForUpdate(moment);

    await transaction.execute(
      `update document_version
          set superseded_at = $1, updated_at = $2, updated_by = $3, version = version + 1
        where id = $4 and tenant_id = $5 and superseded_at is null`,
      [moment, audit.updated_at, audit.updated_by, id, transaction.tenantId],
    );
  }
}

export class PostgresVerificationRepository implements VerificationStore {
  public async forDocument(
    transaction: Transaction,
    documentId: string,
  ): Promise<readonly VerificationDecisionState[]> {
    const rows = await transaction.execute<VerificationRow>(
      `select * from document_verification
         where tenant_id = $1 and document_id = $2 and deleted_at is null
         order by decided_at`,
      [transaction.tenantId, documentId],
    );

    return rows.map(verificationState);
  }

  public async forVersion(
    transaction: Transaction,
    versionId: string,
  ): Promise<VerificationDecisionState | undefined> {
    const rows = await transaction.execute<VerificationRow>(
      `select * from document_verification
         where tenant_id = $1 and document_version_id = $2 and deleted_at is null`,
      [transaction.tenantId, versionId],
    );

    return rows[0] === undefined ? undefined : verificationState(rows[0]);
  }

  public insert(transaction: Transaction, state: VerificationDecisionState): Promise<void> {
    return insertRow(
      transaction,
      'document_verification',
      verificationValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

/**
 * The access trail: insert and read, and nothing else.
 *
 * Ordered newest first, because the question somebody asks of it is "who has looked at this
 * recently" rather than "who looked at it in 2019".
 */
export class PostgresAccessEventRepository implements AccessEventStore {
  public forDocument(
    transaction: Transaction,
    documentId: string,
    paged: Paged,
  ): Promise<Page<AccessEventState>> {
    return pageOf<AccessEventRow, AccessEventState>(
      transaction,
      {
        select: `select * from document_access_event
                   where tenant_id = $1 and document_id = $2 and deleted_at is null
                   order by occurred_at desc, id desc
                   limit $3 offset $4`,
        count: `select count(*)::text as total from document_access_event
                  where tenant_id = $1 and document_id = $2 and deleted_at is null`,
        parameters: [transaction.tenantId, documentId],
        limit: paged.limit,
        offset: paged.offset,
      },
      accessEventState,
    );
  }

  public insert(transaction: Transaction, state: AccessEventState): Promise<void> {
    return insertRow(
      transaction,
      'document_access_event',
      accessEventValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
