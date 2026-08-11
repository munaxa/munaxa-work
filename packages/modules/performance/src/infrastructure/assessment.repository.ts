import { Repository, auditForInsert } from '@work/persistence';
import { uuidV7, type Transaction } from '@work/kernel';
import type { AssessmentItemState, AssessmentState } from '../domain/assessment.js';
import type {
  AssessmentStore,
  ComponentScoreRecord,
  ComponentScoreStore,
} from '../application/performance-ports.js';
import {
  assessmentItemState,
  assessmentItemValues,
  assessmentState,
  assessmentValues,
  componentScoreRecord,
  componentScoreValues,
  type AssessmentItemRow,
  type AssessmentRow,
  type ComponentScoreRow,
} from './assessment-rows.js';
import { insertRow, mutable, type RowValues } from './row-writer.js';

/**
 * Assessments, their lines, and the persisted working behind a score.
 *
 * **A submitted assessment's lines are frozen with it**, and the freeze is at the table: a trigger
 * on `performance_assessment_item` reads its parent's status and refuses any write once that parent
 * is submitted. So `upsertItem` here does not need a status check to be *safe* — the application
 * refuses it first for a readable message, and the database refuses it from every other path
 * including SQL nobody wrote in TypeScript.
 */

export class PostgresAssessmentRepository
  extends Repository<AssessmentRow & { version: number }>
  implements AssessmentStore
{
  public constructor() {
    super('performance_assessment');
  }

  public async byId(transaction: Transaction, id: string): Promise<AssessmentState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : assessmentState(row);
  }

  public async forReview(
    transaction: Transaction,
    reviewId: string,
  ): Promise<readonly AssessmentState[]> {
    const rows = await transaction.execute<AssessmentRow>(
      `select * from performance_assessment
         where tenant_id = $1 and review_id = $2 and deleted_at is null
         order by assessment_kind, assessor_employment_id`,
      [transaction.tenantId, reviewId],
    );

    return rows.map(assessmentState);
  }

  public async forAssessor(
    transaction: Transaction,
    reviewId: string,
    assessorEmploymentId: string,
    assessmentKind: string,
  ): Promise<AssessmentState | undefined> {
    const rows = await transaction.execute<AssessmentRow>(
      `select * from performance_assessment
         where tenant_id = $1 and review_id = $2 and assessor_employment_id = $3
           and assessment_kind = $4 and deleted_at is null`,
      [transaction.tenantId, reviewId, assessorEmploymentId, assessmentKind],
    );

    return rows[0] === undefined ? undefined : assessmentState(rows[0]);
  }

  public async itemsFor(
    transaction: Transaction,
    assessmentId: string,
  ): Promise<readonly AssessmentItemState[]> {
    const rows = await transaction.execute<AssessmentItemRow>(
      `select * from performance_assessment_item
         where tenant_id = $1 and assessment_id = $2 and deleted_at is null
         order by item_kind, id`,
      [transaction.tenantId, assessmentId],
    );

    return rows.map(assessmentItemState);
  }

  public insert(transaction: Transaction, state: AssessmentState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      assessmentValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: AssessmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.assessmentId,
      expected,
      mutable(assessmentValues(state, transaction.tenantId)),
    );
  }

  /**
   * One line, written or rewritten while its assessment is a draft.
   *
   * `on conflict (id)` rather than a read-then-branch: the application already decided whether this
   * is a new line or an amendment by looking for an existing one, and a second round trip to decide
   * it again is a gap two requests can slip through.
   */
  public async upsertItem(transaction: Transaction, item: AssessmentItemState): Promise<void> {
    const now = new Date();
    const values: RowValues = {
      ...assessmentItemValues(item, transaction.tenantId),
      ...auditForInsert(now),
    };
    const columns = Object.keys(values);
    const placeholders = columns.map((_, index) => `$${String(index + 1)}`).join(', ');
    // Every assignment reads from `excluded`, so no value is interpolated into the statement —
    // including the audit columns, which `auditForInsert` already placed in the parameter list.
    // `version` is excluded as well as the created-* columns. `auditForInsert` puts it in the
    // values map, and the `do update` clause below assigns it itself — leaving it in produced
    // "multiple assignments to same column", which is the same defect Phase 10 found on inserts and
    // which only the real database could catch here.
    const untouched = new Set(['created_at', 'created_by', 'version']);
    const updates = Object.keys(mutable(values))
      .filter((column) => !untouched.has(column))
      .map((column) => `${column} = excluded.${column}`)
      .concat('version = performance_assessment_item.version + 1')
      .join(', ');

    await transaction.execute(
      `insert into performance_assessment_item (${columns.join(', ')})
         values (${placeholders})
         on conflict (id) do update set ${updates}`,
      columns.map((column) => values[column]),
    );
  }
}

/**
 * The working behind a score: replaced as a set, never appended to.
 *
 * Rescoring supersedes the previous answer. Two rows for the same component would be two answers to
 * "what did the goals contribute", and a reader would have no way to tell which one the review's
 * `calculated_score` came from.
 *
 * A hard delete, not a soft one. These rows are a *derivation* rather than a record of something
 * that happened — the immutable record is the snapshot taken at completion, and keeping superseded
 * derivations would make the component table a history nobody reads and every query has to filter.
 */
export class PostgresComponentScoreRepository implements ComponentScoreStore {
  public async forReview(
    transaction: Transaction,
    reviewId: string,
  ): Promise<readonly ComponentScoreRecord[]> {
    const rows = await transaction.execute<ComponentScoreRow>(
      `select * from performance_review_component_score
         where tenant_id = $1 and review_id = $2 and deleted_at is null
         order by component`,
      [transaction.tenantId, reviewId],
    );

    return rows.map(componentScoreRecord);
  }

  public async replace(
    transaction: Transaction,
    reviewId: string,
    records: readonly ComponentScoreRecord[],
  ): Promise<void> {
    await transaction.execute(
      `delete from performance_review_component_score where tenant_id = $1 and review_id = $2`,
      [transaction.tenantId, reviewId],
    );

    const now = new Date();

    for (const record of records) {
      await insertRow(
        transaction,
        'performance_review_component_score',
        componentScoreValues(record, uuidV7(), transaction.tenantId),
        now,
      );
    }
  }
}
