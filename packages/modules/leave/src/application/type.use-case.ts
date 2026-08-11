import { success, type Command, type CommandHandler } from '@work/kernel';

import { LeaveType, type DefineLeaveType } from '../domain/leave-type.js';
import { conflicted, currentActor, currentTenant, notFound, refusedBy } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type { LeaveDependencies } from './leave-dependencies.js';
import type { BilingualInput, Metadata } from '../domain/leave-aggregate.js';

/**
 * Configuring the kinds of leave a tenant offers.
 *
 * **Nothing is seeded and nothing is suggested.** There is no bootstrap that creates annual leave,
 * no migration that inserts sick leave, and no default a tenant has to delete. A tenant that has
 * configured no leave types has no leave types, and the screen says so.
 *
 * Publication is a **separate command behind a separate permission**, because a published type is
 * what every policy, entitlement and request in the tenant references by identity — and because the
 * person drafting a new type should not be the person who makes it binding without anyone else
 * looking.
 */

export interface DefineLeaveTypeCommand extends Command {
  readonly commandName: 'leave.define-type';
  readonly code: string;
  readonly name: BilingualInput;
  readonly unit: string;
  readonly paidTreatmentCode: string;
  readonly accrues?: boolean;
  readonly requiresAttachment?: boolean;
  readonly requiresReplacement?: boolean;
  readonly requiresContact?: boolean;
  readonly requiresAddress?: boolean;
  readonly genderRestriction?: string;
  readonly statutorySourceCode?: string;
  readonly versionNumber?: number;
  readonly metadata?: Metadata;
}

export interface LeaveTypeDefined {
  readonly leaveTypeId: string;
}

export const defineLeaveTypeHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<DefineLeaveTypeCommand, LeaveTypeDefined> => ({
  commandName: 'leave.define-type',
  permission: LeavePermissions.policyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const request: DefineLeaveType = { ...command, tenantId: currentTenant() };
      const drafted = LeaveType.define(request, dependencies.clock.now());

      if (!drafted.ok) return refusedBy<LeaveTypeDefined>(drafted.error);

      const state = drafted.value.snapshot();
      const existing = await dependencies.stores.types.byCode(transaction, state.code);

      // Checked before the insert so the caller gets a business conflict rather than a unique
      // violation; the index is still what guarantees it under concurrency.
      if (existing !== undefined && existing.versionNumber === state.versionNumber) {
        return conflicted<LeaveTypeDefined>('leave.rejection.leave_type_code_taken');
      }

      await dependencies.stores.types.insert(transaction, state);
      return success({ leaveTypeId: state.id });
    }),
});

export interface PublishLeaveTypeCommand extends Command {
  readonly commandName: 'leave.publish-type';
  readonly leaveTypeId: string;
  readonly expectedVersion: number;
}

export interface LeaveTypePublished {
  readonly leaveTypeId: string;
  readonly status: string;
}

export const publishLeaveTypeHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<PublishLeaveTypeCommand, LeaveTypePublished> => ({
  commandName: 'leave.publish-type',
  permission: LeavePermissions.policyPublish,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.types.byId(transaction, command.leaveTypeId);

      if (found === undefined) return notFound<LeaveTypePublished>('leave type');

      const type = LeaveType.rehydrate(found);
      const published = type.publish(currentActor(), dependencies.clock.now());

      if (!published.ok) return refusedBy<LeaveTypePublished>(published.error);

      await dependencies.stores.types.update(transaction, published.value, command.expectedVersion);
      return success({ leaveTypeId: published.value.id, status: published.value.status });
    }),
});
