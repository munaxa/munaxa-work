import type { IdentityStores } from '../application/identity-ports.js';

import { BusinessProfileRepository } from './business-profile.repository.js';
import { DelegationRepository } from './delegation.repository.js';
import { EmploymentLinkRepository } from './employment-link.repository.js';
import { InvitationRepository } from './invitation.repository.js';
import { PortalAssignmentRepository } from './portal-assignment.repository.js';
import { TenantMembershipRepository } from './tenant-membership.repository.js';
import { UserPreferenceRepository } from './user-preference.repository.js';
import { WorkforceUserRepository } from './workforce-user.repository.js';

/**
 * The module's persistence, assembled.
 *
 * Repositories are stateless — they hold a table name and nothing else, and every method takes
 * the transaction — so one instance each is correct and there is nothing per-request to build.
 */
export const postgresIdentityStores = (): IdentityStores => ({
  users: new WorkforceUserRepository(),
  memberships: new TenantMembershipRepository(),
  invitations: new InvitationRepository(),
  portals: new PortalAssignmentRepository(),
  employmentLinks: new EmploymentLinkRepository(),
  delegations: new DelegationRepository(),
  profiles: new BusinessProfileRepository(),
  preferences: new UserPreferenceRepository(),
});
