import {
  RecordingNotificationPort,
  currentContext,
  type PermissionChecker,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';
import { learningModule, postgresLearningStores } from '@work/learning';
import { systemClock } from '@work/payroll';

import type { Asking } from '../payroll/asking.js';
import {
  LearningDocuments,
  LearningEmployment,
  LearningNotifications,
  LearningOrganization,
} from './learning-sources.js';

/**
 * Learning's composition: four cross-module adapters, the PostgreSQL stores, and a notification
 * port that records and delivers nothing.
 *
 * `RecordingNotificationPort` is not a fake and not a stub. A fake would claim delivery; this
 * records the intent and says nothing about whether anybody was told, which is the difference
 * between "the capability is not wired" and "the capability is broken". It is what the kernel
 * provides, and nothing in this repository delivers a notification.
 *
 * **There is no People, Performance or Job adapter.** A training record carries an employment, a
 * screen that wants a name asks People, course completion does not imply a competency (AD-002), and
 * nothing in this repository can make anything happen on a Tuesday (ADR-0071). There is no port to
 * wire and no grant that would permit one.
 *
 * `systemClock` comes from `@work/payroll` because it is the only exported system clock in the
 * repository and every module that needs one already uses it. Duplicating it per module is how two
 * clocks come to disagree — and in this module a disagreeing clock is a certificate reported expired
 * on the wrong day.
 */
export const learningModuleFor = (
  unitOfWork: UnitOfWork,
  // `Asking` rather than the deferred dispatcher class: the four adapters read and none of them
  // writes, so a parameter that could `send` would be authority this module has no use for. The
  // composition root's `DeferredPayrollDispatcher` satisfies it unchanged.
  dispatcher: Asking,
  permissions: PermissionChecker,
): WorkModule => {
  const notifications = new RecordingNotificationPort();

  return learningModule({
    unitOfWork,
    stores: postgresLearningStores(),
    employment: new LearningEmployment(dispatcher),
    organization: new LearningOrganization(dispatcher),
    documents: new LearningDocuments(dispatcher),
    notifications: new LearningNotifications(
      (request) => notifications.notify(request),
      () => currentContext()?.correlationId ?? 'unknown',
    ),
    permissions,
    clock: systemClock,
  });
};
