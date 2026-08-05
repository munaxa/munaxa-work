import { success, type Command, type CommandHandler } from '@work/kernel';

import { TenantMembership } from '../domain/tenant-membership.js';
import { WorkforceUser } from '../domain/workforce-user.js';

import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * Admitting, suspending, reinstating and ending a membership.
 *
 * Every one of these is a change to who may act in a tenant, so every one of them takes the
 * version the caller read. Two administrators looking at the same register and deciding
 * differently must produce a conflict, never a silent last-writer-wins where the suspension one
 * of them applied disappears without trace.
 */

export interface AdmitMember extends Command {
  readonly commandName: 'identity.admit-member';
  /** A Platform account that already exists. Administrators add known people this way. */
  readonly platformUserId: string;
}

export interface MembershipChanged {
  readonly membershipId: string;
  readonly status: string;
}

export const admitMemberHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<AdmitMember, MembershipChanged> => ({
  commandName: 'identity.admit-member',
  permission: IdentityPermissions.membershipManage,

  validate: (command) =>
    command.platformUserId.trim() === ''
      ? [{ field: 'platformUserId', message: 'is required' }]
      : [],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const existingUser = await dependencies.stores.users.byPlatformUserId(
        transaction,
        command.platformUserId,
      );

      const user =
        existingUser === undefined
          ? WorkforceUser.provision(command.platformUserId, origin, now)
          : WorkforceUser.rehydrate(existingUser);

      const activated = user.activate(origin, now);

      if (!activated.ok) return refusedBy(activated.error);

      if (existingUser === undefined) {
        await dependencies.stores.users.insert(transaction, user.snapshot());
      } else if (user.hasPendingEvents()) {
        await dependencies.stores.users.update(transaction, user.snapshot(), existingUser.version);
      }
      transaction.collect(user.pullEvents());

      const existing = await dependencies.stores.memberships.byUser(transaction, user.id);

      if (existing === undefined) {
        const membership = TenantMembership.admit(currentTenant(), user.id, origin, now);

        await dependencies.stores.memberships.insert(transaction, membership.snapshot());
        transaction.collect(membership.pullEvents());
        return success({ membershipId: membership.id, status: membership.currentStatus });
      }

      const membership = TenantMembership.rehydrate(existing);
      const rejoined = membership.rejoin(origin, now);

      if (!rejoined.ok) return refusedBy(rejoined.error);

      await dependencies.stores.memberships.update(
        transaction,
        membership.snapshot(),
        existing.version,
      );
      transaction.collect(membership.pullEvents());
      return success({ membershipId: membership.id, status: membership.currentStatus });
    }),
});

/** The three transitions an administrator applies to an existing membership. */
export type MembershipTransition = 'suspend' | 'reinstate' | 'end';

export interface ChangeMembership extends Command {
  readonly commandName: 'identity.change-membership';
  readonly membershipId: string;
  readonly transition: MembershipTransition;
  readonly reason: string;
  readonly expectedVersion: number;
}

export const changeMembershipHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<ChangeMembership, MembershipChanged> => ({
  commandName: 'identity.change-membership',
  permission: IdentityPermissions.membershipManage,

  validate: (command) => {
    const failures = [];

    if (!['suspend', 'reinstate', 'end'].includes(command.transition)) {
      failures.push({ field: 'transition', message: 'must be suspend, reinstate or end' });
    }
    // Reinstatement is the restoration of a state that already existed; the other two remove
    // somebody's access, and an access removal with no stated reason cannot be reviewed later.
    if (command.transition !== 'reinstate' && command.reason.trim() === '') {
      failures.push({ field: 'reason', message: 'must state why' });
    }
    return failures;
  },

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.memberships.byId(transaction, command.membershipId);

      if (state === undefined) return notFound('membership');

      const membership = TenantMembership.rehydrate(state);
      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();

      const outcome =
        command.transition === 'suspend'
          ? membership.suspend(command.reason, origin, now)
          : command.transition === 'reinstate'
            ? membership.reinstate(origin, now)
            : membership.end(command.reason, origin, now);

      if (!outcome.ok) return refusedBy(outcome.error);

      await dependencies.stores.memberships.update(
        transaction,
        membership.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(membership.pullEvents());

      return success({ membershipId: membership.id, status: membership.currentStatus });
    }),
});
