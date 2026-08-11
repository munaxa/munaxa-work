import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type {
  Clock,
  DocumentReferencePort,
  EmploymentPort,
  NotificationIntentPort,
  OrganizationPort,
  PerformanceStores,
} from './performance-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Four ports and no more.** Performance reads employments through a published contract, reads a
 * unit's governing legal entity through another, checks that an evidence document exists through a
 * third, and records a notification intent through a fourth that delivers nothing. There is no
 * `JobPort`, no renderer, no signature provider, no Compensation port and no People port — none of
 * them would be used, and declaring one would imply this module could.
 *
 * **There is deliberately no People port.** A review carries an employment, and a screen that wants
 * a name asks People itself. Reaching for a name here would put a second answer to "what is this
 * person called" inside a performance record that outlives the name (AD-001, ADR-0037).
 *
 * `permissions` is here because authorization in this module is not a single gate at the edge. A
 * manager reading their team's reviews and HR reading the organization's take different paths
 * through the same query, and the handler has to *ask* which one it is holding.
 */
export interface PerformanceDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: PerformanceStores;
  readonly employment: EmploymentPort;
  readonly organization: OrganizationPort;
  readonly documents: DocumentReferencePort;
  readonly notifications: NotificationIntentPort;
  readonly permissions: PermissionChecker;
  readonly clock: Clock;
}
