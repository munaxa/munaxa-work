import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import { recordEventHandler } from './ingest.use-case.js';
import { recalculateHandler } from './recalculate.use-case.js';
import { daysAwaitingRecalculationHandler } from './reconciliation-query.js';
import { approveDayHandler, resolveExceptionHandler, reviewDayHandler } from './day.use-case.js';
import {
  decideCorrectionHandler,
  requestCorrectionHandler,
  withdrawCorrectionHandler,
} from './correction.use-case.js';
import { addSegmentHandler, defineShiftHandler, publishShiftHandler } from './shift.use-case.js';
import {
  defineScheduleHandler,
  placeShiftHandler,
  publishScheduleHandler,
} from './schedule.use-case.js';
import { assignScheduleHandler, endAssignmentHandler } from './assignment.use-case.js';
import { definePolicyHandler, publishPolicyHandler, rosterHandler } from './roster.use-case.js';
import { freezePeriodHandler } from './snapshot.use-case.js';
import { exportAttendanceHandler, importEventsHandler } from './transfer.use-case.js';
import {
  readDashboardHandler,
  readDayHandler,
  readSnapshotsHandler,
  searchDaysHandler,
  searchEventsHandler,
  searchExceptionsHandler,
} from './attendance-queries.js';
import {
  listImportsHandler,
  listSchedulesHandler,
  listShiftsHandler,
  readRosterHandler,
  searchCorrectionsHandler,
} from './definition-queries.js';
import { ALL_ATTENDANCE_PERMISSIONS, AttendancePermissions } from './attendance-permissions.js';
import type { CommandSender } from './transfer.use-case.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * The module's declaration: what Attendance offers, in one place, so the registry can derive
 * everything else — permissions, navigation, health.
 *
 * The `sender` parameter is what import needs, and it is a parameter rather than something taken
 * from a container because the dispatcher it will use is built *from this list*. Passing a deferred
 * sender keeps the module a plain declaration instead of a graph with a cycle in it.
 */
export const attendanceModule = (
  dependencies: AttendanceDependencies,
  sender: CommandSender,
): WorkModule => ({
  name: 'attendance',

  commands: commandsOf(dependencies, sender),

  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'attendance.daily',
      path: '/attendance',
      permission: AttendancePermissions.read,
      order: 40,
    },
  ],

  // The read permissions no handler declares alone are stated here too, so the administration
  // screen offers the whole set rather than the subset that happens to be a handler's own.
  permissions: ALL_ATTENDANCE_PERMISSIONS,
});

const commandsOf = (
  dependencies: AttendanceDependencies,
  sender: CommandSender,
): readonly CommandHandler<Command, unknown>[] =>
  [
    recordEventHandler(dependencies),
    recalculateHandler(dependencies),

    reviewDayHandler(dependencies),
    approveDayHandler(dependencies),
    resolveExceptionHandler(dependencies),

    requestCorrectionHandler(dependencies),
    decideCorrectionHandler(dependencies),
    withdrawCorrectionHandler(dependencies),

    defineShiftHandler(dependencies),
    addSegmentHandler(dependencies),
    publishShiftHandler(dependencies),

    defineScheduleHandler(dependencies),
    placeShiftHandler(dependencies),
    publishScheduleHandler(dependencies),
    assignScheduleHandler(dependencies),
    endAssignmentHandler(dependencies),

    rosterHandler(dependencies),
    definePolicyHandler(dependencies),
    publishPolicyHandler(dependencies),

    freezePeriodHandler(dependencies),
    importEventsHandler(dependencies, sender),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: AttendanceDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    searchDaysHandler(dependencies),
    readDayHandler(dependencies),
    searchEventsHandler(dependencies),
    searchExceptionsHandler(dependencies),
    readSnapshotsHandler(dependencies),
    readDashboardHandler(dependencies),
    daysAwaitingRecalculationHandler(dependencies),
    exportAttendanceHandler(dependencies),

    listShiftsHandler(dependencies),
    listSchedulesHandler(dependencies),
    readRosterHandler(dependencies),
    searchCorrectionsHandler(dependencies),
    listImportsHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
