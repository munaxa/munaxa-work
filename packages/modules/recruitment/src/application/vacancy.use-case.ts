import { success, type Command, type CommandHandler } from '@work/kernel';

import { Vacancy } from '../domain/vacancy.js';
import { isRequisitionOpen } from '../domain/recruitment-vocabulary.js';
import type { Metadata } from '../domain/recruitment-aggregate.js';

import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Vacancies: the openings that accept applications.
 *
 * **A vacancy cannot exist without an approved requisition.** That check is what makes "approval
 * authorises hiring" a rule the system enforces rather than a sentence in a policy document — and it
 * is the one thing a recruiter under pressure would most like to skip.
 *
 * **Publishing is separately permissioned** from editing, because it is the moment a posting becomes
 * externally visible.
 */

export interface OpenVacancyCommand extends Command {
  readonly commandName: 'recruitment.open-vacancy';
  readonly requisitionId: string;
  readonly title: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly channels?: readonly string[];
  readonly openedOn?: string;
  readonly closesOn?: string;
  readonly metadata?: Metadata;
}

export interface VacancyAffected {
  readonly vacancyId: string;
  readonly status: string;
}

export const openVacancyHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<OpenVacancyCommand, VacancyAffected> => ({
  commandName: 'recruitment.open-vacancy',
  permission: RecruitmentPermissions.vacancyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const requisition = await dependencies.stores.requisitions.byId(
        transaction,
        command.requisitionId,
      );

      if (requisition === undefined) return notFound<VacancyAffected>('requisition');
      // The control, enforced: recruiting against an unapproved requisition is hiring nobody
      // authorized.
      if (!isRequisitionOpen(requisition.status)) {
        return conflicted('requisition_not_approved');
      }

      const vacancy = Vacancy.open(
        { tenantId: currentTenant(), ...command },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!vacancy.ok) return refusedBy(vacancy.error);

      await dependencies.stores.vacancies.insert(transaction, vacancy.value.snapshot());
      transaction.collect(vacancy.value.pullEvents());
      return success({ vacancyId: vacancy.value.id, status: vacancy.value.status });
    }),
});

export interface PublishVacancyCommand extends Command {
  readonly commandName: 'recruitment.publish-vacancy';
  readonly vacancyId: string;
  readonly channels?: readonly string[];
  readonly openedOn?: string;
  readonly expectedVersion: number;
}

export const publishVacancyHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<PublishVacancyCommand, VacancyAffected> => ({
  commandName: 'recruitment.publish-vacancy',
  permission: RecruitmentPermissions.vacancyPublish,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.vacancies.byId(transaction, command.vacancyId);

      if (state === undefined) return notFound<VacancyAffected>('vacancy');

      const requisition = await dependencies.stores.requisitions.byId(
        transaction,
        state.requisitionId,
      );

      // Checked again at publication: a requisition cancelled between opening and publishing must
      // not produce an advertisement nobody authorized.
      if (requisition === undefined || !isRequisitionOpen(requisition.status)) {
        return conflicted('requisition_not_approved');
      }

      const vacancy = Vacancy.rehydrate(state);
      const published = vacancy.publish(
        command.channels,
        command.openedOn,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!published.ok) return refusedBy(published.error);

      await dependencies.stores.vacancies.update(
        transaction,
        vacancy.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(vacancy.pullEvents());
      return success({ vacancyId: vacancy.id, status: vacancy.status });
    }),
});

export interface CloseVacancyCommand extends Command {
  readonly commandName: 'recruitment.close-vacancy';
  readonly vacancyId: string;
  readonly reasonCode?: string;
  readonly expectedVersion: number;
}

export const closeVacancyHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<CloseVacancyCommand, VacancyAffected> => ({
  commandName: 'recruitment.close-vacancy',
  permission: RecruitmentPermissions.vacancyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.vacancies.byId(transaction, command.vacancyId);

      if (state === undefined) return notFound<VacancyAffected>('vacancy');

      const vacancy = Vacancy.rehydrate(state);
      const closed = vacancy.close(
        command.reasonCode,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!closed.ok) return refusedBy(closed.error);

      await dependencies.stores.vacancies.update(
        transaction,
        vacancy.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(vacancy.pullEvents());
      return success({ vacancyId: vacancy.id, status: vacancy.status });
    }),
});
