/**
 * Compensation Management — what an employment is entitled to receive.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may depend
 * on, the composition pieces the API needs to wire the module up, and nothing else. Aggregates,
 * repositories and handlers stay internal.
 *
 * **Employment says somebody is employed. Compensation says what they are entitled to. Payroll says
 * what is actually paid for a period.** The two cross-module ports are exported as *types only*:
 * the composition root implements `EmploymentDirectoryPort` against Employment and
 * `OrganizationDirectoryPort` against Organization, each under a bounded service grant (ADR-0043)
 * — which is what keeps employment-register and organizational permissions off every compensation
 * administrator's role, and what stops this module from ever importing another module's internals.
 *
 * **Nothing here computes a payment.** No gross, no net, no tax, no social security, no overtime
 * pay, no unpaid-leave deduction, no arrears, no end-of-service and no currency conversion. Payroll
 * consumes `compensation.payroll-period` — a set-based read of facts and flags — and reconciles
 * through `compensation.changed-since`, which is a **pull**: if every event this module raises were
 * dropped, a payroll run would still find every change.
 *
 * `organizationUnavailable` is exported and it is the honest adapter for a composition without
 * Organization: it answers "nobody can be asked" rather than inventing a legal entity and a
 * currency.
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { compensationModule } from './application/compensation-module.js';
export {
  ALL_COMPENSATION_PERMISSIONS,
  CompensationPermissions,
} from './application/compensation-permissions.js';
export type { CompensationPermission } from './application/compensation-permissions.js';
export { organizationUnavailable, systemClock } from './application/cross-module-ports.js';
export type {
  Clock,
  EmploymentDirectoryPort,
  EmploymentForCompensation,
  GoverningEntity,
  LegalEntityForCompensation,
  OrganizationDirectoryPort,
} from './application/cross-module-ports.js';
export type { CompensationStores } from './application/compensation-ports.js';
export type { CompensationDependencies } from './application/compensation-dependencies.js';
export { postgresCompensationStores } from './infrastructure/compensation-stores.js';

/**
 * The two published Payroll reads, exported so a caller outside the HTTP edge can send them.
 *
 * `compensation.payroll-period` is the set-based contract Phase 11 consumes.
 * `compensation.changed-since` is the reconciliation pull that makes Payroll's correctness
 * independent of event delivery (ADR-0058).
 */
export { MAX_PERIOD_EMPLOYMENTS } from './application/payroll-query.js';
export type { PayrollPeriodView, ReadPayrollPeriod } from './application/payroll-query.js';
export type {
  ReadChangedSince,
  ReadCompensationDashboard,
} from './application/reconciliation-query.js';

// Transport — the controllers the API mounts.
export { CompensationDispatcher } from './api/compensation-dispatcher.js';
export { CompensationPayrollController } from './api/payroll.controller.js';
export { CompensationRecordController } from './api/record.controller.js';
export { CompensationApprovalController } from './api/approval.controller.js';
export { CompensationStructureController } from './api/structure.controller.js';
export { EmploymentCompensationController } from './api/employment.controller.js';
export { CompensationPlanController } from './api/plan.controller.js';
export { CompensationComponentController } from './api/component.controller.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's endpoint
 * tests need the same stores and the same cross-module fakes this module's own tests use, and a
 * fake duplicated in two packages is a fake that will drift from the real thing in one of them.
 */
export { inMemoryCompensationStores } from './application/in-memory-definitions.js';
export {
  FakeEmployment,
  FakeOrganization,
  FixedClock,
} from './application/compensation-test-harness.js';
