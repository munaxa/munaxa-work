import { success, type Command, type CommandHandler } from '@work/kernel';

import { Schedule, scheduleDay } from '../domain/schedule.js';

import {
  conflicted,
  currentActor,
  currentTenant,
  notFound,
  refusedBy,
} from './attendance-context.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * Defining a schedule, placing shifts in its cycle, and publishing it.
 *
 * Putting somebody *on* a schedule is next door in `assignment.use-case.ts`: assigning is an
 * operational act with a date on it and consequences for days already calculated, where the three
 * here are configuration. The split is the same one the permissions make.
 */

export interface ScheduleAffected {
  readonly scheduleId: string;
  readonly code: string;
  readonly status: string;
}

export interface DefineScheduleCommand extends Command {
  readonly commandName: 'attendance.define-schedule';
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  /** Required. A schedule's wall-clock times are meaningless without it (ADR-0055). */
  readonly zone: string;
  readonly cycleLengthDays: number;
  readonly cycleAnchorDate: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export const defineScheduleHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<DefineScheduleCommand, ScheduleAffected> => ({
  commandName: 'attendance.define-schedule',
  permission: AttendancePermissions.scheduleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.schedules.byCode(transaction, command.code);

      if (existing !== undefined) return conflicted('schedule_code_taken');

      const schedule = Schedule.define(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!schedule.ok) return refusedBy(schedule.error);

      await dependencies.stores.schedules.insert(transaction, schedule.value.snapshot());
      return success({
        scheduleId: schedule.value.id,
        code: command.code,
        status: schedule.value.status,
      });
    }),
});

export interface PlaceShiftCommand extends Command {
  readonly commandName: 'attendance.place-shift';
  readonly scheduleId: string;
  readonly cyclePosition: number;
  readonly shiftId: string;
}

/** Putting a shift at a position in the cycle. A position left empty is a rest day. */
export const placeShiftHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<PlaceShiftCommand, ScheduleAffected> => ({
  commandName: 'attendance.place-shift',
  permission: AttendancePermissions.scheduleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.schedules.byId(transaction, command.scheduleId);

      if (state === undefined) return notFound<ScheduleAffected>('schedule');
      if (state.status !== 'draft') return conflicted('schedule_not_draft');

      const shift = await dependencies.stores.shifts.byId(transaction, command.shiftId);

      if (shift === undefined) return notFound<ScheduleAffected>('shift');
      // A draft shift in a schedule about to be published is a rota whose hours can still change
      // under the people working it.
      if (shift.status !== 'published') return conflicted('shift_not_published');

      const day = scheduleDay(
        {
          tenantId: currentTenant(),
          scheduleId: command.scheduleId,
          cyclePosition: command.cyclePosition,
          shiftId: command.shiftId,
          cycleLengthDays: state.cycleLengthDays,
        },
        dependencies.clock.now(),
      );

      if (!day.ok) return refusedBy(day.error);

      await dependencies.stores.scheduleDays.insert(transaction, day.value);
      return success({ scheduleId: state.id, code: state.code, status: state.status });
    }),
});

export interface PublishScheduleCommand extends Command {
  readonly commandName: 'attendance.publish-schedule';
  readonly scheduleId: string;
  readonly expectedVersion: number;
}

export const publishScheduleHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<PublishScheduleCommand, ScheduleAffected> => ({
  commandName: 'attendance.publish-schedule',
  permission: AttendancePermissions.schedulePublish,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.schedules.byId(transaction, command.scheduleId);

      if (state === undefined) return notFound<ScheduleAffected>('schedule');

      const days = await dependencies.stores.scheduleDays.forSchedule(transaction, state.id);
      const schedule = Schedule.rehydrate(state);
      const published = schedule.publish(days.length, currentActor(), dependencies.clock.now());

      if (!published.ok) return refusedBy(published.error);

      await dependencies.stores.schedules.update(
        transaction,
        schedule.snapshot(),
        command.expectedVersion,
      );
      return success({ scheduleId: schedule.id, code: state.code, status: schedule.status });
    }),
});
