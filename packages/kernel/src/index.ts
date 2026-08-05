/**
 * Shared Kernel.
 *
 * Phase 1 implements Entity, AggregateRoot, ValueObject, DomainEvent, Repository, UnitOfWork,
 * Specification, Result, Money, BusinessDate and calendar conversion, ServicePeriod, the
 * approval, notification and document ports, and the rule engine.
 *
 * Phase 0 contributes the infrastructure ports below as interfaces only, so that no later phase
 * is tempted to reach for a provider directly while waiting for an abstraction to exist.
 */
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
