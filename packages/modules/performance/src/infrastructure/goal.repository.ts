import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';
import type { GoalProgressState, GoalState } from '../domain/goal.js';
import type {
  GoalFilters,
  GoalProgressStore,
  GoalStore,
  Page,
  Paged,
} from '../application/performance-ports.js';
import {
  GOAL_COLUMNS,
  goalProgressState,
  goalColumns,
  goalProgressValues,
  goalState,
  goalValues,
  type GoalProgressRow,
  type GoalRow,
} from './review-rows.js';
import { boundClause } from './bound-clause.js';
import { insertRow, mutable, pageOf, predicateFor, type Filter } from './row-writer.js';

/**
 * Goals, cycles, reviews and reviewer assignments.
 *
 * **The authorization bound is a SQL predicate, not a filter applied afterwards.** A caller scoped
 * to a manager's reports gets `employment_id = any($n)` inside the query, so the rows that are not
 * theirs never leave the database. Filtering in TypeScript would mean they had, and the *count* of
 * what was then removed would itself be a disclosure — "your colleague has a review in this cycle"
 * is information.
 *
 * An empty bound is expressed as an empty array rather than as an absent clause. `= any('{}')` is
 * false for every row, which is what "this caller may see nothing" has to mean; omitting the clause
 * would silently mean "this caller may see everything".
 */

export class PostgresGoalRepository
  extends Repository<GoalRow & { version: number }>
  implements GoalStore
{
  public constructor() {
    super('performance_goal');
  }

  public async byId(transaction: Transaction, id: string): Promise<GoalState | undefined> {
    const rows = await transaction.execute<GoalRow>(
      `select ${GOAL_COLUMNS} from performance_goal
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : goalState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: GoalFilters,
    paged: Paged,
  ): Promise<Page<GoalState>> {
    const predicate = predicateFor('g', transaction.tenantId, goalFilters(filters));
    const parameters = [...predicate.parameters];
    const bound = boundClause(filters.employmentIdsIn, 'g.employment_id', parameters);
    const clause = bound === undefined ? predicate.clause : `${predicate.clause} and ${bound}`;
    const next = parameters.length + 1;

    return pageOf<GoalRow, GoalState>(
      transaction,
      {
        select: `select ${goalColumns('g')}
                   from performance_goal g
                   where ${clause}
                   order by g.due_date desc, g.id desc
                   limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*)::text as total from performance_goal g where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      goalState,
    );
  }

  public async forReview(
    transaction: Transaction,
    employmentId: string,
    cycleId: string,
  ): Promise<readonly GoalState[]> {
    const rows = await transaction.execute<GoalRow>(
      `select ${GOAL_COLUMNS} from performance_goal
         where tenant_id = $1 and employment_id = $2 and cycle_id = $3 and deleted_at is null
         order by due_date, id`,
      [transaction.tenantId, employmentId, cycleId],
    );

    return rows.map(goalState);
  }

  public insert(transaction: Transaction, state: GoalState): Promise<void> {
    return insertRow(transaction, this.table, goalValues(state, transaction.tenantId), new Date());
  }

  public async update(transaction: Transaction, state: GoalState, expected: number): Promise<void> {
    await this.updateRow(
      transaction,
      state.goalId,
      expected,
      mutable(goalValues(state, transaction.tenantId)),
    );
  }
}

const goalFilters = (filters: GoalFilters): readonly Filter[] => [
  { column: 'g.employment_id', value: filters.employmentId },
  { column: 'g.organization_unit_id', value: filters.organizationUnitId },
  { column: 'g.cycle_id', value: filters.cycleId },
  { column: 'g.status', value: filters.status },
  { column: 'g.scope', value: filters.scope },
  { column: 'g.parent_goal_id', value: filters.parentGoalId },
];

/**
 * Progress entries: insert and read, and nothing else.
 *
 * It does not extend `Repository`, which would bring `updateRow` and `softDeleteRow` with it.
 * Neither may exist here: what somebody reported in March is what a disputed rating is argued from
 * in December, and a trail whose entries can be edited is not a trail. A trigger refuses the same
 * operations at the table, from any path including SQL nobody wrote in TypeScript.
 */
export class PostgresGoalProgressRepository implements GoalProgressStore {
  public async forGoal(
    transaction: Transaction,
    goalId: string,
  ): Promise<readonly GoalProgressState[]> {
    const rows = await transaction.execute<GoalProgressRow>(
      `select * from performance_goal_progress
         where tenant_id = $1 and goal_id = $2 and deleted_at is null
         order by recorded_at desc, id desc`,
      [transaction.tenantId, goalId],
    );

    return rows.map(goalProgressState);
  }

  public insert(transaction: Transaction, state: GoalProgressState): Promise<void> {
    return insertRow(
      transaction,
      'performance_goal_progress',
      goalProgressValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
