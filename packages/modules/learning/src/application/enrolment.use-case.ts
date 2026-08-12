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
  completeEnrolment,
  enrol,
  startEnrolment,
  type EnrolmentState,
} from '../domain/enrolment.js';
import { hasPassedRequiredAssessments } from '../domain/assessment.js';
import { satisfyAssignment } from '../domain/assignment.js';
import { currentActor, notFound, refuseWith, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Enrolling, starting, and the four ways a course ends.
 *
 * **Every transition is its own command.** There is no `set-enrolment-status`: a caller who could
 * name a status could complete a course nobody sat, and the lifecycle would be a suggestion. Each
 * command asks the aggregate, and the aggregate refuses what the transition table forbids.
 *
 * **Enrolling pins the course version.** That is what makes a completion still describe what was
 * actually completed after somebody rewrites the syllabus, and it is why no snapshot is needed here
 * — the version row is already immutable.
 *
 * **A second open enrolment converges rather than duplicating.** The partial unique index decides,
 * so a retried request returns the enrolment that exists instead of putting the same person on the
 * same course twice.
 */

export interface EnrolCommand extends Command {
  readonly commandName: 'learning.enrol';
  readonly employmentId: string;
  readonly courseId: string;
  readonly assignmentId?: string;
}

export interface EnrolmentIdentified {
  readonly enrolmentId: string;
  /** False where an open enrolment already existed. The retry-safe answer. */
  readonly created: boolean;
}

export const enrolHandler = (
  dependencies: LearningDependencies,
): CommandHandler<EnrolCommand, EnrolmentIdentified> => ({
  commandName: 'learning.enrol',
  permission: LearningPermissions.enrolmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const facts = await dependencies.employment.factsFor(
        command.employmentId,
        dependencies.clock.now(),
      );

      if (facts === undefined)
        return refuseWith<EnrolmentIdentified>('enrolment-employment-unknown');
      if (!facts.active) return refuseWith<EnrolmentIdentified>('enrolment-employment-inactive');

      const course = await dependencies.stores.courses.byId(transaction, command.courseId);

      if (course === undefined) return notFound<EnrolmentIdentified>('learning_course');
      // `isEnrollable` is the domain's answer and it is not re-derived here: a published course
      // with no current version would accept an enrolment pinned to nothing.
      if (course.status !== 'published' || course.currentVersionId === undefined) {
        return refuseWith<EnrolmentIdentified>('enrolment-course-not-enrollable');
      }

      const created = enrol({
        enrolmentId: uuidV7(),
        employmentId: command.employmentId,
        courseId: course.courseId,
        courseVersionId: course.currentVersionId,
        at: dependencies.clock.now(),
        by: currentActor(),
        ...(command.assignmentId === undefined ? {} : { assignmentId: command.assignmentId }),
      });

      if (!created.ok) return refusedBy<EnrolmentIdentified>(created.error);

      return placeOnCourse(dependencies, transaction, created.value);
    }),
});

/**
 * Writes the enrolment unless an open one is already there, and says which happened.
 *
 * The conflict is resolved by the partial unique index rather than by a prior read, so two callers
 * racing converge on one row instead of both seeing "nothing there" and both writing. The loser
 * reads back the row the winner committed, which is why the identifier returned is the same either
 * way — a retried request is answered, not duplicated.
 */
const placeOnCourse = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  state: EnrolmentState,
): Promise<Result<EnrolmentIdentified, HandlerFailure>> => {
  const written = await dependencies.stores.enrolments.insertIfAbsent(transaction, state);

  if (written) return success({ enrolmentId: state.enrolmentId, created: true });

  const open = await dependencies.stores.enrolments.search(
    transaction,
    { employmentId: state.employmentId, courseId: state.courseId, status: 'enrolled' },
    { limit: 1, offset: 0 },
  );

  return success({
    enrolmentId: open.items[0]?.enrolmentId ?? state.enrolmentId,
    created: false,
  });
};

export interface StartEnrolmentCommand extends Command {
  readonly commandName: 'learning.start-enrolment';
  readonly enrolmentId: string;
  readonly expectedVersion: number;
}

export interface EnrolmentMoved {
  readonly enrolmentId: string;
  readonly status: string;
}

