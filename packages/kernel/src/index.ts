/**
 * Shared Kernel.
 *
 * The abstractions every module builds on. Nothing here knows what an employee is: the kernel
 * carries no business concept, no tenant rule and no HR vocabulary, and it must stay that way
 * or every module inherits the first leak.
 */

// Results and failures
export { all, err, flatMap, isErr, isOk, map, ok, unwrap } from './result/result.js';
export type { Result } from './result/result.js';
export {
  ConcurrencyException,
  DomainException,
  TenantIsolationException,
} from './errors/domain-exception.js';

// Identity
export { isUuidV7, timestampOf, uuidV7 } from './identity/uuid-v7.js';

// Tenancy
export {
  assertBelongsToCurrentTenant,
  currentContext,
  currentTenantId,
  isSystemContext,
  runInContext,
} from './tenancy/tenant-context.js';
export type { ExecutionContext, SystemContext, TenantContext } from './tenancy/tenant-context.js';

// Domain building blocks
export { AggregateRoot, Entity, ValueObject } from './domain/entity.js';
export { createDomainEvent } from './domain/domain-event.js';
export type { DomainEvent, EventOrigin, EventSubject } from './domain/domain-event.js';
export { InProcessEventDispatcher } from './domain/in-process-dispatcher.js';
export { Specification, specify } from './specification/specification.js';

// Persistence contracts
export type {
  EventDispatcher,
  EventHandler,
  Transaction,
  TransactionalWork,
  UnitOfWork,
} from './persistence/unit-of-work.js';

// Values
export { Money } from './money/money.js';
export type { Currency, Rounding } from './money/money.js';
export { Quantity } from './value/quantity.js';
export { DateRange } from './value/date-range.js';
export { LocalizedText } from './value/localized-text.js';
export { isDeleted } from './value/audit.js';
export type { AuditInformation, VersionInformation } from './value/audit.js';
export { cursorResult, pagedResult } from './paging/paged-result.js';
export type { CursorResult, PagedResult } from './paging/paged-result.js';

// Time
export { formatCalendarDate, fromHijri, toGregorian, toHijri, toInstant } from './time/calendar.js';
export type { CalendarDate, CalendarSystem } from './time/calendar.js';
export { formatServicePeriod, serviceBetween } from './time/service-period.js';
export type { ServicePeriod } from './time/service-period.js';

// Effective dating
export { Timeline } from './effective/effective-dated.js';
export type { EffectiveDated, TimelineEntry } from './effective/effective-dated.js';

// Rules
export { evaluateRule, versionInForce } from './rules/rule-engine.js';
export type {
  ComparisonOperator,
  Condition,
  ConditionGroup,
  Evaluation,
  EvaluationError,
  EvaluationTrace,
  FactValue,
  Facts,
  RuleDefinition,
} from './rules/rule-engine.js';

// CQRS
export { Dispatcher, rejected, success } from './cqrs/pipeline.js';
export type {
  Command,
  CommandHandler,
  HandlerFailure,
  PermissionChecker,
  Query,
  QueryHandler,
  ValidationFailure,
} from './cqrs/pipeline.js';

// Projections
export { project, verifyRebuild } from './projection/projection.js';
export type { Projection, ProjectionCheckpoint } from './projection/projection.js';

// Modules
export { ModuleRegistry } from './module/module-registry.js';
export type {
  ModuleHealth,
  ModuleRegistration,
  NavigationEntry,
  WorkModule,
} from './module/module-registry.js';

// Localization
export { Translator, directionOf } from './localization/catalogue.js';
export type { Catalogue, LocaleSettings } from './localization/catalogue.js';

// Ports — infrastructure (Phase 0) and the three that precede their engines (ADR-0024)
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
export type {
  ApprovalDecided,
  ApprovalDecidedEvent,
  ApprovalPort,
  ApprovalRequest,
  ApprovalState,
  ApprovalStatus,
  ApprovalStep,
} from './ports/approval.js';
export type {
  NotificationPort,
  NotificationRecipient,
  NotificationRequest,
} from './ports/notification.js';
export type { DocumentAttachment, DocumentPort, DocumentReference } from './ports/document.js';
export { UnauthenticatedPort } from './ports/authentication.js';
export type {
  PlatformAuthenticationPort,
  PlatformPrincipal,
  PresentedCredentials,
} from './ports/authentication.js';
export { AutoApprovingPort, RecordingNotificationPort } from './adapters/in-process-ports.js';
export { InMemoryFeatureFlags } from './adapters/in-memory-feature-flags.js';
export type { FeatureFlagDefinition } from './adapters/in-memory-feature-flags.js';
