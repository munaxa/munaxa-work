import { Module } from '@nestjs/common';
import {
  AttendanceController,
  AttendanceCorrectionController,
  AttendanceDayController,
  AttendanceDispatcher,
  AttendanceRosterController,
  AttendanceScheduleController,
  AttendanceShiftController,
  AttendanceTransferController,
} from '@work/attendance';
import { Dispatcher } from '@work/kernel';

import { DISPATCHER } from '../identity/identity.tokens.js';
import { IdentityModule } from '../identity/identity.module.js';

/**
 * Attendance's transport, dispatching through the pipeline the identity module assembled.
 *
 * The registry and the dispatcher are shared across modules deliberately: permissions, navigation
 * and health are derived from *every* registered module, so a second dispatcher would give the
 * administration screen a fraction of the permissions. What is not shared is the transport — a
 * module owns its own controllers.
 *
 * The module's *composition* lives in `attendance.composition.ts` rather than here, because the
 * identity module's composition registers Attendance on the shared registry while this file imports
 * the identity module to reach the dispatcher. Keeping both in one file would make those two facts
 * a cycle — the same shape every module before it has.
 */
@Module({
  imports: [IdentityModule],
  // Order matters, and it is load-bearing rather than cosmetic. Every controller here claims the
  // bare `/attendance` prefix, and Nest resolves a route by the order its controllers were
  // declared. The literal segments — `imports`, `roster`, `shifts`, `schedules`, `corrections`,
  // `exceptions` — come first, and the main controller declares
  // `days/:employmentId/:attendanceDate` last, because a two-segment pattern would otherwise
  // swallow `days/:attendanceDayId/approval`.
  controllers: [
    AttendanceTransferController,
    AttendanceRosterController,
    AttendanceShiftController,
    AttendanceScheduleController,
    AttendanceCorrectionController,
    AttendanceDayController,
    AttendanceController,
  ],
  providers: [
    {
      provide: AttendanceDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): AttendanceDispatcher =>
        new AttendanceDispatcher(dispatcher),
    },
  ],
})
export class AttendanceModule {}
