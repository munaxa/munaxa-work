import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { EnrolmentState } from '../domain/enrolment.js';
import type {
  EnrolmentFilters,
  EnrolmentStore,
  Page,
  Paged,
} from '../application/learning-ports.js';
import {
  enrolmentColumns,
  enrolmentState,
  enrolmentValues,
  type EnrolmentRow,
} from './learner-rows.js';
import {
  boundClause,
  insertRowIfAbsent,
  mutable,
  pageOf,
  predicateFor,
  type Filter,
} from './row-writer.js';

/**
 * Enrolments, and the two reads recurrence depends on.
 *
 * **`lastCompletionsOf` answers for a whole page in one statement.** A reconciliation that fetched
 * one completion per employment is the N+1 this repository forbids, and it is the easiest one in
 * this module to write by accident: the loop is already there, walking the audience. `distinct on`
 * gives the latest completion per person in a single indexed pass over
 * `learning_enrolment_completion_idx`.
 *
 * **A completed enrolment is frozen at the table.** `update` still exists here because a soft delete
 * of a row created in error must remain possible, and the trigger permits exactly that — it refuses
 * any change to the columns that say what happened.
 */

export class PostgresEnrolmentRepository
  extends Repository<EnrolmentRow & { version: number }>
  implements EnrolmentStore
{
  public constructor() {
    super('learning_enrolment');
  }

  public async byId(transaction: Transaction, id: string): Promise<EnrolmentState | undefined> {
    const rows = await transaction.execute<EnrolmentRow>(
      `select ${enrolmentColumns('e')} from learning_enrolment e
         where e.id = $1 and e.tenant_id = $2 and e.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : enrolmentState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: EnrolmentFilters,
    paged: Paged,
  ): Promise<Page<EnrolmentState>> {
    const predicate = predicateFor('e', transaction.tenantId, enrolmentFilters(filters));
    const parameters = [...predicate.parameters];
    const bound = boundClause(filters.employmentIdsIn, 'e.employment_id', parameters);
    const clause = bound === undefined ? predicate.clause : `${predicate.clause} and ${bound}`;
    const next = parameters.length + 1;

    return pageOf<EnrolmentRow, EnrolmentState>(
      transaction,
      {
        select: `select ${enrolmentColumns('e')} from learning_enrolment e
                   where ${clause}
                   order by e.enrolled_at desc, e.id desc
                   limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*)::text as total from learning_enrolment e where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      enrolmentState,
    );
  }

  public async lastCompletionOf(
    transaction: Transaction,
    employmentId: string,
    courseId: string,
  ): Promise<string | undefined> {
    const rows = await transaction.execute<{ completed_on: string }>(
      `select to_char(completed_on, 'YYYY-MM-DD') as completed_on from learning_enrolment
         where tenant_id = $1 and employment_id = $2 and course_id = $3
           and status = 'completed' and deleted_at is null
         order by completed_on desc
         limit 1`,
      [transaction.tenantId, employmentId, courseId],
    );

    return rows[0]?.completed_on;
  }

  /**
   * The latest completion of one course by each of a page of employments, in one statement.
   *
   * `distinct on (employment_id)` with a matching `order by` is PostgreSQL's cheapest "latest row
   * per group", and it walks the same partial index the single-employment read uses. An empty list
   * is answered without a query at all: `= any('{}')` would be a round trip to learn nothing.
   */
  public async lastCompletionsOf(
    transaction: Transaction,
    employmentIds: readonly string[],
    courseId: string,
  ): Promise<ReadonlyMap<string, string>> {
    if (employmentIds.length === 0) return new Map();

    const rows = await transaction.execute<{ employment_id: string; completed_on: string }>(
      `select distinct on (employment_id)
              employment_id, to_char(completed_on, 'YYYY-MM-DD') as completed_on
         from learning_enrolment
        where tenant_id = $1 and course_id = $2 and status = 'completed'
          and deleted_at is null and employment_id = any($3::uuid[])
        order by employment_id, completed_on desc`,
      [transaction.tenantId, courseId, [...employmentIds]],
    );

    return new Map(rows.map((row) => [row.employment_id, row.completed_on] as const));
  }

  /**
   * Writes the enrolment unless the open-enrolment index refuses it.
   *
   * The index covers only `enrolled` and `in_progress`, so a retake after a failure or a withdrawal
   * is a new row rather than a conflict — which is what taking a course again has to mean.
   */
  public insertIfAbsent(transaction: Transaction, state: EnrolmentState): Promise<boolean> {
    return insertRowIfAbsent(
      transaction,
      this.table,
      enrolmentValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: EnrolmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.enrolmentId,
      expected,
      mutable(enrolmentValues(state, transaction.tenantId)),
    );
  }
}

const enrolmentFilters = (filters: EnrolmentFilters): readonly Filter[] => [
  { column: 'e.employment_id', value: filters.employmentId },
  { column: 'e.course_id', value: filters.courseId },
  { column: 'e.status', value: filters.status },
];
