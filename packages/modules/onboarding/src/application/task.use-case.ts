import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { Task } from '../domain/task.js';
import type { OwnerKind, TaskStatus } from '../domain/onboarding-vocabulary.js';

import {
  conflicted,
  currentActor,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './onboarding-context.js';
import { record, unblockDependents } from './task-history.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Completing, waiving, reassigning and rescheduling the tasks of a running onboarding.
 *
 * **Every movement writes a history row in the same transaction as the change.** Not afterwards and
 * not from an event handler: a history that could be written separately is the history that will be
 * missing for exactly the task somebody later disputes — and on an onboarding the disputed one is
 * usually the deadline that moved.
 *
 * **Completing a task unblocks what waited on it**, in the same transaction, so a screen never shows
 * a blocked task whose predecessor is done.
 */

export interface TaskAffected {
  readonly taskId: string;
  readonly onboardingId: string;
  readonly status: TaskStatus;
}

export interface CompleteTaskCommand extends Command {
  readonly commandName: 'onboarding.complete-task';
  readonly taskId: string;
  readonly note?: string;
  /** Required for a `document` task: a reference into the document store, never a file. */
  readonly documentReference?: string;
  readonly expectedVersion: number;
}

export const completeTaskHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<CompleteTaskCommand, TaskAffected> => ({
  commandName: 'onboarding.complete-task',
  permission: OnboardingPermissions.taskComplete,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.tasks.byId(transaction, command.taskId);

      if (state === undefined) return notFound<TaskAffected>('task');

      const running = await onboardingIsLive(transaction, dependencies, state.onboardingId);

      if (!running) return conflicted('onboarding_concluded');

      const now = dependencies.clock.now();
      const task = Task.rehydrate(state);
      const completed = task.complete(
        {
          completedBy: currentActor(),
          ...(command.note === undefined ? {} : { note: command.note }),
          ...(command.documentReference === undefined
            ? {}
            : { documentReference: command.documentReference }),
        },
        originOfCurrentRequest(),
        now,
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

export interface WaiveTaskCommand extends Command {
  readonly commandName: 'onboarding.waive-task';
  readonly taskId: string;
  readonly reasonCode: string;
  readonly expectedVersion: number;
}

/**
 * Waiving: somebody with the authority decided the task does not apply, and said why.
 *
 * Its own permission, because "we did it" and "it did not apply to this person" are different
 * answers — and a required task waived without anybody authorized to waive it is how a completion
 * record stops meaning anything.
 */
export const waiveTaskHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<WaiveTaskCommand, TaskAffected> => ({
  commandName: 'onboarding.waive-task',
  permission: OnboardingPermissions.taskWaive,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.tasks.byId(transaction, command.taskId);

      if (state === undefined) return notFound<TaskAffected>('task');

      const task = Task.rehydrate(state);
      const waived = task.waive(
        { reasonCode: command.reasonCode, waivedBy: currentActor() },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!waived.ok) return refusedBy(waived.error);

      await dependencies.stores.tasks.update(transaction, task.snapshot(), command.expectedVersion);
      await record(transaction, dependencies, task, { kind: 'waived', fromStatus: state.status });
      await unblockDependents(transaction, dependencies, task.id);
      return success({ taskId: task.id, onboardingId: task.onboardingId, status: task.status });
    }),
});

export interface ReassignTaskCommand extends Command {
  readonly commandName: 'onboarding.reassign-task';
  readonly taskId: string;
  readonly ownerKind: OwnerKind;
  readonly ownerRef?: string;
  readonly ownerRole?: string;
  readonly expectedVersion: number;
}

export const reassignTaskHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<ReassignTaskCommand, TaskAffected> => ({
  commandName: 'onboarding.reassign-task',
  permission: OnboardingPermissions.taskReassign,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.tasks.byId(transaction, command.taskId);

      if (state === undefined) return notFound<TaskAffected>('task');

      // A named employment must be real in this tenant. The check runs under a bounded grant, so
      // reassigning a task does not make somebody a reader of the employment register (ADR-0043).
      if (command.ownerKind === 'employment' && command.ownerRef !== undefined) {
        const employment = await dependencies.employment.find(command.ownerRef);

        if (employment === undefined) return notFound<TaskAffected>('employment');
      }

      const task = Task.rehydrate(state);
      const reassigned = task.reassign(command, originOfCurrentRequest(), dependencies.clock.now());

      if (!reassigned.ok) return refusedBy(reassigned.error);

      await dependencies.stores.tasks.update(transaction, task.snapshot(), command.expectedVersion);
      transaction.collect(task.pullEvents());
      await record(transaction, dependencies, task, {
        kind: 'assigned',
        fromStatus: state.status,
        detail: `${state.ownerKind} → ${command.ownerKind}`,
      });
      return success({ taskId: task.id, onboardingId: task.onboardingId, status: task.status });
    }),
});

export interface RescheduleTaskCommand extends Command {
  readonly commandName: 'onboarding.reschedule-task';
  readonly taskId: string;
  readonly dueOn?: string;
  readonly expectedVersion: number;
}

/** Moving a deadline is audited, because a date that quietly moved is a deadline nobody missed. */
export const rescheduleTaskHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<RescheduleTaskCommand, TaskAffected> => ({
  commandName: 'onboarding.reschedule-task',
  permission: OnboardingPermissions.taskManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.tasks.byId(transaction, command.taskId);

      if (state === undefined) return notFound<TaskAffected>('task');

      const task = Task.rehydrate(state);
      const rescheduled = task.reschedule(command.dueOn, dependencies.clock.now());

      if (!rescheduled.ok) return refusedBy(rescheduled.error);

      await dependencies.stores.tasks.update(transaction, task.snapshot(), command.expectedVersion);
      await record(transaction, dependencies, task, {
        kind: 'rescheduled',
        fromStatus: state.status,
        detail: `${state.dueOn ?? '—'} → ${command.dueOn ?? '—'}`,
      });
      return success({ taskId: task.id, onboardingId: task.onboardingId, status: task.status });
    }),
});

/** An onboarding that has concluded takes no more task movements. */
const onboardingIsLive = async (
  transaction: Transaction,
  dependencies: OnboardingDependencies,
  onboardingId: string,
): Promise<boolean> => {
  const state = await dependencies.stores.onboardings.byId(transaction, onboardingId);

  return state !== undefined && state.state !== 'completed' && state.state !== 'cancelled';
};
