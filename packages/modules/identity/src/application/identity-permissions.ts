/**
 * Every permission this module registers.
 *
 * They are declared here and referenced by handlers, never spelled out at a call site, because a
 * permission string that exists in two places will eventually differ in one — and the difference
 * fails open exactly once, on the endpoint whose spelling nobody checked.
 *
 * Registration is automatic: the module registry derives the list from the handlers, so a
 * permission cannot exist in code and be missing from the administration screen (see
 * `ModuleRegistry.describe`). Platform decides who holds them; this module only says what they
 * are and what they guard.
 *
 * The split is read/manage per concern rather than one permission per endpoint. An
 * administrator who may see the membership register and one who may end memberships are
 * genuinely different people in every organization that has an HR function.
 */
export const IdentityPermissions = {
  userRead: 'identity.user.read',
  userManage: 'identity.user.manage',

  membershipRead: 'identity.membership.read',
  membershipManage: 'identity.membership.manage',

  invitationRead: 'identity.invitation.read',
  invitationManage: 'identity.invitation.manage',
  /** Accepting one's own invitation. Held by every authenticated person, not by administrators. */
  invitationAccept: 'identity.invitation.accept',

  portalRead: 'identity.portal.read',
  portalManage: 'identity.portal.manage',

  employmentLinkRead: 'identity.employment-link.read',
  employmentLinkManage: 'identity.employment-link.manage',

  delegationRead: 'identity.delegation.read',
  delegationManage: 'identity.delegation.manage',

  profileRead: 'identity.profile.read',
  profileManage: 'identity.profile.manage',

  preferenceRead: 'identity.preference.read',
  /** A person changes their own language and calendar. Not an administrative act. */
  preferenceManage: 'identity.preference.manage',
} as const;

export type IdentityPermission = (typeof IdentityPermissions)[keyof typeof IdentityPermissions];

export const ALL_IDENTITY_PERMISSIONS: readonly IdentityPermission[] =
  Object.values(IdentityPermissions);
