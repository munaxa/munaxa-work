import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type {
  Clock,
  DocumentReferencePort,
  EmploymentPort,
  LearningStores,
  NotificationIntentPort,
  OrganizationPort,
} from './learning-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Four ports and no more.** Learning confirms an employment and resolves a rule's audience
 * through a published contract, confirms a unit exists through another, confirms an evidence
 * document exists through a third, and records a notification intent through a fourth that delivers
 * nothing.
 *
 * There is no `JobPort` (nothing is scheduled — ADR-0071), no `StoragePort` (nothing holds bytes),
 * no People port (a training record carries an employment, and a name belongs to People) and no
 * Performance port (AD-002: course completion does not imply competency, and Performance reads
 * Learning rather than the other way round). Declaring any of them would imply this module could
 * use it.
 *
 * `permissions` is here because authorization in this module is not a single gate at the edge. A
 * caller holding `assignment.read-all` and one holding `assignment.read-team` take different paths
 * through the same query, and the handler has to *ask* which one it is holding.
 */
export interface LearningDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: LearningStores;
  readonly employment: EmploymentPort;
  readonly organization: OrganizationPort;
  readonly documents: DocumentReferencePort;
  readonly notifications: NotificationIntentPort;
  readonly permissions: PermissionChecker;
  readonly clock: Clock;
}
