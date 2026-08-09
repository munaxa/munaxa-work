import type { Transaction } from '@work/kernel';

import { Task } from '../domain/task.js';
import { taskEvent } from '../domain/task-event.js';
import type { TaskEventKind, TaskStatus } from '../domain/onboarding-vocabulary.js';

import { currentActor, currentTenant, originOfCurrentRequest } from './onboarding-context.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * The two things every task movement does besides changing the task: it records what happened, and
 * it releases whatever was waiting.
 *
 * Shared by the ordinary completion path and by the self-service one, in a file of their own, so the
 * two can never drift. A history written by one path and not the other is a history that is missing
 * for exactly the task somebody later disputes.
 */

/** One movement, as the history records it. */
export interface Movement {
  readonly kind: TaskEventKind;
  readonly fromStatus: TaskStatus;
  /** What changed — the two owners, the two dates. Never why somebody is on a checklist. */
  readonly detail?: string;
}

/**
 * Appends one row to the task's history.
 *
 * The actor comes from the authenticated context — never from the command. A completion a caller
 * could attribute to a colleague is not evidence that anybody did the safety briefing.
 */
export const record = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  task: Task,
  movement: Movement,
): Promise<void> => {
  const now = dependencies.clock.now();
  const { kind, fromStatus, detail } = movement;

  await dependencies.stores.taskEvents.insert(
    transaction,
    taskEvent(
      {
        tenantId: currentTenant(),
        taskId: task.id,
        onboardingId: task.onboardingId,
        kind,
        fromStatus,
        toStatus: task.status,
        ...(detail === undefined ? {} : { detail }),
        occurredAt: now,
        recordedBy: currentActor(),
      },
      now,
    ),
  );
};

/** What waited on this task is now actionable. In the same transaction, so no screen lags behind. */
export const unblockDependents = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  taskId: string,
): Promise<void> => {
  const dependents = await dependencies.stores.tasks.dependents(transaction, taskId);
  const now = dependencies.clock.now();

  for (const state of dependents) {
    const dependent = Task.rehydrate(state);

    if (dependent.status !== 'blocked') continue;
    if (!dependent.unblock(originOfCurrentRequest(), now).ok) continue;

    await dependencies.stores.tasks.update(transaction, dependent.snapshot(), state.version);
  }
};

