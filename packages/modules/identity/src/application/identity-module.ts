import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import { acceptInvitationHandler } from './accept-invitation.use-case.js';
import { createDelegationHandler, revokeDelegationHandler } from './delegation.use-case.js';
import {
  linkEmploymentHandler,
  makeEmploymentPrimaryHandler,
  unlinkEmploymentHandler,
} from './employment-linking.use-case.js';
import {
  activeDelegationsForHandler,
  describeMemberHandler,
  listInvitationsHandler,
  listMembershipsHandler,
  searchMembersHandler,
} from './identity-queries.js';
import { inviteMemberHandler, revokeInvitationHandler } from './invite-member.use-case.js';
import { admitMemberHandler, changeMembershipHandler } from './membership-lifecycle.use-case.js';
import { reviseProfileHandler, revisePreferenceHandler } from './member-profile.use-case.js';
import { grantPortalHandler, revokePortalHandler } from './portal-access.use-case.js';
import { onMembershipEnded } from './on-membership-ended.js';
import { ALL_IDENTITY_PERMISSIONS, IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * The module's declaration: what it offers, in one place, so the registry can derive everything
 * else.
 *
 * Nothing here is registered by hand anywhere. Permissions come from the handlers that declare
 * them, navigation is ordered across modules, and health checks are collected into `/health`.
 * A permission that existed in code but not in the administration screen would be invisible
 * until a customer found it, and manual registration is how that happens.
 */
export const identityModule = (dependencies: IdentityDependencies): WorkModule => ({
  name: 'identity',

  commands: [
    inviteMemberHandler(dependencies),
    revokeInvitationHandler(dependencies),
    acceptInvitationHandler(dependencies),
    admitMemberHandler(dependencies),
    changeMembershipHandler(dependencies),
    grantPortalHandler(dependencies),
    revokePortalHandler(dependencies),
    linkEmploymentHandler(dependencies),
    unlinkEmploymentHandler(dependencies),
    makeEmploymentPrimaryHandler(dependencies),
    createDelegationHandler(dependencies),
    revokeDelegationHandler(dependencies),
    reviseProfileHandler(dependencies),
    revisePreferenceHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[],

  queries: [
    listMembershipsHandler(dependencies),
    listInvitationsHandler(dependencies),
    describeMemberHandler(dependencies),
    searchMembersHandler(dependencies),
    activeDelegationsForHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[],

  eventHandlers: [onMembershipEnded(dependencies)],

  navigation: [
    {
      key: 'identity.members',
      path: '/members',
      permission: IdentityPermissions.membershipRead,
      order: 10,
    },
    {
      key: 'identity.invitations',
      path: '/invitations',
      permission: IdentityPermissions.invitationRead,
      order: 11,
    },
  ],

  // The read permissions a handler does not declare because no handler is guarded by them alone.
  // Stated so the administration screen offers the whole set rather than the subset that
  // happens to be reachable today.
  permissions: ALL_IDENTITY_PERMISSIONS,
});
