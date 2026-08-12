import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { deactivateInstructor, registerInstructor } from '../domain/instructor.js';
import type { LocalizedName } from '../domain/learning-rejection.js';
import { notFound, refuseWith, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Who teaches — an identity, and only an identity (D-6).
 *
 * **No fake Person is created for a visiting trainer.** An external instructor is a Learning-owned
 * record; manufacturing a `person` row for somebody who is not an employee would put a non-employee
 * into headcount reports, org charts, document queues and every other place People and Employment
 * legitimately look.
 *
 * **An internal instructor is an employment reference and nothing else** — no copied name, no title,
 * no department. A copied name goes stale the day somebody marries, and the copy would silently
 * become the version screens showed.
 *
 * **Nothing here schedules anybody.** There is no availability, no calendar, no booking and no rate.
 * Sessions are Phase 14B; this answers "who delivered that" and "who may we call".
 */

export interface RegisterInstructorCommand extends Command {
  readonly commandName: 'learning.register-instructor';
  readonly employmentId?: string;
  readonly externalName?: LocalizedName;
  readonly externalOrganization?: string;
  readonly externalContact?: string;
}

export interface InstructorIdentified {
  readonly instructorId: string;
}

export const registerInstructorHandler = (
  dependencies: LearningDependencies,
): CommandHandler<RegisterInstructorCommand, InstructorIdentified> => ({
  commandName: 'learning.register-instructor',
  permission: LearningPermissions.instructorManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (command.employmentId !== undefined) {
        const facts = await dependencies.employment.factsFor(
          command.employmentId,
          dependencies.clock.now(),
        );

        if (facts === undefined) {
          return refuseWith<InstructorIdentified>('instructor-employment-unknown');
        }
      }

      const registered = registerInstructor({ instructorId: uuidV7(), ...command });

      if (!registered.ok) return refusedBy<InstructorIdentified>(registered.error);

      await dependencies.stores.instructors.insert(transaction, registered.value);
      return success({ instructorId: registered.value.instructorId });
    }),
});

export interface DeactivateInstructorCommand extends Command {
  readonly commandName: 'learning.deactivate-instructor';
  readonly instructorId: string;
  readonly expectedVersion: number;
}

/** Not deletion: a course delivered in 2023 was delivered by somebody, and it stays explainable. */
export const deactivateInstructorHandler = (
  dependencies: LearningDependencies,
): CommandHandler<DeactivateInstructorCommand, InstructorIdentified> => ({
  commandName: 'learning.deactivate-instructor',
  permission: LearningPermissions.instructorManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.instructors.byId(transaction, command.instructorId);

      if (held === undefined) return notFound<InstructorIdentified>('learning_instructor');

      const inactive = deactivateInstructor(held);

      if (!inactive.ok) return refusedBy<InstructorIdentified>(inactive.error);

      await dependencies.stores.instructors.update(
        transaction,
        inactive.value,
        command.expectedVersion,
      );
      return success({ instructorId: held.instructorId });
    }),
});
