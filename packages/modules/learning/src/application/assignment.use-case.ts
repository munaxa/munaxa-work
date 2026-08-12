import {
  success,
  uuidV7,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import {
  assign,
  cancelAssignment,
  waiveAssignment,
  type AssignmentState,
} from '../domain/assignment.js';
import { currentActor, notFound, refuseWith, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Asking somebody to learn something, and the three ways it ends.
 *
 * **A duplicate is converged, not refused.** Assigning the same course to the same person twice
 * returns the assignment that already exists rather than creating a second identical item on their
 * queue or failing a retry that was only a retry. The decision is the database's — a partial unique
 * index over the open assignments — and not a read-then-write check, which two callers pressing the
 * button at the same moment would both pass.
 *
 * **Waiving needs a reason and a name.** It is the one act here that excuses somebody from a
 * compliance obligation, and it is the one an auditor asks about a year later. It takes its own
 * permission, refuses an empty reason, and refuses `system:auto-approval` for the seventh time in
 * this product.
 */

export interface AssignLearningCommand extends Command {
  readonly commandName: 'learning.assign';
  readonly employmentId: string;
  readonly courseId: string;
  readonly pathId?: string;
  readonly dueOn?: string;
}

export interface AssignmentIdentified {
  readonly assignmentId: string;
  /** False where an equivalent open assignment already existed. The retry-safe answer. */
  readonly created: boolean;
}

export const assignLearningHandler = (
  dependencies: LearningDependencies,
): CommandHandler<AssignLearningCommand, AssignmentIdentified> => ({
  commandName: 'learning.assign',
  permission: LearningPermissions.assignmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const subject = await confirmSubject(dependencies, command.employmentId);

      if (subject !== undefined) return refuseWith<AssignmentIdentified>(subject);

      const course = await dependencies.stores.courses.byId(transaction, command.courseId);

      if (course === undefined) return notFound<AssignmentIdentified>('learning_course');
      if (course.status !== 'published') {
        return refuseWith<AssignmentIdentified>('assignment-course-not-published');
      }
      if (command.pathId !== undefined) {
        const path = await dependencies.stores.paths.byId(transaction, command.pathId);

        if (path === undefined) return notFound<AssignmentIdentified>('learning_path');
      }

      const created = assign({
        assignmentId: uuidV7(),
        source: command.pathId === undefined ? 'direct' : 'learning_path',
        at: dependencies.clock.now(),
        by: currentActor(),
        ...command,
      });

      if (!created.ok) return refusedBy<AssignmentIdentified>(created.error);

      return placeOnQueue(dependencies, transaction, created.value);
    }),
});

/**
 * Writes the assignment unless an equivalent open one is already there, and says which happened.
 *
 * The conflict is resolved by the index rather than by a prior read, so two callers racing converge
 * on one row instead of both seeing "nothing there" and both writing. The loser reads back the row
 * the winner committed, which is why the identifier returned is the same either way.
 */
const placeOnQueue = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  state: AssignmentState,
): Promise<Result<AssignmentIdentified, HandlerFailure>> => {
  const written = await dependencies.stores.assignments.insertIfAbsent(transaction, state);

  if (written) {
    await dependencies.notifications.intend({
      templateKey: 'learning.assignment.created',
      recipients: [state.employmentId],
      variables: { courseId: state.courseId, dueOn: state.dueOn ?? '' },
    });
    return success({ assignmentId: state.assignmentId, created: true });
  }

  const existing = await dependencies.stores.assignments.openFor(
    transaction,
    state.employmentId,
    state.courseId,
  );

  return success({
    assignmentId: existing?.assignmentId ?? state.assignmentId,
    created: false,
  });
};

/** That the employment exists and is employed, as Employment reports it. */
const confirmSubject = async (
  dependencies: LearningDependencies,
  employmentId: string,
): Promise<string | undefined> => {
  const facts = await dependencies.employment.factsFor(employmentId, dependencies.clock.now());

  if (facts === undefined) return 'assignment-employment-unknown';
  return facts.active ? undefined : 'assignment-employment-inactive';
};

export interface WaiveAssignmentCommand extends Command {
  readonly commandName: 'learning.waive-assignment';
  readonly assignmentId: string;
  readonly expectedVersion: number;
  readonly reason: string;
}

export interface AssignmentClosed {
  readonly assignmentId: string;
  readonly status: string;
}

export const waiveAssignmentHandler = (
  dependencies: LearningDependencies,
): CommandHandler<WaiveAssignmentCommand, AssignmentClosed> => ({
  commandName: 'learning.waive-assignment',
  // Its own permission. Excusing somebody from safety training is not implied by being able to ask
  // them to do it.
  permission: LearningPermissions.assignmentWaive,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.assignments.byId(transaction, command.assignmentId);

      if (held === undefined) return notFound<AssignmentClosed>('learning_assignment');

      const waived = waiveAssignment(
        held,
        dependencies.clock.now(),
        currentActor(),
        command.reason,
      );

      if (!waived.ok) return refusedBy<AssignmentClosed>(waived.error);

      await dependencies.stores.assignments.update(
        transaction,
        waived.value,
        command.expectedVersion,
      );
      return success({ assignmentId: held.assignmentId, status: waived.value.status });
    }),
});

export interface CancelAssignmentCommand extends Command {
  readonly commandName: 'learning.cancel-assignment';
  readonly assignmentId: string;
  readonly expectedVersion: number;
}

/** Withdrawing the request itself — the rule was retired, or it never applied to this person. */
export const cancelAssignmentHandler = (
  dependencies: LearningDependencies,
): CommandHandler<CancelAssignmentCommand, AssignmentClosed> => ({
  commandName: 'learning.cancel-assignment',
  permission: LearningPermissions.assignmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.assignments.byId(transaction, command.assignmentId);

      if (held === undefined) return notFound<AssignmentClosed>('learning_assignment');

      const cancelled = cancelAssignment(held, dependencies.clock.now(), currentActor());

      if (!cancelled.ok) return refusedBy<AssignmentClosed>(cancelled.error);

      await dependencies.stores.assignments.update(
        transaction,
        cancelled.value,
        command.expectedVersion,
      );
      return success({ assignmentId: held.assignmentId, status: cancelled.value.status });
    }),
});
