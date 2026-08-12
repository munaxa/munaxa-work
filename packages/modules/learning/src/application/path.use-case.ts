import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { addStep, archivePath, createPath, publishPath } from '../domain/path.js';
import type { LocalizedName } from '../domain/learning-rejection.js';
import type { PathKind } from '../domain/learning-vocabulary.js';
import { conflicted, currentActor, notFound, refuseWith, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Learning paths: courses a tenant grouped together, in the order it intends them.
 *
 * **A path recommends; it never certifies** (AD-002). Completing every course in a leadership path
 * says somebody attended those courses. Nothing here writes a capability to People, and no command
 * turns a finished path into a claim about what anybody can do.
 *
 * **`sequence` is an order, not a gate.** Nothing refuses an enrolment because an earlier step is
 * unfinished: prerequisites were never specified, and enforcing an unspecified one would block real
 * people from real training on a rule nobody wrote.
 */

export interface CreatePathCommand extends Command {
  readonly commandName: 'learning.create-path';
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: PathKind;
}

export interface PathIdentified {
  readonly pathId: string;
}

export const createPathHandler = (
  dependencies: LearningDependencies,
): CommandHandler<CreatePathCommand, PathIdentified> => ({
  commandName: 'learning.create-path',
  permission: LearningPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const taken = await dependencies.stores.paths.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted<PathIdentified>('path_code_taken');

      const created = createPath({ pathId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<PathIdentified>(created.error);

      await dependencies.stores.paths.insert(transaction, created.value);
      return success({ pathId: created.value.pathId });
    }),
});

export interface AddPathStepCommand extends Command {
  readonly commandName: 'learning.add-path-step';
  readonly pathId: string;
  readonly courseId: string;
  readonly sequence: number;
  readonly optional: boolean;
}

export interface PathStepIdentified {
  readonly stepId: string;
}

/**
 * Putting a course in a path, at a position.
 *
 * The course is confirmed to exist and not to be archived: a path step pointing at an archived
 * course would put something unenrollable on somebody's queue, and they would have no way to
 * satisfy it.
 */
export const addPathStepHandler = (
  dependencies: LearningDependencies,
): CommandHandler<AddPathStepCommand, PathStepIdentified> => ({
  commandName: 'learning.add-path-step',
  permission: LearningPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, command.pathId);

      if (path === undefined) return notFound<PathStepIdentified>('learning_path');
      if (path.status === 'archived') return refuseWith<PathStepIdentified>('path-archived');

      const course = await dependencies.stores.courses.byId(transaction, command.courseId);

      if (course === undefined) return notFound<PathStepIdentified>('learning_course');
      if (course.status === 'archived') return refuseWith<PathStepIdentified>('course-archived');

      const existing = await dependencies.stores.paths.stepsFor(transaction, path.pathId);

      if (existing.some((step) => step.courseId === command.courseId)) {
        return conflicted<PathStepIdentified>('path_step_course_taken');
      }
      if (existing.some((step) => step.sequence === command.sequence)) {
        return conflicted<PathStepIdentified>('path_step_sequence_taken');
      }

      const added = addStep({ stepId: uuidV7(), ...command });

      if (!added.ok) return refusedBy<PathStepIdentified>(added.error);

      await dependencies.stores.paths.insertStep(transaction, added.value);
      return success({ stepId: added.value.stepId });
    }),
});

export interface RemovePathStepCommand extends Command {
  readonly commandName: 'learning.remove-path-step';
  readonly pathId: string;
  readonly stepId: string;
}

/**
 * Taking a course back out of a path.
 *
 * It changes what the path asks for from now on and leaves every assignment already generated from
 * it alone: what somebody was asked to do in March is a historical fact, and rewriting it would
 * destroy the trail this module exists to keep.
 */
export const removePathStepHandler = (
  dependencies: LearningDependencies,
): CommandHandler<RemovePathStepCommand, PathIdentified> => ({
  commandName: 'learning.remove-path-step',
  permission: LearningPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, command.pathId);

      if (path === undefined) return notFound<PathIdentified>('learning_path');

      const steps = await dependencies.stores.paths.stepsFor(transaction, path.pathId);

      if (!steps.some((step) => step.stepId === command.stepId)) {
        return notFound<PathIdentified>('learning_path_step');
      }

      await dependencies.stores.paths.removeStep(
        transaction,
        command.stepId,
        dependencies.clock.now(),
        currentActor(),
      );
      return success({ pathId: path.pathId });
    }),
});

export interface PublishPathCommand extends Command {
  readonly commandName: 'learning.publish-path';
  readonly pathId: string;
  readonly expectedVersion: number;
}

/** A path with nothing in it publishes nothing: anybody could satisfy it by doing nothing at all. */
export const publishPathHandler = (
  dependencies: LearningDependencies,
): CommandHandler<PublishPathCommand, PathIdentified> => ({
  commandName: 'learning.publish-path',
  permission: LearningPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, command.pathId);

      if (path === undefined) return notFound<PathIdentified>('learning_path');

      const steps = await dependencies.stores.paths.stepsFor(transaction, path.pathId);
      const published = publishPath(path, steps.length);

      if (!published.ok) return refusedBy<PathIdentified>(published.error);

      await dependencies.stores.paths.update(transaction, published.value, command.expectedVersion);
      return success({ pathId: path.pathId });
    }),
});

export interface ArchivePathCommand extends Command {
  readonly commandName: 'learning.archive-path';
  readonly pathId: string;
  readonly expectedVersion: number;
}

export const archivePathHandler = (
  dependencies: LearningDependencies,
): CommandHandler<ArchivePathCommand, PathIdentified> => ({
  commandName: 'learning.archive-path',
  permission: LearningPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, command.pathId);

      if (path === undefined) return notFound<PathIdentified>('learning_path');

      const archived = archivePath(path, dependencies.clock.now(), currentActor());

      if (!archived.ok) return refusedBy<PathIdentified>(archived.error);

      await dependencies.stores.paths.update(transaction, archived.value, command.expectedVersion);
      return success({ pathId: path.pathId });
    }),
});
