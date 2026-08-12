import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  archiveCourse,
  createCourse,
  publishCourse,
  publishVersion,
  type CourseState,
} from '../domain/course.js';
import { defineAssessment } from '../domain/assessment.js';
import type { LocalizedName } from '../domain/learning-rejection.js';
import type { AssessmentKind, CourseDelivery } from '../domain/learning-vocabulary.js';
import { conflicted, currentActor, notFound, refuseWith, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * The catalogue: a course, the versions that say what it teaches, and the assessments a version
 * asks for.
 *
 * **Publishing a course means publishing a version of it.** There is no command that flips a status
 * without content behind it — `learning.publish-course-version` writes the version and moves the
 * course in one transaction, because a published course with nothing to teach would accept
 * enrolments that reference nothing, and the check constraint refuses it anyway.
 *
 * **A version is written once and never edited.** The store offers no update, the trigger refuses
 * one, and correcting a course publishes version 4 rather than rewriting version 3 (AD-004). That is
 * what makes a completed enrolment still describe what was actually completed.
 *
 * **`requiresAssessment` is the tenant's configuration and this product invents nothing behind it.**
 * It says an assessment outcome is needed before completion. It does not say what passing means,
 * because the specification defines no threshold, no weighting and no rounding.
 */

export interface CreateCourseCommand extends Command {
  readonly commandName: 'learning.create-course';
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly categoryId?: string;
  readonly delivery: CourseDelivery;
}

export interface CourseIdentified {
  readonly courseId: string;
}

export const createCourseHandler = (
  dependencies: LearningDependencies,
): CommandHandler<CreateCourseCommand, CourseIdentified> => ({
  commandName: 'learning.create-course',
  permission: LearningPermissions.catalogueManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const taken = await dependencies.stores.courses.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted<CourseIdentified>('course_code_taken');

      if (command.categoryId !== undefined) {
        const category = await dependencies.stores.categories.byId(transaction, command.categoryId);

        if (category === undefined) return refuseWith<CourseIdentified>('course-category-unknown');
      }

      const created = createCourse({ courseId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<CourseIdentified>(created.error);

      await dependencies.stores.courses.insert(transaction, created.value);
      return success({ courseId: created.value.courseId });
    }),
});

export interface UpdateCourseCommand extends Command {
  readonly commandName: 'learning.update-course';
  readonly courseId: string;
  readonly expectedVersion: number;
  readonly name?: LocalizedName;
  readonly description?: LocalizedName;
  readonly categoryId?: string;
}

/**
 * Editing a course's own description — never its content, and never its lifecycle.
 *
 * What a course *teaches* is versioned and unreachable from here. `code` and `delivery` are not
 * editable either: the code is what a tenant's own records refer to, and a delivery mode changing
 * under an enrolment would misdescribe a course somebody already sat.
 */
export const updateCourseHandler = (
  dependencies: LearningDependencies,
): CommandHandler<UpdateCourseCommand, CourseIdentified> => ({
  commandName: 'learning.update-course',
  permission: LearningPermissions.catalogueManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.courses.byId(transaction, command.courseId);

      if (held === undefined) return notFound<CourseIdentified>('learning_course');
      if (held.status === 'archived') return refuseWith<CourseIdentified>('course-archived');

      const amended: CourseState = {
        ...held,
        ...(command.name === undefined ? {} : { name: command.name }),
        ...(command.description === undefined ? {} : { description: command.description }),
        ...(command.categoryId === undefined ? {} : { categoryId: command.categoryId }),
      };

      await dependencies.stores.courses.update(transaction, amended, command.expectedVersion);
      return success({ courseId: held.courseId });
    }),
});

export interface PublishCourseVersionCommand extends Command {
  readonly commandName: 'learning.publish-course-version';
  readonly courseId: string;
  readonly expectedVersion: number;
  readonly title: LocalizedName;
  readonly objectives?: LocalizedName;
  readonly contentReference?: string;
  readonly durationMinutes?: number;
  readonly requiresAssessment: boolean;
  readonly certificationValidMonths?: number;
}

export interface CourseVersionIdentified {
  readonly courseVersionId: string;
  readonly versionNumber: number;
}

/**
 * Publishing the next version, and making it the one a new enrolment pins.
 *
 * The version number is derived from what is already there rather than supplied: a caller-supplied
 * number would let two administrators publish "version 4" twice, and the unique index would refuse
 * the second with an error nobody could act on. The optimistic version on the course is what
 * actually settles the race — the loser is told the course moved and reads it again.
 */
