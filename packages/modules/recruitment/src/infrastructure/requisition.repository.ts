import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { RequisitionDecisionState, RequisitionState } from '../domain/requisition.js';
import type {
  Page,
  RequisitionDecisionStore,
  RequisitionQuery,
  RequisitionStore,
} from '../application/recruitment-ports.js';

import {
  DECISION_COLUMNS,
  REQUISITION_COLUMNS,
  decisionInsert,
  requisitionInsert,
  requisitionUpdate,
  toDecision,
  toRequisition,
  type DecisionRow,
  type RequisitionRow,
} from './recruitment-rows.js';
import { requisitionFilters } from './recruitment-search.js';
import { insertRow, pageOf } from './row-writer.js';

export class RequisitionRepository
  extends Repository<{ id: string; version: number }>
  implements RequisitionStore
{
  public constructor() {
    super('recruitment_requisition');
  }

  public async byId(transaction: Transaction, id: string): Promise<RequisitionState | undefined> {
    const rows = await transaction.execute<RequisitionRow>(
      `select ${REQUISITION_COLUMNS} from recruitment_requisition r
        where r.id = $1 and r.tenant_id = $2 and r.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toRequisition(row);
  }

  public search(
    transaction: Transaction,
    query: RequisitionQuery,
  ): Promise<Page<RequisitionState>> {
    const { where, parameters } = requisitionFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<RequisitionRow, RequisitionState>(
      transaction,
      {
        select: `select ${REQUISITION_COLUMNS} from recruitment_requisition r where ${where}
                 order by r.requisition_number limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from recruitment_requisition r where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toRequisition,
    );
  }

  public async all(transaction: Transaction): Promise<readonly RequisitionState[]> {
    const rows = await transaction.execute<RequisitionRow>(
      `select ${REQUISITION_COLUMNS} from recruitment_requisition r
        where r.tenant_id = $1 and r.deleted_at is null order by r.requisition_number`,
      [transaction.tenantId],
    );
    return rows.map(toRequisition);
  }

  public async insert(transaction: Transaction, state: RequisitionState): Promise<void> {
    await insertRow(transaction, this.table, requisitionInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: RequisitionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, requisitionUpdate(state));
  }
}

/**
 * Decisions on requisitions: appended, never updated.
 *
 * There is no `update` here and no soft delete, and both absences are the point. An approval that
 * could be rewritten afterwards is not evidence of anything, and the cheapest way to guarantee that
 * is to give the code no way to do it — a reversal is a new row naming the decision it reverses
 * (ADR-0045).
 */
export class RequisitionDecisionRepository implements RequisitionDecisionStore {
  public async forRequisition(
    transaction: Transaction,
    requisitionId: string,
  ): Promise<readonly RequisitionDecisionState[]> {
    const rows = await transaction.execute<DecisionRow>(
      `select ${DECISION_COLUMNS} from recruitment_requisition_decision
        where tenant_id = $1 and requisition_id = $2 and deleted_at is null
        order by decided_at, id`,
      [transaction.tenantId, requisitionId],
    );
    return rows.map(toDecision);
  }

  public async insert(transaction: Transaction, state: RequisitionDecisionState): Promise<void> {
    await insertRow(
      transaction,
      'recruitment_requisition_decision',
      decisionInsert(state),
      new Date(),
    );
  }
}
