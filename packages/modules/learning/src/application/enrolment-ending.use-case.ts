import { success, type Command, type CommandHandler } from '@work/kernel';

import { failEnrolment, withdrawEnrolment } from '../domain/enrolment.js';
import { currentActor, notFound, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';
import type { EnrolmentMoved } from './enrolment.use-case.js';

/**
 * The two ways a course ends badly, as two commands rather than one with a flag.
 *
 * They mean different things — "did not pass it" and "left the course" — and a compliance report that
 * could not tell them apart would describe two very different people identically. Both are terminal:
 * the domain refuses any further move, and a trigger refuses it again.
 */

export interface EndEnrolmentCommand extends Command {
  readonly commandName: 'learning.fail-enrolment' | 'learning.withdraw-enrolment';
  readonly enrolmentId: string;
  readonly expectedVersion: number;
  readonly note?: string;
}

/**
 * Failing and withdrawing, as two commands rather than one with a flag.
 *
 * They mean different things — "did not pass it" and "left the course" — and a compliance report
 * that could not tell them apart would describe two very different people identically.
 */
const endingHandler = (
  dependencies: LearningDependencies,
  commandName: EndEnrolmentCommand['commandName'],
): CommandHandler<EndEnrolmentCommand, EnrolmentMoved> => ({
  commandName,
  permission: LearningPermissions.enrolmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.enrolments.byId(transaction, command.enrolmentId);

      if (held === undefined) return notFound<EnrolmentMoved>('learning_enrolment');

      const at = dependencies.clock.now();
      const ended =
        commandName === 'learning.fail-enrolment'
          ? failEnrolment(held, at, currentActor(), command.note)
          : withdrawEnrolment(held, at, command.note);

      if (!ended.ok) return refusedBy<EnrolmentMoved>(ended.error);

      await dependencies.stores.enrolments.update(
        transaction,
        ended.value,
        command.expectedVersion,
      );
      return success({ enrolmentId: held.enrolmentId, status: ended.value.status });
    }),
});

export const failEnrolmentHandler = (
  dependencies: LearningDependencies,
): CommandHandler<EndEnrolmentCommand, EnrolmentMoved> =>
  endingHandler(dependencies, 'learning.fail-enrolment');

export const withdrawEnrolmentHandler = (
  dependencies: LearningDependencies,
): CommandHandler<EndEnrolmentCommand, EnrolmentMoved> =>
  endingHandler(dependencies, 'learning.withdraw-enrolment');
