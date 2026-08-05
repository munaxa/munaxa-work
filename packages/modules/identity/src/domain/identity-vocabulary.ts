/**
 * The ubiquitous language of Workforce Identity, in one file so that the API, the contracts and
 * the aggregates cannot drift into three spellings of the same idea.
 *
 * Every value here is a business state. None of them is an authentication state: there is no
 * "logged in", no "password expired", no "session". Those words belong to Platform, and their
 * absence from this file is the boundary being kept rather than described.
 */

/**
 * The lifecycle of a workforce user, which spans every tenant the person belongs to.
 *
 * `provisioned` — Munaxa Work knows the person exists and which Platform account they are, but
 * no tenant has admitted them yet. An invitation creates a user in this state (AD-009).
 * `active` — at least one tenant has admitted them.
 * `suspended` — barred everywhere, by a platform-wide administrative act. Reversible.
 * `deactivated` — the person has left every tenant. Terminal, and it does not delete anything:
 * employment history, delegations and audit trails outlive the account (AD-008).
 */
export const WORKFORCE_USER_STATUSES = [
  'provisioned',
  'active',
  'suspended',
  'deactivated',
] as const;
export type WorkforceUserStatus = (typeof WORKFORCE_USER_STATUSES)[number];

/**
 * The lifecycle of one person's membership of one tenant.
 *
 * `active` — the person may act in this tenant, subject to the permissions Platform grants.
 * `suspended` — temporarily barred from this tenant only. Their other tenants are unaffected.
 * `ended` — they have left this tenant. Their workforce user and every other membership survive
 * it, and they may rejoin later: people are rehired, and a system that made that impossible
 * would force an administrator to create a second identity for the same person.
 *
 * There is deliberately no "invited" state here. "Asked but not yet joined" is what a pending
 * `Invitation` *is*, and recording the same fact in two aggregates would give the product two
 * answers to whether somebody has joined — the duplicated-ownership failure the master
 * instructions exist to prevent. A membership begins when a person actually becomes a member.
 */
export const MEMBERSHIP_STATUSES = ['active', 'suspended', 'ended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** A membership that may act now. Everything downstream — portals, delegation — asks this. */
export const isActingMembership = (status: MembershipStatus): boolean => status === 'active';

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * The portals a tenant may open to a member. Portal access is business configuration, not
 * authentication (AD-007): granting the manager portal says "this person manages people here",
 * and says nothing about how they prove who they are.
 *
 * The list is closed because each portal is an application this repository ships. A tenant
 * configures *who* gets one, never *which ones exist*.
 */
export const PORTAL_KEYS = ['employee', 'manager', 'admin'] as const;
export type PortalKey = (typeof PORTAL_KEYS)[number];

export const PORTAL_ASSIGNMENT_STATUSES = ['granted', 'revoked'] as const;
export type PortalAssignmentStatus = (typeof PORTAL_ASSIGNMENT_STATUSES)[number];

export const EMPLOYMENT_LINK_STATUSES = ['linked', 'unlinked'] as const;
export type EmploymentLinkStatus = (typeof EMPLOYMENT_LINK_STATUSES)[number];

/**
 * `scheduled` — created with a future start; not yet in force.
 * `active` — in force now.
 * `revoked` — withdrawn before its end. Terminal.
 * `expired` — its period elapsed. Terminal.
 */
export const DELEGATION_STATUSES = ['scheduled', 'active', 'revoked', 'expired'] as const;
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];

/**
 * Numeral rendering. Arabic-Indic and Western are both first-class, selected by preference
 * rather than derived from the language: an Arabic-speaking user may well want Western numerals
 * on a payslip, and deriving it would make that unexpressible.
 */
export const NUMERAL_SYSTEMS = ['western', 'arabic-indic'] as const;
export type NumeralSystem = (typeof NUMERAL_SYSTEMS)[number];
