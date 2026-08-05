import type { UnitOfWork } from '@work/kernel';

import type { Clock, IdentityStores, TenantSettingsPort } from './identity-ports.js';

/**
 * Everything the module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolved from a container
 * inside the handler. It costs a line of wiring and buys handlers that can be tested against
 * fakes with no framework present at all — which is the difference between a domain test that
 * runs in milliseconds and one that needs a database and a Nest module to start.
 */
export interface IdentityDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: IdentityStores;
  readonly settings: TenantSettingsPort;
  readonly clock: Clock;
}
