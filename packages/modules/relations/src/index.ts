/**
 * Employee Relations & Disciplinary — Phase 5.2, Checkpoints 1 and 2.
 *
 * **What this module holds:** the tenant's violation catalogue, the violations recorded against an
 * employment, the inquiries into them, and the case lifecycle those inquiries move. Violations and
 * case history are immutable at the database, an investigation becomes immutable the moment it
 * concludes, and every read of any of them is audited.
 *
 * **Where a case is, is derived and never stored** (D-5.2-16): it is the latest transition's
 * destination, and there is no state column anywhere that could disagree with the history.
 *
 * **What it deliberately does not hold, yet:** disciplinary actions, warnings, grievances, appeals,
 * evidence, penalties and termination recommendations. Each arrives with the checkpoint that builds
 * it; none is stubbed, flagged or half-modelled here, because a table nothing writes is worse than no
 * table (ADR-0070). The lifecycle vocabulary lists the three states this module can actually reach
 * and not the specification's twelve, for the same reason.
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
  CaseEventStore,
  Clock,
  EmploymentDirectoryPort,
  InvestigationStore,
  MembershipDirectoryPort,
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
export { CaseHistoryController, InvestigationController } from './api/investigation.controller.js';

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
  ConcludeInvestigationCommand,
  InvestigationConcluded,
  InvestigationOpened,
  OpenInvestigationCommand,
} from './application/investigation.use-case.js';
export type {
  ListInvestigations,
  ListViolationCategories,
  ListViolationsForEmployment,
  ReadCaseHistory,
  ReadInvestigation,
  ReadViolation,
} from './application/relations-queries.js';

export {
  ACCESS_ACTIONS,
  CASE_STATES,
  COUNTRY_PACK_SOURCES,
  INITIAL_CASE_STATE,
  INVESTIGATION_STATES,
  PERMITTED_CASE_TRANSITIONS,
  VIOLATION_STATES,
  permitsTransition,
} from './domain/relations-vocabulary.js';
export type {
  AccessAction,
  CaseState,
  CountryPackSource,
  InvestigationState,
  ViolationState,
} from './domain/relations-vocabulary.js';
