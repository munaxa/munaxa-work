/**
 * Shared Kernel.
 *
 * Phase 1 implements Entity, AggregateRoot, ValueObject, DomainEvent, Repository, UnitOfWork,
 * Specification, Result, Money, BusinessDate and calendar conversion, ServicePeriod, the
 * approval, notification and document ports, and the rule engine.
 *
 * Bootstrapped here so that the package, its build and its place in the project references
 * graph are proven before anything depends on them. It deliberately exports nothing yet.
 */
export {};
