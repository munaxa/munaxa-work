/**
 * Attendance — the record of when people actually worked.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may depend
 * on, the composition pieces the API needs to wire the module up, and nothing else. Aggregates,
 * repositories and handlers stay internal.
 *
 * The two cross-module ports are exported as **types only**. The composition root implements
 * `EmploymentDirectoryPort` against Employment under a bounded service grant (ADR-0043), which is
 * what keeps employment-register permissions off every attendance administrator's role — and what
 * stops this module from ever importing another module's internals.
 *
 * `leaveUnavailable` is exported and it is the adapter this repository actually has. It answers
 * "nobody can be asked", honestly, because there is no Leave module here yet. A stub that answered
 * "no leave approved" would turn every unexplained absence into an absence *without leave* on
 * somebody's record (ADR-0056).
 *
 * Note what is absent from `EmploymentDirectoryPort`: no `create`, no `update`, no `personId`.
 * Attendance references an employment and copies no fact from it (ADR-0051).
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { attendanceModule } from './application/attendance-module.js';
export {
  ALL_ATTENDANCE_PERMISSIONS,
  AttendancePermissions,
} from './application/attendance-permissions.js';
export type { AttendancePermission } from './application/attendance-permissions.js';
export { leaveUnavailable, systemClock } from './application/cross-module-ports.js';
export type { AttendanceStores } from './application/attendance-ports.js';
export type {
  ApprovedLeaveDay,
  Clock,
  EmploymentDirectoryPort,
  EmploymentForAttendance,
  LeaveCoverage,
  LeaveDirectoryPort,
} from './application/cross-module-ports.js';
export type { AttendanceDependencies } from './application/attendance-dependencies.js';
export type { CommandSender } from './application/transfer.use-case.js';
export { postgresAttendanceStores } from './infrastructure/attendance-stores.js';

/**
 * The ingestion command's shape, exported so a caller outside the HTTP edge can send it.
 *
 * A device adapter, a mobile sync endpoint and an import all send this same command, and doing so
 * changes nothing about the guarantee: it is idempotent, so a duplicate submission costs a read and
 * a submission that never arrives is found by the reconciliation query instead (ADR-0053).
 */
export type { EventRecorded, RecordEventCommand } from './application/ingest.use-case.js';
export type {
  RecalculateCommand,
  RecalculationOutcome,
} from './application/recalculate.use-case.js';
export type { AwaitingRecalculationView } from './application/reconciliation-query.js';

/**
 * The working-day read Leave consumes, and the reconciliation Attendance runs against Leave.
 *
 * Both are Phase 9 additions and both keep the dependency pointing one way: Attendance publishes
 * what it knows about a working pattern, and Attendance *pulls* leave changes rather than Leave
 * pushing them. Leave never writes an Attendance row (ADR-0058).
 */
export type {
  ExpectedWorkingDayView,
  ExpectedWorkingDays,
  ExpectedWorkingDaysView,
} from './application/working-day-query.js';
export type {
  LeaveReconciliationOutcome,
  ReconcileLeaveCommand,
} from './application/leave-reconciliation.use-case.js';
export type { AttendanceExport } from './application/transfer.use-case.js';

// Transport — the controllers the API mounts.
export { AttendanceDispatcher } from './api/attendance-dispatcher.js';
export { AttendanceController } from './api/attendance.controller.js';
export { AttendanceDayController } from './api/day.controller.js';
export { AttendanceCorrectionController } from './api/correction.controller.js';
export { AttendanceShiftController } from './api/shift.controller.js';
export { AttendanceScheduleController } from './api/schedule.controller.js';
export { AttendanceRosterController } from './api/roster.controller.js';
export { AttendanceTransferController } from './api/transfer.controller.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's endpoint
 * tests need the same stores and the same cross-module fakes this module's own tests use, and a
 * fake duplicated in two packages is a fake that will drift from the real thing in one of them.
 */
export { inMemoryAttendanceStores } from './application/in-memory-definitions.js';
