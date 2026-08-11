import type { Transaction } from '@work/kernel';

import type { TaskEventState } from '../domain/task-event.js';
import type { TaskEventStore } from '../application/onboarding-ports.js';

import {
  TASK_EVENT_COLUMNS,
  taskEventInsert,
  toTaskEvent,
  type TaskEventRow,
} from './onboarding-rows.js';
import { insertRow } from './row-writer.js';

/**
 * A task's history: appended, read, and nothing else.
 *
 * It does not extend `Repository`, and that is the point rather than an omission. The base class
 * offers `updateRow`, `softDeleteRow` and `restoreRow`; a history that can be amended is not
 * history, and the cheapest way to guarantee nobody amends it is to have no method that could.
 *
 * Rows are ordered by `occurred_at` and then by `id`. The identifiers are UUIDv7 and therefore
 * time-ordered, so two movements recorded in the same transaction — a reassignment and the
 * completion that followed it — read back in the order they happened rather than in whatever order
 * the planner returned them.
 */
export class TaskEventRepository implements TaskEventStore {
  public async forTask(
    transaction: Transaction,
    taskId: string,
  ): Promise<readonly TaskEventState[]> {
    const rows = await transaction.execute<TaskEventRow>(
      `select ${TASK_EVENT_COLUMNS} from onboarding_task_event e
        where e.tenant_id = $1 and e.task_id = $2 and e.deleted_at is null
        order by e.occurred_at, e.id`,
      [transaction.tenantId, taskId],
    );
    return rows.map(toTaskEvent);
  }

  public async forOnboarding(
    transaction: Transaction,
    onboardingId: string,
  ): Promise<readonly TaskEventState[]> {
    const rows = await transaction.execute<TaskEventRow>(
      `select ${TASK_EVENT_COLUMNS} from onboarding_task_event e
        where e.tenant_id = $1 and e.onboarding_id = $2 and e.deleted_at is null
        order by e.occurred_at, e.id`,
      [transaction.tenantId, onboardingId],
    );
    return rows.map(toTaskEvent);
  }

  public async insert(transaction: Transaction, state: TaskEventState): Promise<void> {
    await insertRow(transaction, 'onboarding_task_event', taskEventInsert(state), new Date());
  }
}
