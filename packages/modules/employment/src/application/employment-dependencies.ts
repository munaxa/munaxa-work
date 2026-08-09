import type { UnitOfWork } from '@work/kernel';

import type {
  Clock,
  EmploymentStores,
  OrganizationDirectoryPort,
  PersonDirectoryPort,
} from './employment-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container
 * inside the handler. It costs a line of wiring and buys handlers testable against fakes with no
 * framework present at all — the difference between a status-machine test that runs in
 * milliseconds and one that needs a database and a Nest module to start.
 *
There is deliberately **no `PermissionChecker` here**, unlike People's dependencies. People's reads
 * redact by field, so a handler there has to ask what the caller holds; Employment's reads do not —
 * a caller either may read an employment or may not, and the pipeline decides that centrally. The
 * one field that varies by caller is the person's *name*, and that is redacted by People, on the
 * other side of the port, where the rule already lives.
 *
 * `people` and `organization` are **ports, not imports of those modules**. Employment depends on
 * both, and the dependency runs through their published application services rather than their
 * repositories — so a reference check is subject to the same permission rules a human reading that
 * record would meet, and this module holds no copy of anything either of them owns.
 */
export interface EmploymentDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: EmploymentStores;
  readonly people: PersonDirectoryPort;
  readonly organization: OrganizationDirectoryPort;
  readonly clock: Clock;
}
