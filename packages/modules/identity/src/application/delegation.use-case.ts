import { success, type Command, type CommandHandler } from '@work/kernel';

import { Delegation } from '../domain/delegation.js';

import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * Arranging and withdrawing cover: one member acting on another's behalf, for a stated period
 * and a stated scope.
 *
 * Phase 2 owns the fact; Phase 16 consumes it. Workflow will ask this module who is acting for
 * an absent approver, and get an answer from a period agreed in advance rather than a rule
 * invented at routing time (AD-010).
 */

export interface CreateDelegation extends Command {
  readonly commandName: 'identity.create-delegation';
  readonly delegatorMembershipId: string;
  readonly delegateMembershipId: string;
  /** An opaque key the consuming domain agrees, such as `leave.approve`. Not interpreted here. */
  readonly scope: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date;
  readonly reason: string;
}

export interface DelegationChanged {
  readonly delegationId: string;
  readonly status: string;
}

export const createDelegationHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<CreateDelegation, DelegationChanged> => ({
  commandName: 'identity.create-delegation',
  permission: IdentityPermissions.delegationManage,

  validate: (command) => {
    const failures = [];

    if (command.scope.trim() === '') {
      failures.push({ field: 'scope', message: 'is required' });
    }
    if (command.reason.trim() === '') {
      failures.push({ field: 'reason', message: 'must state why cover is arranged' });
    }
    return failures;
  },

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      // Both memberships are read before anything is created, so that delegating to somebody in
      // another tenant produces "no such membership" rather than a row that exists and can never
      // be used.
      const delegator = await dependencies.stores.memberships.byId(
        transaction,
        command.delegatorMembershipId,
      );
      const delegate = await dependencies.stores.memberships.byId(
        transaction,
        command.delegateMembershipId,
      );

      if (delegator === undefined) return notFound('delegator membership');
      if (delegate === undefined) return notFound('delegate membership');

      // Cover given to somebody who cannot act is not cover. It would sit in the register
      // looking like an arrangement while every approval routed to it stalled.
      if (delegate.status !== 'active') {
        return refusedBy({
          reason: 'delegate_not_active',
          messageKey: 'identity.rejection.delegate_not_active',
        });
      }

      const created = Delegation.create(
        {
          tenantId: currentTenant(),
          delegatorMembershipId: command.delegatorMembershipId,
          delegateMembershipId: command.delegateMembershipId,
          scope: command.scope.trim(),
          effectiveFrom: command.effectiveFrom,
          effectiveTo: command.effectiveTo,
          reason: command.reason,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!created.ok) return refusedBy(created.error);

      await dependencies.stores.delegations.insert(transaction, created.value.snapshot());
      transaction.collect(created.value.pullEvents());

      return success({
        delegationId: created.value.id,
        status: created.value.currentStatus,
      });
    }),
});

export interface RevokeDelegation extends Command {
  readonly commandName: 'identity.revoke-delegation';
  readonly delegationId: string;
  readonly reason: string;
  readonly expectedVersion: number;
}

export const revokeDelegationHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<RevokeDelegation, DelegationChanged> => ({
  commandName: 'identity.revoke-delegation',
  permission: IdentityPermissions.delegationManage,

  validate: (command) =>
    command.reason.trim() === '' ? [{ field: 'reason', message: 'must state why' }] : [],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.delegations.byId(
        transaction,
        command.delegationId,
      );

      if (existing === undefined) return notFound('delegation');

      const delegation = Delegation.rehydrate(existing);
      const outcome = delegation.revoke(
        command.reason,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!outcome.ok) return refusedBy(outcome.error);

      await dependencies.stores.delegations.update(
        transaction,
        delegation.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(delegation.pullEvents());

      return success({ delegationId: delegation.id, status: delegation.currentStatus });
    }),
});
