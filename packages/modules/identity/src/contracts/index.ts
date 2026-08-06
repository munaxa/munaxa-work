/**
 * The public contract of Workforce Identity.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories,
 * its tables and its aggregates are private, and stay private, because the moment a second
 * module reads `tenant_membership` directly the boundary stops being a boundary.
 *
 * Contracts are versioned. A breaking change to anything in this file requires an ADR.
 */

export type {
  MembershipStatus,
  PortalKey,
  WorkforceUserStatus,
} from '../domain/identity-vocabulary.js';

/**
 * The portal keys themselves, not just their type.
 *
 * A consumer narrowing an untyped string — a database row, a request body — to a `PortalKey`
 * needs the set, and the alternative is every consumer writing its own copy of the list. Three
 * copies of a closed set is three places to forget the fourth portal.
 */
export { PORTAL_KEYS } from '../domain/identity-vocabulary.js';

export type { TenantMembershipDirectory, ResolvedMembership } from './membership-directory.js';
export { DenyAllMembershipDirectory } from './membership-directory.js';

export type {
  BusinessProfileView,
  DelegationView,
  EmploymentLinkView,
  InvitationView,
  PortalAssignmentView,
  TenantMembershipView,
  UserPreferenceView,
  WorkforceUserView,
} from './views.js';