export const publishCourseVersionHandler = (
  dependencies: LearningDependencies,
): CommandHandler<PublishCourseVersionCommand, CourseVersionIdentified> => ({
  commandName: 'learning.publish-course-version',
  permission: LearningPermissions.catalogueManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.courses.byId(transaction, command.courseId);

      if (held === undefined) return notFound<CourseVersionIdentified>('learning_course');

      const versionNumber =
        (await dependencies.stores.versions.highestVersionNumber(transaction, held.courseId)) + 1;
      const published = publishVersion({
        ...command,
        courseVersionId: uuidV7(),
        courseId: held.courseId,
        versionNumber,
        publishedAt: dependencies.clock.now(),
        publishedBy: currentActor(),
      });

      if (!published.ok) return refusedBy<CourseVersionIdentified>(published.error);

      const moved = publishCourse(held, published.value.courseVersionId, versionNumber);

      if (!moved.ok) return refusedBy<CourseVersionIdentified>(moved.error);

      await dependencies.stores.versions.insert(transaction, published.value);
      await dependencies.stores.courses.update(transaction, moved.value, command.expectedVersion);
      return success({
        courseVersionId: published.value.courseVersionId,
        versionNumber,
      });
    }),
});

export interface ArchiveCourseCommand extends Command {
  readonly commandName: 'learning.archive-course';
  readonly courseId: string;
  readonly expectedVersion: number;
}

/** Archival is terminal, and it is not deletion: a certification issued in 2023 stays explainable. */
export const archiveCourseHandler = (
  dependencies: LearningDependencies,
): CommandHandler<ArchiveCourseCommand, CourseIdentified> => ({
  commandName: 'learning.archive-course',
  permission: LearningPermissions.catalogueManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.courses.byId(transaction, command.courseId);

      if (held === undefined) return notFound<CourseIdentified>('learning_course');

      const archived = archiveCourse(held, dependencies.clock.now(), currentActor());

      if (!archived.ok) return refusedBy<CourseIdentified>(archived.error);

      await dependencies.stores.courses.update(
        transaction,
        archived.value,
        command.expectedVersion,
      );
      return success({ courseId: held.courseId });
    }),
});

export interface DefineAssessmentCommand extends Command {
  readonly commandName: 'learning.define-assessment';
  readonly courseVersionId: string;
  readonly title: LocalizedName;
  readonly kind: AssessmentKind;
  readonly required: boolean;
}

export interface AssessmentIdentified {
  readonly assessmentId: string;
}

/**
 * What a course version asks somebody to demonstrate.
 *
 * A kind, a title, and whether an outcome is required before completion. **No pass mark, no weight,
 * no attempt limit** — the specification names five kinds and defines none of those, and inventing
 * one would be deciding who passes mandatory safety training on a rule nobody wrote.
 */
export const defineAssessmentHandler = (
  dependencies: LearningDependencies,
): CommandHandler<DefineAssessmentCommand, AssessmentIdentified> => ({
  commandName: 'learning.define-assessment',
  permission: LearningPermissions.catalogueManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const version = await dependencies.stores.versions.byId(transaction, command.courseVersionId);

      if (version === undefined) {
        return notFound<AssessmentIdentified>('learning_course_version');
      }

      const defined = defineAssessment({ assessmentId: uuidV7(), ...command });

      if (!defined.ok) return refusedBy<AssessmentIdentified>(defined.error);

      await dependencies.stores.assessments.insert(transaction, defined.value);
      return success({ assessmentId: defined.value.assessmentId });
    }),
});

export interface CreateCategoryCommand extends Command {
  readonly commandName: 'learning.create-course-category';
  readonly code: string;
  readonly name: LocalizedName;
}

export interface CategoryIdentified {
  readonly categoryId: string;
}

/** A tenant's own filing. No rule in this product reads it (AD-003). */
export const createCategoryHandler = (
  dependencies: LearningDependencies,
): CommandHandler<CreateCategoryCommand, CategoryIdentified> => ({
  commandName: 'learning.create-course-category',
  permission: LearningPermissions.catalogueManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const taken = await dependencies.stores.categories.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted<CategoryIdentified>('course_category_code_taken');

      const state = {
        categoryId: uuidV7(),
        code: command.code,
        name: command.name,
        version: 1,
      };

      await dependencies.stores.categories.insert(transaction, state);
      return success({ categoryId: state.categoryId });
    }),
});
