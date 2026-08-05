/**
 * Workforce Identity — the business identity of an authenticated Platform user.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may
 * depend on, the composition pieces the API needs to wire the module up, and nothing else.
 * Aggregates, repositories and handlers stay internal — a consumer that could reach them would
 * be a consumer this module can no longer change.
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { identityModule } from './application/identity-module.js';
export {
  IdentityPermissions,
  ALL_IDENTITY_PERMISSIONS,
} from './application/identity-permissions.js';
export type { IdentityPermission } from './application/identity-permissions.js';
export { systemClock } from './application/identity-ports.js';
export type {
  Clock,
  IdentityStores,
  TenantIdentitySettings,
  TenantSettingsPort,
} from './application/identity-ports.js';
export type { IdentityDependencies } from './application/identity-dependencies.js';
export { postgresIdentityStores } from './infrastructure/identity-stores.js';
export { PostgresMembershipDirectory } from './infrastructure/membership-directory.js';
export { ConfiguredTenantSettings } from './infrastructure/tenant-settings.js';

// Transport — the controllers the API mounts, and the request shape its middleware populates.
export { IdentityDispatcher } from './api/identity-dispatcher.js';
export { InvitationsController } from './api/invitations.controller.js';
export { DelegationController } from './api/delegation.controller.js';
export { EmploymentLinkController } from './api/employment-link.controller.js';
export { PortalAccessController } from './api/portal-access.controller.js';
export { MemberProfileController } from './api/member-profile.controller.js';
export { MembersController } from './api/members.controller.js';
export type { AuthenticatedRequest, IdentityRequestContext } from './api/authenticated-request.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's
 * endpoint tests need the same stores the module's own tests use, and a fake duplicated in two
 * packages is a fake that will drift from the real repositories in one of them.
 */
export { inMemoryIdentityStores } from './application/in-memory-stores.js';
