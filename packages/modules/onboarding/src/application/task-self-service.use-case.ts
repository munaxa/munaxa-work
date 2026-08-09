import { success, type Command, type CommandHandler } from '@work/kernel';

import { Task } from '../domain/task.js';

import {
  conflicted,
  currentActor,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './onboarding-context.js';
import { record, unblockDependents } from './task-history.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import type { TaskAffected } from './task.use-case.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/** The self-service completion path, for Phase 18. Same rules, narrower permission. */
export interface CompleteOwnTaskCommand extends Command {
  readonly commandName: 'onboarding.complete-own-task';
  readonly taskId: string;
  readonly employmentId: string;
  readonly note?: string;
  readonly documentReference?: string;
  readonly expectedVersion: number;
}

/**
 * Completing a task that belongs to the caller.
 *
 * The contract Employee Self-Service will consume (Phase 18), designed now so the permission it
 * grants every employee can never close somebody else's task: this refuses unless the task's owner
 * resolves to the employment named — and the API resolves that employment from the authenticated
 * member rather than from the body.
 */
export const completeOwnTaskHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<CompleteOwnTaskCommand, TaskAffected> => ({
  commandName: 'onboarding.complete-own-task',
  permission: OnboardingPermissions.taskCompleteOwn,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.tasks.byId(transaction, command.taskId);

      if (state === undefined) return notFound<TaskAffected>('task');

      const task = Task.rehydrate(state);

      if (!task.isOwnedBy(command.employmentId)) return conflicted('task_belongs_to_somebody_else');

      const completed = task.complete(
        {
          completedBy: currentActor(),
          ...(command.note === undefined ? {} : { note: command.note }),
          ...(command.documentReference === undefined
            ? {}
            : { documentReference: command.documentReference }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!completed.ok) return refusedBy(completed.error);

      await dependencies.stores.tasks.update(transaction, task.snapshot(), command.expectedVersion);
      transaction.collect(task.pullEvents());
      await record(transaction, dependencies, task, {
        kind: 'completed',
        fromStatus: state.status,
      });
      await unblockDependents(transaction, dependencies, task.id);
      return success({ taskId: task.id, onboardingId: task.onboardingId, status: task.status });
    }),
});
