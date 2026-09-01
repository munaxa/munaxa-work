/**
 * Employment — the relationship between a person and the tenant's workforce.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may depend
 * on, the composition pieces the API needs to wire the module up, and nothing else. Aggregates,
 * repositories and handlers stay internal.
 *
 * That matters more here than in any module before it. Every later phase — attendance, leave,
 * payroll, benefits, performance, offboarding — consumes Employment, so this boundary is the one
 * that has to hold longest, and a consumer that reached past it would be a consumer this module can
 * never change.
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { employmentModule } from './application/employment-module.js';
export {
  EmploymentPermissions,
  ALL_EMPLOYMENT_PERMISSIONS,
} from './application/employment-permissions.js';
export type { EmploymentPermission } from './application/employment-permissions.js';
export { systemClock } from './application/employment-ports.js';
export type {
  Clock,
  EmployablePerson,
  EmploymentStores,
  OrganizationDirectoryPort,
  PersonDirectoryPort,
} from './application/employment-ports.js';
export type { EmploymentDependencies } from './application/employment-dependencies.js';
export type { CommandSender } from './application/transfer.use-case.js';
export { EXPORT_LIMIT, IMPORT_LIMIT } from './application/transfer.use-case.js';
export { postgresEmploymentStores } from './infrastructure/employment-stores.js';

/**
 * The adapter that closes the Phase 4 debt item "the establishment's filled count is always zero".
 *
 * It implements Organization's `FilledHeadcountPort`, so the composition root swaps it for
 * `NoAssignmentsYet` and no Organization code changes — which is the evidence that port was drawn
 * in the right place.
 */
export {
  AssignmentFilledHeadcount,
  assignmentFilledHeadcount,
} from './infrastructure/filled-headcount.js';

// Transport — the controllers the API mounts.
export { EmploymentDispatcher } from './api/employment-dispatcher.js';
export { EmploymentsController } from './api/employments.controller.js';
export { EmploymentLifecycleController } from './api/employment-lifecycle.controller.js';
export { AssignmentsController } from './api/assignments.controller.js';
export { ReportingLineController } from './api/reporting-line.controller.js';
export { ContractsController } from './api/contracts.controller.js';
export { EmploymentHistoryController } from './api/employment-history.controller.js';
export { TransferController } from './api/transfer.controller.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's endpoint
 * tests need the same stores and the same cross-module fakes this module's own tests use, and a
 * fake duplicated in two packages is a fake that will drift from the real thing in one of them.
 */
export { inMemoryEmploymentStores } from './application/in-memory-stores.js';
