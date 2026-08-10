import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { ApprovalDecisionState } from '../domain/approval.js';
import type { CompensationChangeState } from '../domain/change-log.js';
import type { ImportBatchState } from '../domain/import-batch.js';
import type {
  ChangeQuery,
  ChangeStore,
  DecisionStore,
  ImportBatchStore,
  Page,
  Paged,
} from '../application/compensation-ports.js';

import {
  CHANGE_COLUMNS,
  DECISION_COLUMNS,
  IMPORT_COLUMNS,
  changeValues,
  decisionValues,
  importBatchValues,
  toChange,
  toDecision,
  toImportBatch,
  type ChangeRow,
  type DecisionRow,
  type ImportBatchRow,
} from './audit-rows.js';
import { insertRow, mutable, pageOf, predicateFor } from './row-writer.js';

/**
 * The three tables that are the audit: approval decisions, append-only history and import batches.
 *
 * Two of these are deliberately **narrower than a repository normally is**. The decision and change
 * repositories offer `insert` and reads and nothing else — no `update`, no `remove`, no `restore` —
 * because a compensation figure somebody disputes is explained by those rows, and the cheapest
 * guarantee that nobody rewrote one is to have no method that could (ADR-0052 applied to a fourth
 * module).
 */

/** Insert and read, and nothing else. A wrong decision is reversed, never edited. */
export class ApprovalDecisionRepository implements DecisionStore {
  public async forSubject(
    transaction: Transaction,
    subjectKind: string,
    subjectId: string,
  ): Promise<readonly ApprovalDecisionState[]> {
    const rows = await transaction.execute<DecisionRow>(
      `select ${DECISION_COLUMNS} from compensation_approval_decision d
        where d.tenant_id = $1 and d.subject_kind = $2 and d.subject_id = $3
          and d.deleted_at is null
        order by d.sequence`,
      [transaction.tenantId, subjectKind, subjectId],
    );
    return rows.map(toDecision);
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ApprovalDecisionState | undefined> {
    const rows = await transaction.execute<DecisionRow>(
      `select ${DECISION_COLUMNS} from compensation_approval_decision d
        where d.id = $1 and d.tenant_id = $2 and d.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toDecision(row);
  }

  /** How many recurring records are waiting on somebody. The dashboard's one operational figure. */
  public async pendingCount(transaction: Transaction): Promise<number> {
    const rows = await transaction.execute<{ total: string }>(
      `select count(*) as total from compensation_recurring r
        where r.tenant_id = $1 and r.deleted_at is null and r.approval_state = 'pending'`,
      [transaction.tenantId],
    );
    return Number(rows[0]?.total ?? '0');
  }

  public async insert(transaction: Transaction, state: ApprovalDecisionState): Promise<void> {
    await insertRow(
      transaction,
      'compensation_approval_decision',
      decisionValues(state),
      new Date(),
    );
  }
}

/** Append-only compensation history. Inserted and read; there is no method that could rewrite it. */
export class CompensationChangeRepository implements ChangeStore {
  public forEmployment(
    transaction: Transaction,
    employmentId: string,
    bounds: Paged,
  ): Promise<Page<CompensationChangeState>> {
    return this.search(transaction, { ...bounds, employmentId });
  }

  public search(
    transaction: Transaction,
    query: ChangeQuery,
  ): Promise<Page<CompensationChangeState>> {
    const { clause, parameters, next } = predicateFor('h', transaction.tenantId, [
      { column: 'h.employment_id', value: query.employmentId, cast: '::uuid' },
      { column: 'h.component_id', value: query.componentId, cast: '::uuid' },
    ]);

    return pageOf<ChangeRow, CompensationChangeState>(
      transaction,
      {
        select: `select ${CHANGE_COLUMNS} from compensation_change h where ${clause}
                 order by h.recorded_at desc, h.id desc
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from compensation_change h where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toChange,
    );
  }

  public async insert(transaction: Transaction, state: CompensationChangeState): Promise<void> {
    await insertRow(transaction, 'compensation_change', changeValues(state), new Date());
  }
}

export class ImportBatchRepository
  extends Repository<{ id: string; version: number }>
  implements ImportBatchStore
{
  public constructor() {
    super('compensation_import_batch');
  }

  public async byId(transaction: Transaction, id: string): Promise<ImportBatchState | undefined> {
    const rows = await transaction.execute<ImportBatchRow>(
      `select ${IMPORT_COLUMNS} from compensation_import_batch b
        where b.id = $1 and b.tenant_id = $2 and b.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toImportBatch(row);
  }

  public async recent(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ImportBatchState[]> {
    const rows = await transaction.execute<ImportBatchRow>(
      `select ${IMPORT_COLUMNS} from compensation_import_batch b
        where b.tenant_id = $1 and b.deleted_at is null
        order by b.submitted_at desc limit $2`,
      [transaction.tenantId, limit],
    );
    return rows.map(toImportBatch);
  }

  public async insert(transaction: Transaction, state: ImportBatchState): Promise<void> {
    await insertRow(transaction, 'compensation_import_batch', importBatchValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: ImportBatchState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(importBatchValues(state)));
  }
}
