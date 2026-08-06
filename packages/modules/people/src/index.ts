/**
 * People — the enterprise master registry of human identity.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may depend
 * on, the composition pieces the API needs to wire the module up, and nothing else. Aggregates,
 * repositories and handlers stay internal — a consumer that could reach them would be a consumer
 * this module can no longer change, and in this module it would also be a consumer reading
 * national identifiers without a permission check, because the boundary is where the redaction
 * lives.
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { peopleModule } from './application/people-module.js';
export { PeoplePermissions, ALL_PEOPLE_PERMISSIONS } from './application/people-permissions.js';
export type { PeoplePermission } from './application/people-permissions.js';
export { systemClock } from './application/people-ports.js';
export type {
  Clock,
  DisclosurePort,
  IdentifierDigestPort,
  PeopleStores,
} from './application/people-ports.js';
export type { PeopleDependencies } from './application/people-dependencies.js';
export type { CommandSender } from './application/transfer.use-case.js';
export { IMPORT_LIMIT } from './application/transfer.use-case.js';
export { postgresPeopleStores } from './infrastructure/people-stores.js';

/**
 * The two adapters that make this module's PII protections real rather than presentational: a
 * keyed digest, so duplicate detection never reads a government identifier, and a structured
 * record of every time somebody was shown one.
 */
export {
  HmacIdentifierDigest,
  StructuredDisclosureLog,
} from './infrastructure/identifier-digest.js';

// Transport — the controllers the API mounts.
export { PeopleDispatcher } from './api/people-dispatcher.js';
export { PeopleController } from './api/people.controller.js';
export { PersonLifecycleController } from './api/person-lifecycle.controller.js';
export { IdentifiersController } from './api/identifiers.controller.js';
export { ContactsController } from './api/contacts.controller.js';
export { PersonalDetailsController } from './api/personal-details.controller.js';
export { ProfileController } from './api/profile.controller.js';
export { DuplicatesController } from './api/duplicates.controller.js';
export { TransferController } from './api/transfer.controller.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's
 * endpoint tests need the same stores this module's own tests use, and a fake duplicated in two
 * packages is a fake that will drift from the real repositories in one of them.
 */
export { inMemoryPeopleStores } from './application/in-memory-stores.js';
