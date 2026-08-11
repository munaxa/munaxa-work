import {
  success,
  type Command,
  type CommandHandler,
  type RuleDefinition,
  type Transaction,
} from '@work/kernel';

import { LeavePolicy, type DefineLeavePolicy } from '../domain/leave-policy.js';
import { blackout, conflictsWith, policyAssignment } from '../domain/policy-assignment.js';
import { conflicted, currentActor, currentTenant, notFound, refusedBy } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type { BilingualInput, Metadata } from '../domain/leave-aggregate.js';
import type {
  AccrualSettings,
  CarryOverSettings,
  LeaveYearSettings,
  LimitSettings,
} from '../domain/leave-policy-settings.js';
import type { PolicyAssignmentState } from '../domain/policy-assignment.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Drafting policy versions, publishing them, and binding them to a scope.
 *
 * Three commands rather than one because they are three different acts with three different
 * consequences. Drafting changes nothing for anybody. Publishing freezes a set of rules that
 * everybody assigned to it will be measured by, and is behind its own permission. Assigning decides
 * *who* those rules apply to, and is where a mistake reaches the largest number of people at once.
 *
 * **Only a published version may be assigned.** A draft bound to a unit by mistake would be
 * invisible in resolution — which is safe — but the refusal here says so plainly rather than
 * leaving somebody wondering why their policy has no effect.
 *
 * **Overlapping assignments at the same specificity are refused rather than merged**, checked here
 * against the existing rows. There is no database constraint that could express it: the scope
 * identifier is nullable for the tenant scope, and an exclusion constraint over a nullable column
 * would treat two tenant-scoped rows as distinct — which is the collision that matters most.
 */

export interface DefineLeavePolicyCommand extends Command {
  readonly commandName: 'leave.define-policy';
  readonly leaveTypeId: string;
  readonly code: string;
  readonly name: BilingualInput;
  readonly versionNumber?: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly eligibilityRule?: RuleDefinition<boolean>;
  readonly limits?: Partial<LimitSettings>;
  readonly accrual?: Partial<AccrualSettings>;
  readonly carryOver?: Partial<CarryOverSettings>;
  readonly leaveYear?: Partial<LeaveYearSettings>;
  readonly approvalsRequired?: number;
  readonly selfApprovalPermitted?: boolean;
  readonly encashable?: boolean;
  readonly encashmentCapMinutes?: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: string;
  readonly metadata?: Metadata;
}

export interface LeavePolicyDefined {
  readonly leavePolicyId: string;
}

export const defineLeavePolicyHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<DefineLeavePolicyCommand, LeavePolicyDefined> => ({
  commandName: 'leave.define-policy',
  permission: LeavePermissions.policyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const type = await dependencies.stores.types.byId(transaction, command.leaveTypeId);

      if (type === undefined) return notFound<LeavePolicyDefined>('leave type');
      if (type.status !== 'published') {
        return refusedBy<LeavePolicyDefined>({
          reason: 'leave_type_not_published',
          messageKey: 'leave.rejection.leave_type_not_published',
        });
      }

      const request: DefineLeavePolicy = { ...command, tenantId: currentTenant() };
      const drafted = LeavePolicy.define(request, dependencies.clock.now());

      if (!drafted.ok) return refusedBy<LeavePolicyDefined>(drafted.error);

      await dependencies.stores.policies.insert(transaction, drafted.value.snapshot());
      return success({ leavePolicyId: drafted.value.snapshot().id });
    }),
});

export interface PublishLeavePolicyCommand extends Command {
  readonly commandName: 'leave.publish-policy';
  readonly leavePolicyId: string;
  readonly expectedVersion: number;
}

export interface LeavePolicyPublished {
  readonly leavePolicyId: string;
  readonly status: string;
}

export const publishLeavePolicyHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<PublishLeavePolicyCommand, LeavePolicyPublished> => ({
  commandName: 'leave.publish-policy',
  permission: LeavePermissions.policyPublish,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.policies.byId(transaction, command.leavePolicyId);

      if (found === undefined) return notFound<LeavePolicyPublished>('leave policy');

      const policy = LeavePolicy.rehydrate(found);
      const published = policy.publish(currentActor(), dependencies.clock.now());

      if (!published.ok) return refusedBy<LeavePolicyPublished>(published.error);

      await dependencies.stores.policies.update(
        transaction,
        published.value,
        command.expectedVersion,
      );
      return success({ leavePolicyId: published.value.id, status: published.value.status });
    }),
});

export interface AssignLeavePolicyCommand extends Command {
  readonly commandName: 'leave.assign-policy';
  readonly leavePolicyId: string;
  readonly scope: string;
  readonly scopeId?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
}

export interface LeavePolicyAssigned {
  readonly assignmentId: string;
}

export const assignLeavePolicyHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<AssignLeavePolicyCommand, LeavePolicyAssigned> => ({
  commandName: 'leave.assign-policy',
  permission: LeavePermissions.policyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const policy = await dependencies.stores.policies.byId(transaction, command.leavePolicyId);

      if (policy === undefined) return notFound<LeavePolicyAssigned>('leave policy');
      if (policy.status !== 'published') {
        return refusedBy<LeavePolicyAssigned>({
          reason: 'leave_policy_not_published',
          messageKey: 'leave.rejection.leave_policy_not_published',
        });
      }

      const drafted = policyAssignment(
        { ...command, tenantId: currentTenant() },
        dependencies.clock.now(),
      );

      if (!drafted.ok) return refusedBy<LeavePolicyAssigned>(drafted.error);

      const clash = await overlapping(dependencies, transaction, policy.leaveTypeId, drafted.value);

      if (clash) return conflicted<LeavePolicyAssigned>('leave.rejection.assignment_overlaps');

      await dependencies.stores.assignments.insert(transaction, drafted.value);
      return success({ assignmentId: drafted.value.id });
    }),
});

/**
 * Whether an existing assignment already claims this scope over this period, **for the same leave
 * type**.
 *
 * Scoped by type deliberately: two policies for two different kinds of leave both assigned to the
 * same unit is ordinary configuration, not a conflict. What is a conflict is two policies for the
 * *same* kind, because then there is no answer to which rules govern a request.
 */
const overlapping = async (
  dependencies: LeaveDependencies,
  transaction: Transaction,
  leaveTypeId: string,
  candidate: PolicyAssignmentState,
): Promise<boolean> => {
  const policies = await dependencies.stores.policies.forType(transaction, leaveTypeId);

  for (const policy of policies) {
    const existing = await dependencies.stores.assignments.forPolicy(transaction, policy.id);

    if (existing.some((one) => conflictsWith(one, candidate))) return true;
  }
  return false;
};

export interface DeclareBlackoutCommand extends Command {
  readonly commandName: 'leave.declare-blackout';
  readonly leaveTypeId?: string;
  readonly scope: string;
  readonly scopeId?: string;
  readonly name: BilingualInput;
  readonly fromDate: string;
  readonly toDate: string;
  readonly reasonCode?: string;
}

export interface BlackoutDeclared {
  readonly blackoutId: string;
}

export const declareBlackoutHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<DeclareBlackoutCommand, BlackoutDeclared> => ({
  commandName: 'leave.declare-blackout',
  permission: LeavePermissions.policyManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const declared = blackout(
        { ...command, tenantId: currentTenant() },
        dependencies.clock.now(),
      );

      if (!declared.ok) return refusedBy<BlackoutDeclared>(declared.error);

      await dependencies.stores.blackouts.insert(transaction, declared.value);
      return success({ blackoutId: declared.value.id });
    }),
});