export const startEnrolmentHandler = (
  dependencies: LearningDependencies,
): CommandHandler<StartEnrolmentCommand, EnrolmentMoved> => ({
  commandName: 'learning.start-enrolment',
  permission: LearningPermissions.enrolmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.enrolments.byId(transaction, command.enrolmentId);

      if (held === undefined) return notFound<EnrolmentMoved>('learning_enrolment');

      const started = startEnrolment(held, dependencies.clock.now());

      if (!started.ok) return refusedBy<EnrolmentMoved>(started.error);

      await dependencies.stores.enrolments.update(
        transaction,
        started.value,
        command.expectedVersion,
      );
      return success({ enrolmentId: held.enrolmentId, status: started.value.status });
    }),
});

export interface CompleteEnrolmentCommand extends Command {
  readonly commandName: 'learning.complete-enrolment';
  readonly enrolmentId: string;
  readonly expectedVersion: number;
  /** The civil day they finished. Stated by the caller, never taken from the clock. */
  readonly completedOn: string;
  readonly outcomeNote?: string;
}

/**
 * Recording that somebody finished — the statement a certification is issued from.
 *
 * **The assessment requirement is the tenant's, and it binds.** Where the pinned course version says
 * an assessment is required, completion needs a passed outcome for every required assessment on that
 * version. That check is a **presence test over recorded outcomes** — it adds nothing up, weights
 * nothing and compares nothing to a threshold, because the specification defines none of those.
 *
 * **Completion satisfies the assignment it came from.** Doing the course and clearing the
 * requirement are one act, and leaving the assignment open would keep somebody on an overdue list
 * for training they had just done.
 */
export const completeEnrolmentHandler = (
  dependencies: LearningDependencies,
): CommandHandler<CompleteEnrolmentCommand, EnrolmentMoved> => ({
  commandName: 'learning.complete-enrolment',
  // Its own permission: recording that somebody finished is evidence, not administration.
  permission: LearningPermissions.enrolmentComplete,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.enrolments.byId(transaction, command.enrolmentId);

      if (held === undefined) return notFound<EnrolmentMoved>('learning_enrolment');

      const version = await dependencies.stores.versions.byId(transaction, held.courseVersionId);

      if (version === undefined) return notFound<EnrolmentMoved>('learning_course_version');

      const passed = await hasPassedRequired(dependencies, transaction, held);
      const completed = completeEnrolment(held, {
        at: dependencies.clock.now(),
        on: command.completedOn,
        by: currentActor(),
        requiresAssessment: version.requiresAssessment,
        hasPassedAssessment: passed,
        ...(command.outcomeNote === undefined ? {} : { outcomeNote: command.outcomeNote }),
      });

      if (!completed.ok) return refusedBy<EnrolmentMoved>(completed.error);

      await dependencies.stores.enrolments.update(
        transaction,
        completed.value,
        command.expectedVersion,
      );
      await satisfyOriginatingAssignment(dependencies, transaction, completed.value);
      return success({ enrolmentId: held.enrolmentId, status: completed.value.status });
    }),
});

type Enrolment = EnrolmentState;

/** Whether every required assessment on the pinned version has a passing outcome recorded. */
const hasPassedRequired = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  enrolment: Enrolment,
): Promise<boolean> => {
  const defined = await dependencies.stores.assessments.forVersion(
    transaction,
    enrolment.courseVersionId,
  );
  const required = defined.filter((item) => item.required);

  if (required.length === 0) return false;

  const results = await dependencies.stores.results.forEnrolment(
    transaction,
    enrolment.enrolmentId,
  );

  return hasPassedRequiredAssessments(required, results);
};

/**
 * Closes the assignment this enrolment came from, where it came from one.
 *
 * A refusal here is not an error: an assignment already waived or cancelled is terminal, and the
 * completion still stands. What must not happen is the completion being rolled back because a
 * requirement somebody had already excused could not be closed twice.
 */
const satisfyOriginatingAssignment = async (
  dependencies: LearningDependencies,
  transaction: Transaction,
  enrolment: Enrolment,
): Promise<void> => {
  if (enrolment.assignmentId === undefined) return;

  const held = await dependencies.stores.assignments.byId(transaction, enrolment.assignmentId);

  if (held === undefined || held.status !== 'assigned') return;

  const satisfied = satisfyAssignment(held, {
    at: dependencies.clock.now(),
    enrolmentId: enrolment.enrolmentId,
  });

  if (satisfied.ok) {
    await dependencies.stores.assignments.update(transaction, satisfied.value, held.version);
  }
};
