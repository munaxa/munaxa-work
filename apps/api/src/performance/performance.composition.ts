import {
  RecordingNotificationPort,
  currentContext,
  type PermissionChecker,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';
import { performanceModule, postgresPerformanceStores } from '@work/performance';
import { systemClock } from '@work/payroll';

import type { DeferredPayrollDispatcher } from '../payroll/payroll.composition.js';
import {
  PerformanceDocuments,
  PerformanceEmployment,
  PerformanceNotifications,
  PerformanceOrganization,
} from './performance-sources.js';

/**
 * Performance's composition: four cross-module adapters, the PostgreSQL stores, and a notification
 * port that records and delivers nothing.
 *
 * `RecordingNotificationPort` is not a fake and not a stub. A fake would claim delivery; this
 * records the intent and says nothing about whether anybody was told, which is the difference
 * between "the capability is not wired" and "the capability is broken". It is what the kernel
 * provides, and nothing in this repository delivers a notification.
 *
 * **There is no People, Compensation or Payroll adapter.** A review carries an employment, a screen
 * that wants a name asks People, and a performance review must not display a salary — so there is
 * no port to wire and no grant that would permit one.
 *
 * `systemClock` comes from `@work/payroll` because it is the only exported system clock in the
 * repository and every module that needs one already uses it. Duplicating it per module is how two
 * clocks come to disagree.
 */
export const performanceModuleFor = (
  unitOfWork: UnitOfWork,
  dispatcher: DeferredPayrollDispatcher,
  permissions: PermissionChecker,
): WorkModule => {
  const notifications = new RecordingNotificationPort();

  return performanceModule({
    unitOfWork,
    stores: postgresPerformanceStores(),
    employment: new PerformanceEmployment(dispatcher),
    organization: new PerformanceOrganization(dispatcher),
    documents: new PerformanceDocuments(dispatcher),
    notifications: new PerformanceNotifications(
      (request) => notifications.notify(request),
      () => currentContext()?.correlationId ?? 'unknown',
    ),
    permissions,
    clock: systemClock,
  });
};
