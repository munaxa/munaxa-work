import { success, type Command, type CommandHandler } from '@work/kernel';

import { AttendanceDay } from '../domain/attendance-day.js';
import { overlaps, scheduleAssignment } from '../domain/schedule.js';
import { addDays } from '../domain/attendance-vocabulary.js';

import { conflicted, currentTenant, notFound, refusedBy } from './attendance-context.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * Putting somebody on a schedule, and taking them off one.
 *
 * **Both writes mark the affected days for recalculation, in the same transaction.** A person moved
 * onto a night rota from the first of the month has a month of days whose expectation just changed,
 * and the reconciliation query is how those are found — not an event, which this repository
 * delivers at most once (ADR-0053).
 *
 * **Overlap is refused rather than merged**: two schedules in force on one day is two answers to
 * when somebody was expected at work, and the system must be incapable of holding both.
 */

export interface AssignScheduleCommand extends Command {
  readonly commandName: 'attendance.assign-schedule';
  readonly employmentId: string;
  readonly scheduleId: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
}

export interface AssignmentAffected {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly daysMarkedForRecalculation: number;
}

/**
 * Putting an employment on a schedule, from a date.
 *
 * Overlap is refused rather than merged: two schedules in force on one day is two answers to when
 * somebody was expected at work, and the system must be incapable of holding both.
 */
export const assignScheduleHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<AssignScheduleCommand, AssignmentAffected> => ({
  commandName: 'attendance.assign-schedule',
  permission: AttendancePermissions.rosterManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.find(
        command.employmentId,
        command.effectiveFrom,
      );

      if (employment === undefined) return notFound<AssignmentAffected>('employment');

      const schedule = await dependencies.stores.schedules.byId(transaction, command.scheduleId);

      if (schedule === undefined) return notFound<AssignmentAffected>('schedule');
      if (schedule.status !== 'published') return conflicted('schedule_not_published');

      const existing = await dependencies.stores.assignments.forEmployment(
        transaction,
        command.employmentId,
      );

      if (overlaps(existing, command)) return conflicted('assignment_overlaps');

      const assignment = scheduleAssignment(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!assignment.ok) return refusedBy(assignment.error);

      await dependencies.stores.assignments.insert(transaction, assignment.value);

      // Days already calculated under the old expectation are marked here, in this transaction.
      // Nothing waits for an event that may never arrive.
      const marked = await dependencies.stores.days.markStale(
        transaction,
        {
          employmentId: command.employmentId,
          from: command.effectiveFrom,
          to: command.effectiveTo ?? FAR_FUTURE,
        },
        dependencies.clock.now(),
      );

      return success({
        assignmentId: assignment.value.id,
        employmentId: command.employmentId,
        daysMarkedForRecalculation: marked,
      });
    }),
});

export interface EndAssignmentCommand extends Command {
  readonly commandName: 'attendance.end-assignment';
  readonly assignmentId: string;
  readonly effectiveTo: string;
  readonly expectedVersion: number;
}

/**
 * Closing an assignment, which is how somebody moves to a different schedule.
 *
 * A separate command rather than something `assign-schedule` does implicitly, because closing the
 * period somebody was measured against is a decision with a date on it — and a new assignment that
 * silently truncated the old one would change what March meant as a side effect of a June write.
 *
 * The days from the closing date onwards are marked here, in this transaction: an assignment that
 * ends on the tenth leaves the eleventh onwards with a different expectation, and those days have
 * to be found by the reconciliation query rather than by an event (ADR-0053).
 */
export const endAssignmentHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<EndAssignmentCommand, AssignmentAffected> => ({
  commandName: 'attendance.end-assignment',
  permission: AttendancePermissions.rosterManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.assignments.byId(transaction, command.assignmentId);

      if (state === undefined) return notFound<AssignmentAffected>('assignment');
      if (state.effectiveTo !== undefined) return conflicted('assignment_already_ended');

      const ended = scheduleAssignment(
        { ...state, effectiveTo: command.effectiveTo },
        dependencies.clock.now(),
      );

      if (!ended.ok) return refusedBy(ended.error);

      await dependencies.stores.assignments.update(
        transaction,
        { ...ended.value, id: state.id, version: state.version },
        command.expectedVersion,
      );

      const marked = await dependencies.stores.days.markStale(
        transaction,
        {
          employmentId: state.employmentId,
          // From the day *after* the last one the assignment covers. The closing date itself is
          // still inside the period and means what it always did.
          from: addDays(command.effectiveTo, 1),
          to: FAR_FUTURE,
        },
        dependencies.clock.now(),
      );

      return success({
        assignmentId: state.id,
        employmentId: state.employmentId,
        daysMarkedForRecalculation: marked,
      });
    }),
});

/**
 * The end of an open-ended period, as a date the database can compare.
 *
 * A literal rather than `null` handling in every query: an assignment with no end runs until
 * somebody ends it, and the marking statement needs an upper bound it can index against.
 */
export const FAR_FUTURE = '9999-12-31';

/** Marks a day, opening one if none exists yet. Shared by the writes that move an expectation. */
export const markDay = async (
  dependencies: AttendanceDependencies,
  transaction: Parameters<typeof dependencies.stores.days.byDate>[0],
  request: {
    readonly employmentId: string;
    readonly attendanceDate: string;
    readonly zone: string;
  },
  now: Date,
): Promise<void> => {
  const existing = await dependencies.stores.days.byDate(
    transaction,
    request.employmentId,
    request.attendanceDate,
  );

  if (existing === undefined) {
    const opened = AttendanceDay.open({ tenantId: currentTenant(), ...request }, now);

    await dependencies.stores.days.insert(transaction, opened.snapshot());
    return;
  }

  const day = AttendanceDay.rehydrate(existing);

  day.markStale(now);
  await dependencies.stores.days.update(transaction, day.snapshot(), existing.version);
};
