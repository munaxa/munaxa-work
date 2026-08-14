import type { Transaction } from '@work/kernel';

import type { WorkflowDecisionState } from '../domain/decision.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import type { DecisionStore, HistoryStore, Page, Paged } from '../application/workflow-ports.js';
import {
  decisionColumns,
  decisionState,
  decisionValues,
  historyColumns,
  historyState,
  historyValues,
  type DecisionRow,
  type HistoryRow,
} from './workflow-rows.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * The two append-only facts: what an approver said, and how an approval was routed.
 *
 * **Neither extends `Repository`, and that is the point.** The shared base provides `updateRow`,
 * `softDeleteRow` and `restoreRow` — three methods these tables must never have. A trigger refuses
 * all three at the database, and inheriting them here would leave a repository able to *attempt*
 * what the database will refuse, which is a runtime error where a compile error belongs. Career's
 * readiness assessments are the same construction for the same reason.
 *
 * So each holds inserts and reads and nothing else, and the shape is the guarantee: there is no
 * method on either of these through which a decision could be amended or a timeline rewritten. A
 * correction is a new approval.
 *
 * **Nothing here opens a transaction.** A decision is written in the same unit of work that moved
 * the step it decided, so an approval cannot record an answer to a step that never advanced.
 */

export class PostgresDecisionRepository implements DecisionStore {
  /** The chain of one approval, oldest first. Bounded by the approval's own length. */
  public async forInstance(
    transaction: Transaction,
    instanceId: string,
  ): Promise<readonly WorkflowDecisionState[]> {
    const rows = await transaction.execute<DecisionRow>(
      `select ${decisionColumns('d')} from workflow_decision d
         where d.instance_id = $1 and d.tenant_id = $2 and d.deleted_at is null
         order by d.decided_at, d.id`,
      [instanceId, transaction.tenantId],
    );

    return rows.map(decisionState);
  }

  /**
   * What one membership decided.
   *
   * The other half of a queue, on the same identity rule: a **delegated** decision appears here for
   * the delegate, because they are the one who decided it, and not for the delegator, whose
   * authority was used but who did not act. That distinction is the two columns, read back out.
   */
  public async decidedBy(
    transaction: Transaction,
    decidedByMembershipId: string,
    paged: Paged,
  ): Promise<Page<WorkflowDecisionState>> {
    const parameters = [decidedByMembershipId, transaction.tenantId];
    const clause = `d.decided_by_membership_id = $1 and d.tenant_id = $2 and d.deleted_at is null`;

    return pageOf<DecisionRow, WorkflowDecisionState>(
      transaction,
      {
        select: `select ${decisionColumns('d')} from workflow_decision d
                   where ${clause}
                   order by d.id desc
                   limit $3 offset $4`,
        count: `select count(*)::text as total from workflow_decision d where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      decisionState,
    );
  }

  public insert(transaction: Transaction, state: WorkflowDecisionState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_decision',
      decisionValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

export class PostgresHistoryRepository implements HistoryStore {
  /**
   * One approval's timeline, oldest first and paged.
   *
   * Paged because it grows with the length of the process and every reassignment, and a timeline is
   * exactly the read somebody would otherwise ask for unbounded. `workflow_history_instance_idx` is
   * ordered `(tenant_id, instance_id, occurred_at, id)`, so the order this asks for is the order the
   * index already holds and no sort is needed.
   */
  public forInstance(
    transaction: Transaction,
    instanceId: string,
    paged: Paged,
  ): Promise<Page<WorkflowHistoryState>> {
    const parameters = [instanceId, transaction.tenantId];
    const clause = `h.instance_id = $1 and h.tenant_id = $2 and h.deleted_at is null`;

    return pageOf<HistoryRow, WorkflowHistoryState>(
      transaction,
      {
        select: `select ${historyColumns('h')} from workflow_history h
                   where ${clause}
                   order by h.occurred_at, h.id
                   limit $3 offset $4`,
        count: `select count(*)::text as total from workflow_history h where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      historyState,
    );
  }

  public insert(transaction: Transaction, state: WorkflowHistoryState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_history',
      historyValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
