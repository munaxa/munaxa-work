import { success, type Command, type CommandHandler } from '@work/kernel';

import { originOfCurrentRequest, refusedBy } from './recruitment-context.js';
import { RecruitmentPermissions } from './recruitment-permissions.js';
import { withRequisition, type RequisitionAffected } from './requisition.use-case.js';
import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * The two ends of a requisition's life after it has been decided: opening it for recruiting, and
 * closing or cancelling it.
 *
 * Apart from the decision commands because they answer a different question — approval is *whether*
 * to hire, and these are *when* the recruiting starts and stops. Approval and recruiting are often
 * weeks apart, and the permissions differ.
 */

export interface CloseRequisitionCommand extends Command {
  readonly commandName: 'recruitment.close-requisition';
  readonly requisitionId: string;
  readonly reasonCode?: string;
  readonly cancel?: boolean;
  readonly expectedVersion: number;
}

export const closeRequisitionHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<CloseRequisitionCommand, RequisitionAffected> => ({
  commandName: 'recruitment.close-requisition',
  permission: RecruitmentPermissions.requisitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) =>
      withRequisition(transaction, dependencies, command, (requisition, now) => {
        const origin = originOfCurrentRequest();
        const closed =
          command.cancel === true
            ? requisition.cancel(origin, now)
            : requisition.close(command.reasonCode, origin, now);

        return closed.ok ? success(undefined) : refusedBy(closed.error);
      }),
    ),
});

export interface OpenRequisitionCommand extends Command {
  readonly commandName: 'recruitment.open-requisition';
  readonly requisitionId: string;
  readonly expectedVersion: number;
}

/** Opening for recruiting. Approval and recruiting are different acts, often weeks apart. */
export const openRequisitionHandler = (
  dependencies: RecruitmentDependencies,
): CommandHandler<OpenRequisitionCommand, RequisitionAffected> => ({
  commandName: 'recruitment.open-requisition',
  permission: RecruitmentPermissions.requisitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) =>
      withRequisition(transaction, dependencies, command, (requisition, now) => {
        const opened = requisition.open(originOfCurrentRequest(), now);

        return opened.ok ? success(undefined) : refusedBy(opened.error);
      }),
    ),
});
