import { success, type Command, type CommandHandler } from '@work/kernel';

import { PortalAssignment } from '../domain/portal-assignment.js';
import { PORTAL_KEYS, type PortalKey } from '../domain/identity-vocabulary.js';

import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * Opening and withdrawing a portal for a member.
 *
 * Business configuration, not authorization (AD-007). Granting the manager portal puts an
 * application on somebody's home screen; it does not decide whether they may approve anything.
 * Keeping those separate is what stops a UI change from silently altering what a person is
 * allowed to do.
 */

export interface GrantPortal extends Command {
  readonly commandName: 'identity.grant-portal';
  readonly membershipId: string;
  readonly portal: PortalKey;
}

export interface PortalChanged {
  readonly assignmentId: string;
  readonly portal: PortalKey;
  readonly status: string;
}

export const grantPortalHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<GrantPortal, PortalChanged> => ({
  commandName: 'identity.grant-portal',
  permission: IdentityPermissions.portalManage,

  validate: (command) =>
    PORTAL_KEYS.includes(command.portal)
      ? []
      : [{ field: 'portal', message: `must be one of ${PORTAL_KEYS.join(', ')}` }],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const membership = await dependencies.stores.memberships.byId(
        transaction,
        command.membershipId,
      );

      // Reading the membership first is not ceremony: it is what makes a portal grant for
      // another tenant's member impossible in code as well as in the database, and it produces
      // "no such membership" rather than a foreign key error the caller cannot act on.
      if (membership === undefined) return notFound('membership');

      const origin = originOfCurrentRequest();
      const now = dependencies.clock.now();
      const existing = await dependencies.stores.portals.forMembershipAndPortal(
        transaction,
        command.membershipId,
        command.portal,
      );

      if (existing === undefined) {
        const assignment = PortalAssignment.grant(
          { tenantId: currentTenant(), membershipId: command.membershipId, portal: command.portal },
          origin,
          now,
        );

        await dependencies.stores.portals.insert(transaction, assignment.snapshot());
        transaction.collect(assignment.pullEvents());
        return success({
          assignmentId: assignment.id,
          portal: assignment.portal,
          status: assignment.currentStatus,
        });
      }

      const assignment = PortalAssignment.rehydrate(existing);
      const reinstated = assignment.reinstate(origin, now);

      if (!reinstated.ok) return refusedBy(reinstated.error);

      await dependencies.stores.portals.update(
        transaction,
        assignment.snapshot(),
        existing.version,
      );
      transaction.collect(assignment.pullEvents());

      return success({
        assignmentId: assignment.id,
        portal: assignment.portal,
        status: assignment.currentStatus,
      });
    }),
});

export interface RevokePortal extends Command {
  readonly commandName: 'identity.revoke-portal';
  readonly assignmentId: string;
  readonly reason: string;
  readonly expectedVersion: number;
}

export const revokePortalHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<RevokePortal, PortalChanged> => ({
  commandName: 'identity.revoke-portal',
  permission: IdentityPermissions.portalManage,

  validate: (command) =>
    command.reason.trim() === '' ? [{ field: 'reason', message: 'must state why' }] : [],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.portals.byId(transaction, command.assignmentId);

      if (existing === undefined) return notFound('portal assignment');

      const assignment = PortalAssignment.rehydrate(existing);
      const outcome = assignment.revoke(
        command.reason,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!outcome.ok) return refusedBy(outcome.error);

      await dependencies.stores.portals.update(
        transaction,
        assignment.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(assignment.pullEvents());

      return success({
        assignmentId: assignment.id,
        portal: assignment.portal,
        status: assignment.currentStatus,
      });
    }),
});
