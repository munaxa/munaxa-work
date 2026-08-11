import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { Application } from '../domain/application.js';
import { applicationEvent } from '../domain/application-event.js';
import type { ApplicationStatus } from '../domain/recruitment-vocabulary.js';
import type { Metadata } from '../domain/recruitment-aggregate.js';

import {
  conflicted,
  currentActor,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import { allocateNumber } from './recruitment-numbering.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Applications: the pipeline, and every movement through it.
 *
 * **One application per candidate per vacancy.** A candidate re-applying reopens the application
 * they already have; a second row would make every pipeline count wrong the first time somebody
 * tried again. Checked here so the caller gets a reason, and again by a unique index so two
 * simultaneous submissions cannot both win.
 *
 * **Every movement writes a history row in the same transaction as the status change.** Not
 * afterwards and not from an event handler: a history that could be written separately is a history
 * that will be missing for exactly the change somebody later disputes.
 */

export interface SubmitApplicationCommand extends Command {
  readonly commandName: 'recruitment.submit-application';
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly sourceCode: string;
  readonly appliedOn?: string;
  readonly metadata?: Metadata;
}

export interface ApplicationSubmitted {
  readonly applicationId: string;
  readonly applicationNumber: string;
  readonly reopened: boolean;
}

export const submitApplicationHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<SubmitApplicationCommand, ApplicationSubmitted> => ({
  commandName: 'recruitment.submit-application',
  permission: RecruitmentPermissions.applicationManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const candidate = await dependencies.stores.candidates.byId(transaction, command.candidateId);

      if (candidate === undefined) return notFound<ApplicationSubmitted>('candidate');

      const vacancy = await dependencies.stores.vacancies.byId(transaction, command.vacancyId);

      if (vacancy === undefined) return notFound<ApplicationSubmitted>('vacancy');
      // A draft posting is not open to anybody, and a closed one is closed. Recording an
      // application against either would put somebody in a pipeline nobody is running.
      if (vacancy.status !== 'published') return conflicted('vacancy_not_accepting_applications');

      const existing = await dependencies.stores.applications.byCandidateAndVacancy(
        transaction,
        command.candidateId,
        command.vacancyId,
      );

      if (existing !== undefined) {
        return reopen(transaction, dependencies, existing.id, command.appliedOn);
      }

      const now = dependencies.clock.now();
      const number = await allocateNumber(transaction, dependencies, 'application', 'APP', now);
      const application = Application.submit(
        {
          tenantId: currentTenant(),
          applicationNumber: number,
          candidateId: command.candidateId,
          vacancyId: command.vacancyId,
          sourceCode: command.sourceCode,
          appliedOn: command.appliedOn ?? now.toISOString().slice(0, 10),
          ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
        },
        originOfCurrentRequest(),
        now,
      );

      if (!application.ok) return refusedBy(application.error);

      await dependencies.stores.applications.insert(transaction, application.value.snapshot());
      transaction.collect(application.value.pullEvents());
      await recordMovement(transaction, dependencies, {
        applicationId: application.value.id,
        toStatus: 'received',
      });

      return success({
        applicationId: application.value.id,
        applicationNumber: number,
        reopened: false,
      });
    }),
});

/**
 * Reopens an application the candidate already had for this vacancy.
 *
 * Refused unless it had actually concluded: re-submitting a live application is a duplicate
 * submission, and answering it with "reopened" would tell the caller something happened that did
 * not.
 */
const reopen = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  applicationId: string,
  appliedOn: string | undefined,
): Promise<Result<ApplicationSubmitted, HandlerFailure>> => {
  const state = await dependencies.stores.applications.byId(transaction, applicationId);

  if (state === undefined) return notFound<ApplicationSubmitted>('application');
  if (state.status !== 'rejected' && state.status !== 'withdrawn') {
    return conflicted('application_already_open');
  }

  const application = Application.rehydrate(state);
  const now = dependencies.clock.now();
  const moved = application.moveTo('received', undefined, originOfCurrentRequest(), now);

  if (!moved.ok) return refusedBy(moved.error);

  await dependencies.stores.applications.update(transaction, application.snapshot(), state.version);
  transaction.collect(application.pullEvents());
  await recordMovement(transaction, dependencies, {
    applicationId,
    fromStatus: state.status,
    toStatus: 'received',
    ...(appliedOn === undefined ? {} : { note: `Re-applied on ${appliedOn}` }),
  });

  return success({
    applicationId,
    applicationNumber: state.applicationNumber,
    reopened: true,
  });
};

/**
 * Appends one row to the pipeline history.
 *
 * Shared by every movement, including the submission itself, so an application's history begins at
 * the moment it began rather than at the first change somebody happened to make afterwards. The
 * actor comes from the authenticated context, never from the command.
 */
export const recordMovement = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  entry: {
    readonly applicationId: string;
    readonly fromStatus?: ApplicationStatus;
    readonly toStatus: ApplicationStatus;
    readonly stageCode?: string;
    readonly reasonCode?: string;
    readonly note?: string;
  },
): Promise<void> => {
  const now = dependencies.clock.now();

  await dependencies.stores.applicationEvents.insert(
    transaction,
    applicationEvent(
      {
        tenantId: currentTenant(),
        ...entry,
        occurredAt: now,
        recordedBy: currentActor(),
      },
      now,
    ),
  );
};

export interface ApplicationAffected {
  readonly applicationId: string;
  readonly status: ApplicationStatus;
}

export interface MoveApplicationCommand extends Command {
  readonly commandName: 'recruitment.move-application';
  readonly applicationId: string;
  readonly status: Exclude<ApplicationStatus, 'rejected' | 'hired'>;
  readonly stageCode?: string;
  readonly note?: string;
  readonly expectedVersion: number;
}

export const moveApplicationHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<MoveApplicationCommand, ApplicationAffected> => ({
  commandName: 'recruitment.move-application',
  permission: RecruitmentPermissions.applicationManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.applications.byId(transaction, command.applicationId);

      if (state === undefined) return notFound<ApplicationAffected>('application');

      const application = Application.rehydrate(state);
      const moved = application.moveTo(
        command.status,
        command.stageCode,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!moved.ok) return refusedBy(moved.error);

      await dependencies.stores.applications.update(
        transaction,
        application.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(application.pullEvents());
      await recordMovement(transaction, dependencies, {
        applicationId: application.id,
        fromStatus: state.status,
        toStatus: command.status,
        ...(command.stageCode === undefined ? {} : { stageCode: command.stageCode }),
        ...(command.note === undefined ? {} : { note: command.note }),
      });
      return success({ applicationId: application.id, status: application.status });
    }),
});
