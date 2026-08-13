import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type {
  CareerStores,
  Clock,
  EmploymentPort,
  LearningPort,
  OrganizationPort,
} from './career-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Three ports and no more.** Career confirms an employment before nominating somebody, confirms a
 * position or unit exists before pointing at one, and confirms a Learning assignment exists before
 * storing a reference to it. Every one is a read.
 *
 * There is no `JobPort` (nothing is scheduled — a review comes due because somebody asked), no
 * `StoragePort` (nothing holds bytes), no `NotificationPort` (nothing tells anybody, and a recorded
 * intent nobody reads would be a "sent" state waiting to be misread), no People port (a plan carries
 * an employment, and a name belongs to People), **no Documents port** (nothing in the schema stores
 * an evidence identifier, so there is nothing for one to confirm) and **no Performance port** (D-5
 * was not authorized, so a nine-box band beside a nomination is `NOT VERIFIED`). Declaring any of
 * them would imply this module could use it.
 *
 * `permissions` is here because authorization in this module is not a single gate at the edge. A
 * caller holding `plan.read` and one holding `plan.read-team` take different paths through the same
 * query, and the handler has to *ask* which one it is holding.
 */
export interface CareerDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: CareerStores;
  readonly employment: EmploymentPort;
  readonly organization: OrganizationPort;
  readonly learning: LearningPort;
  readonly permissions: PermissionChecker;
  readonly clock: Clock;
}
