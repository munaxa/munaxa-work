import type { Transaction } from '@work/kernel';

import type {
  LettersReconciliationStore,
  ReconciliationFinding,
} from '../application/letters-ports.js';

/**
 * What reconciliation found. **It reports; it repairs nothing** (D-22).
 *
 * Pull-based, following Payroll: correctness never depends on an event having been delivered, and
 * every check here is a query somebody can run at any moment. None modifies a row — automatically
 * cancelling or rewriting a letter because a check disagreed is how a register loses the evidence
 * it existed for.
 */
export class PostgresLettersReconciliationRepository implements LettersReconciliationStore {
  /**
   * A request stuck mid-flight.
   *
   * `generating` is the interesting one: nothing runs asynchronously in this module, so a request
   * left in that state means a transaction died between the move and the issue. `issued` with no
   * letter row means worse — a request that believes it produced something that is not there.
   */
  public async incompleteIssuance(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]> {
    const rows = await transaction.execute<{ id: string; finding: string }>(
      `select r.id,
              case when r.status = 'generating'
                   then 'generation_incomplete'
                   else 'issued_without_letter' end as finding
         from letter_request r
        where r.tenant_id = $1
          and r.deleted_at is null
          and (
            r.status = 'generating'
            or (r.status = 'issued' and not exists (
                  select 1 from letter_issued l
                   where l.tenant_id = r.tenant_id and l.letter_request_id = r.id
                     and l.deleted_at is null))
          )
        order by r.id
        limit $2`,
      [transaction.tenantId, limit],
    );

    return rows.map((row) => ({ finding: row.finding, letterRequestId: row.id }));
  }

  /**
   * An issued letter generated from a template version its request did not name.
   *
   * Both rows carry the version, deliberately: the letter's copy is what it was actually generated
   * from, and a disagreement between them means something re-pointed the request afterwards.
   */
  public async templateVersionMismatch(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]> {
    const rows = await transaction.execute<{ id: string; letter_request_id: string }>(
      `select l.id, l.letter_request_id
         from letter_issued l
         join letter_request r
           on r.tenant_id = l.tenant_id and r.id = l.letter_request_id and r.deleted_at is null
        where l.tenant_id = $1
          and l.deleted_at is null
          and r.letter_template_version_id <> l.letter_template_version_id
        order by l.id
        limit $2`,
      [transaction.tenantId, limit],
    );

    return rows.map((row) => ({
      finding: 'template_version_mismatch',
      letterRequestId: row.letter_request_id,
      issuedLetterId: row.id,
    }));
  }

  /**
   * A letter issued from a template requiring approval, whose chain does not stand as approved.
   *
   * The standing decision is the latest un-reversed one. A reversal does not erase what it
   * reverses, so this is a question about the whole chain rather than about the last row — which is
   * exactly why it is worth asking of the database rather than trusting the status column.
   */
  public async approvalInconsistency(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]> {
    const rows = await transaction.execute<{ id: string; letter_request_id: string }>(
      `select l.id, l.letter_request_id
         from letter_issued l
         join letter_template t
           on t.tenant_id = l.tenant_id and t.id = l.letter_template_id and t.deleted_at is null
        where l.tenant_id = $1
          and l.deleted_at is null
          and t.requires_approval
          and coalesce((
            select d.decision
              from letter_approval_decision d
             where d.tenant_id = l.tenant_id
               and d.letter_request_id = l.letter_request_id
               and d.deleted_at is null
               and d.decision <> 'reversed'
               and not exists (
                 select 1 from letter_approval_decision reversal
                  where reversal.tenant_id = d.tenant_id
                    and reversal.reverses_id = d.id
                    and reversal.deleted_at is null)
             order by d.sequence desc
             limit 1), 'pending') <> 'approved'
        order by l.id
        limit $2`,
      [transaction.tenantId, limit],
    );

    return rows.map((row) => ({
      finding: 'approval_no_longer_stands',
      letterRequestId: row.letter_request_id,
      issuedLetterId: row.id,
    }));
  }
}
