/**
 * Shared Kernel.
 *
 * The abstractions every module builds on. Nothing here knows what an employee is: the kernel
 * carries no business concept, no tenant rule and no HR vocabulary, and it must stay that way
 * or every module inherits the first leak.
 *
 * Phase 1, in progress. Delivered so far: results and domain exceptions, time-ordered
 * identifiers, calendar-aware dates, money, service periods, and tenant context. Still to come:
 * Entity and AggregateRoot, domain events and the dispatcher, repositories and Unit of Work,
 * the CQRS pipeline, the rule engine, effective dating and timeline projections.
 */

export { all, err, flatMap, isErr, isOk, map, ok, unwrap } from './result/result.js';
export type { Result } from './result/result.js';

export {
  ConcurrencyException,
  DomainException,
  TenantIsolationException,
} from './errors/domain-exception.js';

export { isUuidV7, timestampOf, uuidV7 } from './identity/uuid-v7.js';

export {
  assertBelongsToCurrentTenant,
  currentContext,
  currentTenantId,
  isSystemContext,
  runInContext,
} from './tenancy/tenant-context.js';
export type { ExecutionContext, SystemContext, TenantContext } from './tenancy/tenant-context.js';

export { formatCalendarDate, fromHijri, toGregorian, toHijri, toInstant } from './time/calendar.js';
export type { CalendarDate, CalendarSystem } from './time/calendar.js';

export { formatServicePeriod, serviceBetween } from './time/service-period.js';
export type { ServicePeriod } from './time/service-period.js';

export { Money } from './money/money.js';
export type { Currency, Rounding } from './money/money.js';

export type {
  EmailMessage,
  EmailPort,
  FeatureContext,
  FeatureFlagPort,
  JobPort,
  JobRequest,
  SearchDocument,
  SearchPort,
  SearchQuery,
  SearchResult,
  StoragePort,
} from './ports/index.js';
