/**
 * Employee Relations & Disciplinary — Phase 5.2, Checkpoint 1.
 *
 * **What this module holds:** the tenant's violation catalogue, and the violations recorded against
 * an employment. Records are immutable at the database and every read of one is audited.
 *
 * **What it deliberately does not hold, yet:** investigations, disciplinary actions, warnings,
 * grievances, appeals, evidence, penalties and termination recommendations. Each arrives with the
 * checkpoint that builds it; none is stubbed, flagged or half-modelled here, because a table nothing
 * writes is worse than no table (ADR-0070).
 *
 * **What it will never hold:** a person. It references Employment and never People (AD-001), it
 * resolves no manager, and it publishes no name.
 */

export * from './contracts/index.js';
export * from './contracts/views.js';

export { relationsModule } from './application/relations-module.js';
export {
  ALL_RELATIONS_PERMISSIONS,
  RelationsPermissions,
  type RelationsPermission,
} from './application/relations-permissions.js';
export type { RelationsDependencies } from './application/relations-dependencies.js';
export type {
  AccessEventStore,
  Clock,
  EmploymentDirectoryPort,
  Page,
  Paged,
  RelationsStores,
  ViolationCategoryStore,
  ViolationStore,
} from './application/relations-ports.js';
export { inMemoryRelationsStores } from './application/in-memory-stores.js';
export type { InMemoryRelationsStores } from './application/in-memory-stores.js';

export { postgresRelationsStores } from './infrastructure/relations-stores.js';

export { RelationsDispatcher } from './api/relations-dispatcher.js';
export { ViolationCategoryController } from './api/violation-category.controller.js';
export { ViolationController } from './api/violation.controller.js';

export type {
  AmendViolationCategoryCommand,
  DefineViolationCategoryCommand,
  ViolationCategoryDefined,
} from './application/violation-category.use-case.js';
export type {
  RecordViolationCommand,
  ViolationRecorded,
} from './application/violation.use-case.js';
export type {
  ListViolationCategories,
  ListViolationsForEmployment,
  ReadViolation,
} from './application/relations-queries.js';

export {
  ACCESS_ACTIONS,
  COUNTRY_PACK_SOURCES,
  VIOLATION_STATES,
} from './domain/relations-vocabulary.js';
export type {
  AccessAction,
  CountryPackSource,
  ViolationState,
} from './domain/relations-vocabulary.js';
