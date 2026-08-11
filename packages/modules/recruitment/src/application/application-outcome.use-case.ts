import { success, type Command, type CommandHandler } from '@work/kernel';

import { Application } from '../domain/application.js';
import type { ScreeningOutcome } from '../domain/recruitment-vocabulary.js';

import { notFound, originOfCurrentRequest, refusedBy } from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import { recordMovement, type ApplicationAffected } from './application.use-case.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * How an application concludes: a screening result, a rejection with a reason, or a withdrawal.
 *
 * Apart from the pipeline movements because those are one decision — where in the funnel somebody is
 * — and these are another: what was concluded about them, and why. The file budget forced the split;
 * the seam was already there.
 */

export interface RecordScreeningCommand extends Command {
  readonly commandName: 'recruitment.record-screening';
  readonly applicationId: string;
  readonly outcome: ScreeningOutcome;
  readonly note?: string;
  readonly expectedVersion: number;
}

/**
 * Records a screening result.
 *
 * A result, not a status: `on_hold` leaves the application in `screening`, and a recruiter who
 * screens somebody out still has to reject them explicitly with a reason. Conflating the two would
 * let a candidate leave the pipeline with no recorded decision.
 */
export const recordScreeningHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<RecordScreeningCommand, ApplicationAffected> => ({
  commandName: 'recruitment.record-screening',
  permission: RecruitmentPermissions.applicationManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.applications.byId(transaction, command.applicationId);

      if (state === undefined) return notFound<ApplicationAffected>('application');

      const application = Application.rehydrate(state);
      const recorded = application.recordScreening(
        command.outcome,
        command.note,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!recorded.ok) return refusedBy(recorded.error);

      await dependencies.stores.applications.update(
        transaction,
        application.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(application.pullEvents());
      return success({ applicationId: application.id, status: application.status });
    }),
});

export interface CloseApplicationCommand extends Command {
  readonly commandName: 'recruitment.close-application';
  readonly applicationId: string;
  /** A rejection needs a reason; a withdrawal is the candidate's own act and needs none. */
  readonly outcome: 'rejected' | 'withdrawn';
  readonly reasonCode?: string;
  readonly note?: string;
  readonly expectedVersion: number;
}

export const closeApplicationHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<CloseApplicationCommand, ApplicationAffected> => ({
  commandName: 'recruitment.close-application',
  permission: RecruitmentPermissions.applicationManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.applications.byId(transaction, command.applicationId);

      if (state === undefined) return notFound<ApplicationAffected>('application');

      const application = Application.rehydrate(state);
      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();
      const closed =
        command.outcome === 'withdrawn'
          ? application.withdraw(origin, now)
          : application.reject(command.reasonCode ?? '', command.note, origin, now);

      if (!closed.ok) return refusedBy(closed.error);

      await dependencies.stores.applications.update(
        transaction,
        application.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(application.pullEvents());
      await recordMovement(transaction, dependencies, {
        applicationId: application.id,
        fromStatus: state.status,
        toStatus: command.outcome,
        ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
        ...(command.note === undefined ? {} : { note: command.note }),
      });
      return success({ applicationId: application.id, status: application.status });
    }),
});
