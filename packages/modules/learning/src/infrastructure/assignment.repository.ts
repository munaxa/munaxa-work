import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { AssignmentState } from '../domain/assignment.js';
import type {
  AssignmentFilters,
  AssignmentStore,
  Page,
  Paged,
} from '../application/learning-ports.js';
import {
  assignmentColumns,
  assignmentState,
  assignmentValues,
  type AssignmentRow,
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
 * Assignments — the queue, and the index that keeps it from filling with duplicates.
 *
 * **`insertIfAbsent` is where ADR-0071's idempotency guarantee actually lives.**
 * `insert ... on conflict do nothing returning id` lets the *database* decide, against two partial
 * unique indexes: one over the rule occurrence, one over the open assignments for a person and a
 * course. A `select` followed by an `insert` would be two statements with a gap between them, and
 * the gap is exactly where two administrators pressing the same button both find nothing and both
 * write.
 *
 * **The authorization bound is a SQL predicate, not a filter applied afterwards.** A caller scoped
 * to a set of employments gets `employment_id = any($n)` inside the query, so the rows that are not
 * theirs never leave the database. Filtering in TypeScript would mean they had, and the *count* of
 * what was then removed would itself be a disclosure.
 *
 * **There is no `overdue` column and nothing here computes one.** Overdue-ness is a function of
 * `due_on` and today, derived on read by the application. The queue is asked for with
 * `due_on <= $n`, which is an indexed predicate over a date and correct at every instant.
 */

export class PostgresAssignmentRepository
  extends Repository<AssignmentRow & { version: number }>
  implements AssignmentStore
{
  public constructor() {
    super('learning_assignment');
  }

  public async byId(transaction: Transaction, id: string): Promise<AssignmentState | undefined> {
    const rows = await transaction.execute<AssignmentRow>(
      `select ${assignmentColumns('a')} from learning_assignment a
         where a.id = $1 and a.tenant_id = $2 and a.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : assignmentState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: AssignmentFilters,
    paged: Paged,
  ): Promise<Page<AssignmentState>> {
    const predicate = predicateFor('a', transaction.tenantId, assignmentFilters(filters));
    const parameters = [...predicate.parameters];
    const bound = boundClause(filters.employmentIdsIn, 'a.employment_id', parameters);
    const clause = bound === undefined ? predicate.clause : `${predicate.clause} and ${bound}`;
    const next = parameters.length + 1;

    return pageOf<AssignmentRow, AssignmentState>(
      transaction,
      {
        select: `select ${assignmentColumns('a')} from learning_assignment a
                   where ${clause}
                   order by a.due_on nulls last, a.id
                   limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*)::text as total from learning_assignment a where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      assignmentState,
    );
  }

  public async openFor(
    transaction: Transaction,
    employmentId: string,
    courseId: string,
  ): Promise<AssignmentState | undefined> {
    const rows = await transaction.execute<AssignmentRow>(
      `select ${assignmentColumns('a')} from learning_assignment a
         where a.tenant_id = $1 and a.employment_id = $2 and a.course_id = $3
           and a.status = 'assigned' and a.deleted_at is null`,
      [transaction.tenantId, employmentId, courseId],
    );

    return rows[0] === undefined ? undefined : assignmentState(rows[0]);
  }

  /**
   * Writes the row unless an index refuses it, and says which happened.
   *
   * The conflict target is deliberately unnamed: two partial unique indexes can refuse this row —
   * the occurrence one and the open-assignment one — and naming either would make the other raise
   * an error instead of converging. Which one refused is not information the caller needs; that a
   * row already covers this obligation is.
   */
  public insertIfAbsent(transaction: Transaction, state: AssignmentState): Promise<boolean> {
    return insertRowIfAbsent(
      transaction,
      this.table,
      assignmentValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: AssignmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.assignmentId,
      expected,
      mutable(assignmentValues(state, transaction.tenantId)),
    );
  }
}

const assignmentFilters = (filters: AssignmentFilters): readonly Filter[] => [
  { column: 'a.employment_id', value: filters.employmentId },
  { column: 'a.course_id', value: filters.courseId },
  { column: 'a.status', value: filters.status },
  { column: 'a.mandatory_rule_id', value: filters.mandatoryRuleId },
  { column: 'a.due_on', value: filters.dueOnOrBefore, operator: '<=' },
];
