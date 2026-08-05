import {
  success,
  type Command,
  type CommandHandler,
  type EventOrigin,
  type Transaction,
} from '@work/kernel';

import { Invitation } from '../domain/invitation.js';
import { PortalAssignment } from '../domain/portal-assignment.js';
import { TenantMembership } from '../domain/tenant-membership.js';
import { UserPreference } from '../domain/user-preference.js';
import { WorkforceUser } from '../domain/workforce-user.js';
import type { IdentityResult } from '../domain/identity-rejection.js';

import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * The join between Platform and Munaxa Work — the use case the whole phase exists to make
 * possible.
 *
 * An authenticated person presents an invitation. Munaxa Work learns who they are from the
 * principal Platform vouched for, never from the invitation and never from the request body,
 * and then, in one transaction:
 *
 *   1. finds or provisions the workforce user for that Platform account, and activates it;
 *   2. admits them to the tenant, or readmits them if they had left;
 *   3. opens the portals the invitation named;
 *   4. gives them the tenant's default language, calendar and time zone to start from.
 *
 * All four or none. A person who is a member but has no preferences meets an English screen in
 * an Arabic tenant, and one who has preferences but no membership cannot open a request at all.
 */

export interface AcceptInvitation extends Command {
  readonly commandName: 'identity.accept-invitation';
  readonly invitationId: string;
  /** From the authenticated principal. Not from the request body; a caller cannot supply it. */
  readonly platformUserId: string;
  readonly principalEmail: string;
}

export interface InvitationAccepted {
  readonly workforceUserId: string;
  readonly membershipId: string;
  readonly tenantId: string;
}

export const acceptInvitationHandler = (
  dependencies: IdentityDependencies,
): CommandHandler<AcceptInvitation, InvitationAccepted> => ({
  commandName: 'identity.accept-invitation',
  permission: IdentityPermissions.invitationAccept,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const state = await dependencies.stores.invitations.byId(transaction, command.invitationId);

      if (state === undefined) return notFound('invitation');

      const invitation = Invitation.rehydrate(state);
      const user = await resolveUser(
        dependencies,
        transaction,
        command.platformUserId,
        origin,
        now,
      );

      if (!user.ok) return refusedBy(user.error);

      const accepted = invitation.acceptBy(
        { workforceUserId: user.value.id, email: command.principalEmail },
        origin,
        now,
      );

      if (!accepted.ok) return refusedBy(accepted.error);

      const membership = await admit(dependencies, transaction, user.value, origin, now);

      if (!membership.ok) return refusedBy(membership.error);

      await dependencies.stores.invitations.update(
        transaction,
        invitation.snapshot(),
        state.version,
      );
      transaction.collect(invitation.pullEvents());

      await openPortals(
        dependencies,
        transaction,
        { origin, occurredAt: now },
        {
          membership: membership.value,
          invitation,
        },
      );
      await seedPreferences(dependencies, transaction, membership.value, origin, now);

      return success({
        workforceUserId: user.value.id,
        membershipId: membership.value.id,
        tenantId: membership.value.tenantId,
      });
    }),
});

/**
 * Finds the workforce user for this Platform account, or brings one into existence.
 *
 * "Or provisions" rather than "always provisions": the same person accepting an invitation from
 * a second customer is the same person (AD-005), and creating a second workforce user for them
 * would split their delegations and their audit history down the middle.
 */
const resolveUser = async (
  dependencies: IdentityDependencies,
  transaction: Transaction,
  platformUserId: string,
  origin: EventOrigin,
  now: Date,
): Promise<IdentityResult<WorkforceUser>> => {
  const existing = await dependencies.stores.users.byPlatformUserId(transaction, platformUserId);

  if (existing === undefined) {
    const provisioned = WorkforceUser.provision(platformUserId, origin, now);
    const activated = provisioned.activate(origin, now);

    if (!activated.ok) return activated;

    await dependencies.stores.users.insert(transaction, provisioned.snapshot());
    transaction.collect(provisioned.pullEvents());
    return { ok: true, value: provisioned };
  }

  const user = WorkforceUser.rehydrate(existing);
  const activated = user.activate(origin, now);

  if (!activated.ok) return activated;

  if (user.hasPendingEvents()) {
    await dependencies.stores.users.update(transaction, user.snapshot(), existing.version);
    transaction.collect(user.pullEvents());
  }
  return { ok: true, value: user };
};

/** Admits, or readmits somebody who had left. A rehire is the same person, not a new one. */
const admit = async (
  dependencies: IdentityDependencies,
  transaction: Transaction,
  user: WorkforceUser,
  origin: EventOrigin,
  now: Date,
): Promise<IdentityResult<TenantMembership>> => {
  const existing = await dependencies.stores.memberships.byUser(transaction, user.id);

  if (existing === undefined) {
    const membership = TenantMembership.admit(currentTenant(), user.id, origin, now);

    await dependencies.stores.memberships.insert(transaction, membership.snapshot());
    transaction.collect(membership.pullEvents());
    return { ok: true, value: membership };
  }

  const membership = TenantMembership.rehydrate(existing);
  const rejoined = membership.rejoin(origin, now);

  if (!rejoined.ok) return rejoined;

  await dependencies.stores.memberships.update(
    transaction,
    membership.snapshot(),
    existing.version,
  );
  transaction.collect(membership.pullEvents());
  return { ok: true, value: membership };
};

/**
 * Opens the portals the invitation named. Re-granting a portal the member already has revoked
 * reinstates the existing row rather than adding a second: "who could reach the admin portal
 * last March" must have one answer.
 */
const openPortals = async (
  dependencies: IdentityDependencies,
  transaction: Transaction,
  when: { readonly origin: EventOrigin; readonly occurredAt: Date },
  what: { readonly membership: TenantMembership; readonly invitation: Invitation },
): Promise<void> => {
  const { origin, occurredAt: now } = when;
  const { membership, invitation } = what;

  for (const portal of invitation.portals) {
    const existing = await dependencies.stores.portals.forMembershipAndPortal(
      transaction,
      membership.id,
      portal,
    );

    if (existing === undefined) {
      const assignment = PortalAssignment.grant(
        { tenantId: membership.tenantId, membershipId: membership.id, portal },
        origin,
        now,
      );

      await dependencies.stores.portals.insert(transaction, assignment.snapshot());
      transaction.collect(assignment.pullEvents());
      continue;
    }

    const assignment = PortalAssignment.rehydrate(existing);

    if (assignment.isOpen) continue;

    assignment.reinstate(origin, now);
    await dependencies.stores.portals.update(transaction, assignment.snapshot(), existing.version);
    transaction.collect(assignment.pullEvents());
  }
};

/** The tenant's defaults, which the member may then change. Nothing here is hardcoded (00B). */
const seedPreferences = async (
  dependencies: IdentityDependencies,
  transaction: Transaction,
  membership: TenantMembership,
  origin: EventOrigin,
  now: Date,
): Promise<void> => {
  const existing = await dependencies.stores.preferences.forMembership(transaction, membership.id);

  if (existing !== undefined) return;

  const settings = await dependencies.settings.settingsFor(membership.tenantId);
  const preference = UserPreference.fromTenantDefaults(
    {
      tenantId: membership.tenantId,
      membershipId: membership.id,
      defaults: {
        language: settings.language,
        calendar: settings.calendar,
        timeZone: settings.timeZone,
        numerals: settings.numerals,
      },
    },
    origin,
    now,
  );

  await dependencies.stores.preferences.insert(transaction, preference.snapshot());
  transaction.collect(preference.pullEvents());
};
