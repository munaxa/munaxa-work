import type { Transaction } from '@work/kernel';

import type { ReconciliationFinding, ReconciliationStore } from '../application/documents-ports.js';

/**
 * What reconciliation found. **It reports; it repairs nothing** (D-22).
 *
 * Pull-based, following Payroll: correctness never depends on an event having been delivered, and
 * every check here is a query somebody can run at any moment. None of them modifies a row —
 * automatically deleting or rewriting a document because a check disagreed is how an audit trail
 * loses the evidence it existed for.
 *
 * **Two checks the plan names are absent and cannot be here**: a missing storage object and a
 * checksum mismatch both require reading the bytes, and no storage adapter exists in this
 * repository. They are `NOT VERIFIED` rather than approximated by something that looks similar.
 */
export class PostgresReconciliationRepository implements ReconciliationStore {
  /** A document pointing at a version that is not there, or holding versions and pointing at none. */
  public async inconsistentVersions(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]> {
    const rows = await transaction.execute<{ id: string; finding: string }>(
      `select d.id,
              case when d.current_version_id is null
                   then 'versions_without_current'
                   else 'current_version_missing' end as finding
         from document d
        where d.tenant_id = $1
          and d.deleted_at is null
          and (
            (d.current_version_id is null and exists (
               select 1 from document_version v
                where v.tenant_id = d.tenant_id and v.document_id = d.id and v.deleted_at is null))
            or
            (d.current_version_id is not null and not exists (
               select 1 from document_version v
                where v.tenant_id = d.tenant_id and v.id = d.current_version_id
                  and v.deleted_at is null))
          )
        order by d.id
        limit $2`,
      [transaction.tenantId, limit],
    );

    return rows.map((row) => ({ finding: row.finding, documentId: row.id }));
  }

  /**
   * Content held by more than one version in the tenant.
   *
   * Permitted and deliberately not refused — two employees legitimately hold the same blank form —
   * but worth a human's eye, because it is also what a mis-filed upload looks like (D-5).
   */
  public async duplicateContent(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]> {
    const rows = await transaction.execute<{
      id: string;
      document_id: string;
      content_hash: string;
      copies: string;
    }>(
      `select v.id, v.document_id, v.content_hash, counted.copies::text as copies
         from document_version v
         join (
           select content_hash, count(*) as copies
             from document_version
            where tenant_id = $1 and deleted_at is null
            group by content_hash
           having count(*) > 1
         ) counted on counted.content_hash = v.content_hash
        where v.tenant_id = $1 and v.deleted_at is null
        order by v.content_hash, v.id
        limit $2`,
      [transaction.tenantId, limit],
    );

    return rows.map((row) => ({
      finding: 'duplicate_content',
      documentId: row.document_id,
      documentVersionId: row.id,
      detail: { contentHash: row.content_hash, copies: row.copies },
    }));
  }

  /**
   * A document that reads as verified, whose verified version is no longer the current one.
   *
   * The domain returns a document to `pending_verification` when its file is replaced, so a row in
   * this state means something wrote around that path — which is exactly what a reconciliation
   * query is for.
   */
  public async staleVerifications(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]> {
    const rows = await transaction.execute<{ id: string }>(
      `select d.id
         from document d
        where d.tenant_id = $1
          and d.deleted_at is null
          and d.verification_state = 'verified'
          and not exists (
            select 1 from document_verification dv
             where dv.tenant_id = d.tenant_id
               and dv.document_id = d.id
               and dv.document_version_id = d.current_version_id
               and dv.decision = 'verified'
               and dv.deleted_at is null)
        order by d.id
        limit $2`,
      [transaction.tenantId, limit],
    );

    return rows.map((row) => ({ finding: 'stale_verification', documentId: row.id }));
  }
}
