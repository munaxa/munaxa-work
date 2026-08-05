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
