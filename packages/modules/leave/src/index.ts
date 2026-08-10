/**
 * Leave & Absence Management — the authorization to be absent.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may depend
 * on, the composition pieces the API needs to wire the module up, and nothing else. Aggregates,
 * repositories and handlers stay internal.
 *
 * **Leave explains authorized absence. Attendance records what happened. Payroll decides what it
 * costs.** The two cross-module ports are exported as *types only*: the composition root implements
 * `EmploymentDirectoryPort` against Employment and `WorkingDayPort` against Attendance, each under
 * a bounded service grant (ADR-0043) — which is what keeps employment-register and attendance
 * permissions off every leave administrator's role, and what stops this module from ever importing
 * another module's internals.
 *
 * **Nothing here writes to Attendance.** Attendance depends on Leave, so a Leave-to-Attendance
 * write would close a dependency cycle. Attendance discovers a leave change on its own
 * reconciliation run through `leave.approved-leave-affecting`, which this module publishes as a
 * *read*.
 *
 * `workingDaysUnavailable` is exported and it is the honest adapter for a composition without
 * Attendance: it answers "nobody can be asked", and a `working_days` request against it is refused
 * by name rather than silently counted as calendar days.
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { leaveModule } from './application/leave-module.js';
export { ALL_LEAVE_PERMISSIONS, LeavePermissions } from './application/leave-permissions.js';
export type { LeavePermission } from './application/leave-permissions.js';
export { systemClock, workingDaysUnavailable } from './application/leave-ports.js';
export type {
  Clock,
  EmploymentDirectoryPort,
  EmploymentForLeave,
  LeaveStores,
  WorkingDay,
  WorkingDayPort,
  WorkingDays,
} from './application/leave-ports.js';
export type { LeaveDependencies } from './application/leave-dependencies.js';
export { postgresLeaveStores } from './infrastructure/leave-stores.js';

/**
 * The two published cross-module reads, exported so a caller outside the HTTP edge can send them.
 *
 * `leave.approved-leave-for` is what Attendance's leave adapter calls on every recalculation.
 * `leave.approved-leave-affecting` is the incremental form Attendance's reconciliation uses to find
 * what has moved since it last looked.
 */
export type {
  ApprovedLeaveAffecting,
  ApprovedLeaveDayView,
  ApprovedLeaveFor,
  ApprovedLeaveView,
} from './application/directory-queries.js';
export type { AwaitingRecalculationView } from './application/reconciliation-query.js';

/**
 * The Payroll read, exported so Payroll's adapter can type the query it sends rather than casting
 * an object literal to a bare `Query` — the discipline the Phase 8 defect taught.
 */
export type {
  LeavePayrollPeriodPage,
  ReadLeavePayrollPeriod,
} from './application/payroll-period-query.js';
export type {
  RecalculateBalancesCommand,
  RecalculationOutcome,
} from './application/recalculate.use-case.js';

// Transport — the controllers the API mounts.
export { LeaveDispatcher } from './api/leave-dispatcher.js';
export { LeaveTypeController } from './api/type.controller.js';
export { LeavePolicyController } from './api/policy.controller.js';
export { LeaveBalanceController } from './api/balance.controller.js';
export { LeaveRequestController } from './api/request.controller.js';
export { LeaveDecisionController } from './api/decision.controller.js';
export { LeaveAdministrationController } from './api/administration.controller.js';
export { LeaveRunController } from './api/run.controller.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's endpoint
 * tests need the same stores and the same cross-module fakes this module's own tests use, and a
 * fake duplicated in two packages is a fake that will drift from the real thing in one of them.
 */
export { inMemoryLeaveStores } from './application/in-memory-definitions.js';
export { FakeAttendance, FakeEmployment, FixedClock } from './application/leave-test-harness.js';
