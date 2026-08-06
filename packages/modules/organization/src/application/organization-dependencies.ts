import type { UnitOfWork } from '@work/kernel';

import type { Clock, FilledHeadcountPort, OrganizationStores } from './organization-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container
 * inside the handler. It costs a line of wiring and buys handlers testable against fakes with no
 * framework present at all — the difference between a domain test that runs in milliseconds and
 * one that needs a database and a Nest module to start.
 */
export interface OrganizationDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: OrganizationStores;
  /** Supplied by Employment from Phase 5. Zero until then, honestly and by construction. */
  readonly filled: FilledHeadcountPort;
  readonly clock: Clock;
}
