import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type { Clock, DisclosurePort, IdentifierDigestPort, PeopleStores } from './people-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container
 * inside the handler. It costs a line of wiring and buys handlers testable against fakes with no
 * framework present at all — the difference between a duplicate-detection test that runs in
 * milliseconds and one that needs a database and a Nest module to start.
 */
export interface PeopleDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: PeopleStores;
  /**
   * The same checker the pipeline uses, injected so a *read* can assemble its answer from what
   * the caller holds.
   *
   * The pipeline checks the one permission a handler declares, which is the right shape for a
   * command — a command either happens or it does not. A read of a person is different: a caller
   * with `people.person.read` and nothing else must get the person with the sensitive fields
   * withheld, not a 403. Refusing them would make the register unusable for everybody who is not
   * a data-protection officer, and the pressure that creates is to grant everybody everything.
   */
  readonly permissions: PermissionChecker;
  readonly digest: IdentifierDigestPort;
  readonly disclosure: DisclosurePort;
  readonly clock: Clock;
}
