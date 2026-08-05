/**
 * Organization — the enterprise's structure.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may
 * depend on, the composition pieces the API needs to wire the module up, and nothing else.
 * Aggregates, repositories and handlers stay internal — a consumer that could reach them would
 * be a consumer this module can no longer change.
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { organizationModule } from './application/organization-module.js';
export {
  OrganizationPermissions,
  ALL_ORGANIZATION_PERMISSIONS,
} from './application/organization-permissions.js';
export type { OrganizationPermission } from './application/organization-permissions.js';
export { systemClock } from './application/organization-ports.js';
export type {
  Clock,
  FilledHeadcountPort,
  OrganizationStores,
} from './application/organization-ports.js';
export type { OrganizationDependencies } from './application/organization-dependencies.js';
export type { CommandSender } from './application/transfer.use-case.js';
export { NoAssignmentsYet } from './application/no-assignments.js';
export { postgresOrganizationStores } from './infrastructure/organization-stores.js';

/**
 * The adapter that closes the Phase 2 debt: a tenant's own settings, falling back to the
 * deployment's for a tenant that has configured none. It implements Workforce Identity's
 * `TenantSettingsPort`, so the composition root swaps it for `ConfiguredTenantSettings` and no
 * identity use case changes (ADR-0036).
 */
export { StoredTenantSettings } from './infrastructure/stored-tenant-settings.js';

// Transport — the controllers the API mounts.
export { OrganizationDispatcher } from './api/organization-dispatcher.js';
export { UnitTypesController } from './api/unit-types.controller.js';
export { UnitsController } from './api/units.controller.js';
export { HierarchyController } from './api/hierarchy.controller.js';
export { LegalEntitiesController } from './api/legal-entities.controller.js';
export { CentersController } from './api/centers.controller.js';
export { PositionsController } from './api/positions.controller.js';
export { EstablishmentController } from './api/establishment.controller.js';
export { CalendarsController } from './api/calendars.controller.js';
export { AdministrationController } from './api/administration.controller.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's
 * endpoint tests need the same stores this module's own tests use, and a fake duplicated in two
 * packages is a fake that will drift from the real repositories in one of them.
 */
export { inMemoryOrganizationStores } from './application/in-memory-stores.js';
