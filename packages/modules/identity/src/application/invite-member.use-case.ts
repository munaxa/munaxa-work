import { rejected, success, type Command, type CommandHandler } from '@work/kernel';

import { Invitation } from '../domain/invitation.js';
import { PORTAL_KEYS, type PortalKey } from '../domain/identity-vocabulary.js';

import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * Issuing and withdrawing invitations.
 *
 * Nothing here creates an account, a password or a credential of any kind (AD-009). An
 * invitation is a record that a tenant asked somebody to join; Platform is where they get an
 * identity, and acceptance is where the two meet.
 */

const MILLISECONDS_PER_DAY = 86_400_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteMember extends Command {
  readonly commandName: 'identity.invite-member';
  readonly email: string;
  /** Portals to open on acceptance. Empty means the tenant's default set. */
  readonly portals?: readonly PortalKey[];
}

export interface InvitationIssued {
  readonly invitationId: string;
  readonly expiresAt: Date;
}

export const inviteMemberHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<InviteMember, InvitationIssued> => ({
  commandName: 'identity.invite-member',
  permission: IdentityPermissions.invitationManage,

  validate: (command) => {
    const failures = [];

    if (!EMAIL.test(command.email.trim())) {
      failures.push({ field: 'email', message: 'must be an email address' });
    }
    for (const portal of command.portals ?? []) {
      if (!PORTAL_KEYS.includes(portal)) {
        failures.push({ field: 'portals', message: `unknown portal "${portal}"` });
      }
    }
    return failures;
  },

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const tenantId = currentTenant();
      const now = dependencies.clock.now();
      const settings = await dependencies.settings.settingsFor(tenantId);

      // Re-inviting somebody who has not answered should resend, not create a second pending
      // invitation. Two live invitations for one address can be accepted independently, and the
      // second acceptance would look like a bug in the membership register.
      const existing = await dependencies.stores.invitations.pendingForEmail(
        transaction,
        command.email,
      );

      if (existing !== undefined) return rejected('identity.rejection.invitation_already_pending');

      const issued = Invitation.issue(
        {
          tenantId,
          email: command.email,
          portals: command.portals ?? settings.defaultPortals,
          expiresAt: new Date(
            now.getTime() + settings.invitationValidityDays * MILLISECONDS_PER_DAY,
          ),
        },
        originOfCurrentRequest(),
        now,
      );

      if (!issued.ok) return refusedBy(issued.error);

      await dependencies.stores.invitations.insert(transaction, issued.value.snapshot());
      transaction.collect(issued.value.pullEvents());

      return success({
        invitationId: issued.value.id,
        expiresAt: issued.value.expiresAt,
      });
    }),
});

export interface RevokeInvitation extends Command {
  readonly commandName: 'identity.revoke-invitation';
  readonly invitationId: string;
  readonly reason: string;
  /** The version the caller read. A stale write is refused, never applied. */
  readonly expectedVersion: number;
}

export const revokeInvitationHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<RevokeInvitation, { readonly invitationId: string }> => ({
  commandName: 'identity.revoke-invitation',
  permission: IdentityPermissions.invitationManage,

  validate: (command) =>
    command.reason.trim() === ''
      ? [{ field: 'reason', message: 'a withdrawal must state why' }]
      : [],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.invitations.byId(transaction, command.invitationId);

      if (state === undefined) return notFound('invitation');

      const invitation = Invitation.rehydrate(state);
      const outcome = invitation.revoke(
        command.reason,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!outcome.ok) return refusedBy(outcome.error);

      await dependencies.stores.invitations.update(
        transaction,
        invitation.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(invitation.pullEvents());

      return success({ invitationId: invitation.id });
    }),
});
