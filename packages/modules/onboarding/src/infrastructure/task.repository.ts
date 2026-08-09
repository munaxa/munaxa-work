import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { TaskState } from '../domain/task-definition.js';
import type { Page, TaskQuery, TaskStore, TaskTally } from '../application/onboarding-ports.js';

import { TASK_COLUMNS, taskInsert, taskUpdate, toTask, type TaskRow } from './onboarding-rows.js';
import { taskFilters } from './onboarding-search.js';
import { tallyOf } from './task-tally.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * Tasks, in PostgreSQL.
 *
 * **Progress is counted in the database, never in the application.** `tally` is two aggregate
 * queries; loading sixty rows to count five numbers is the read a dashboard makes a hundred times
 * and the reason a list screen times out at a customer with a busy January.
 *
 * **Overdue is computed, not stored.** Every predicate that mentions it compares `due_on` to a civil
 * date the caller supplies. There is no flag, no sweeper and therefore no window in which the flag
 * is wrong.
 */
export class TaskRepository extends Repository<{ id: string; version: number }> implements TaskStore {
  public constructor() {
    super('onboarding_task');
  }

  public async byId(transaction: Transaction, id: string): Promise<TaskState | undefined> {
    const rows = await transaction.execute<TaskRow>(
      `select ${TASK_COLUMNS} from onboarding_task k
        where k.id = $1 and k.tenant_id = $2 and k.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toTask(row);
  }

  public async forOnboarding(
    transaction: Transaction,
    onboardingId: string,
  ): Promise<readonly TaskState[]> {
    const rows = await transaction.execute<TaskRow>(
      `select ${TASK_COLUMNS} from onboarding_task k
        where k.tenant_id = $1 and k.onboarding_id = $2 and k.deleted_at is null
        order by k.sequence, k.id`,
      [transaction.tenantId, onboardingId],
    );
    return rows.map(toTask);
  }

  /** One query for a page of onboardings rather than one per onboarding — the N+1, refused. */
  public async forOnboardings(
    transaction: Transaction,
    onboardingIds: readonly string[],
  ): Promise<readonly TaskState[]> {
    if (onboardingIds.length === 0) return [];

    const rows = await transaction.execute<TaskRow>(
      `select ${TASK_COLUMNS} from onboarding_task k
        where k.tenant_id = $1 and k.onboarding_id = any($2::uuid[]) and k.deleted_at is null
        order by k.onboarding_id, k.sequence`,
      [transaction.tenantId, [...onboardingIds]],
    );
    return rows.map(toTask);
  }

  /** What waited on this task. Read inside the completing transaction, so nothing lags behind. */
  public async dependents(
    transaction: Transaction,
    taskId: string,
  ): Promise<readonly TaskState[]> {
    const rows = await transaction.execute<TaskRow>(
      `select ${TASK_COLUMNS} from onboarding_task k
        where k.tenant_id = $1 and k.depends_on_task_id = $2 and k.deleted_at is null
        order by k.sequence`,
      [transaction.tenantId, taskId],
    );
    return rows.map(toTask);
  }

  public search(transaction: Transaction, query: TaskQuery): Promise<Page<TaskState>> {
    const { where, parameters } = taskFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<TaskRow, TaskState>(
      transaction,
      {
        select: `select ${TASK_COLUMNS} from onboarding_task k where ${where}
                 order by k.due_on nulls last, k.sequence, k.id limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from onboarding_task k where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toTask,
    );
  }

  public tally(
    transaction: Transaction,
    onboardingId: string,
    asOf: string,
  ): Promise<TaskTally> {
    return tallyOf(transaction, onboardingId, asOf);
  }

  public async all(transaction: Transaction): Promise<readonly TaskState[]> {
    const rows = await transaction.execute<TaskRow>(
      `select ${TASK_COLUMNS} from onboarding_task k
        where k.tenant_id = $1 and k.deleted_at is null order by k.onboarding_id, k.sequence`,
      [transaction.tenantId],
    );
    return rows.map(toTask);
  }

  public async insert(transaction: Transaction, state: TaskState): Promise<void> {
    await insertRow(transaction, this.table, taskInsert(state), new Date());
  }

  public async update(transaction: Transaction, state: TaskState, expected: number): Promise<void> {
    await this.updateRow(transaction, state.id, expected, taskUpdate(state));
  }
}
