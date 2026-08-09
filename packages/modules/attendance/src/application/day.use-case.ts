import { success, type Command, type CommandHandler } from '@work/kernel';

import { AttendanceDay, resolveException } from '../domain/attendance-day.js';

import { currentActor, notFound, originOfCurrentRequest, refusedBy } from './attendance-context.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * Moving an attendance day through review and sign-off, and resolving what the calculation found.
 *
 * **Approval is a decision by a named human**, recorded here with their identity and the instant —
 * not routed, not auto-approved, and not delegated to a port whose shipped adapter says yes to
 * everything (ADR-0045). `approvalReference` is reserved for Phase 16 and stays null, exactly as
 * `recruitment_requisition.approval_id` and `onboarding_task.approval_reference` do.
 *
 * **A blocking exception refuses the sign-off.** That is the only mechanical consequence a severity
 * has, and it is the one that matters: a day whose clock-out never arrived has no defensible worked
 * figure, and approving it would put a number nobody can justify into a payable snapshot.
 */

export interface DayAffected {
  readonly attendanceDayId: string;
  readonly employmentId: string;
  readonly attendanceDate: string;
  readonly state: string;
}

export interface ApproveDayCommand extends Command {
  readonly commandName: 'attendance.approve-day';
  readonly attendanceDayId: string;
  readonly expectedVersion: number;
}

export const approveDayHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<ApproveDayCommand, DayAffected> => ({
  commandName: 'attendance.approve-day',
  permission: AttendancePermissions.approve,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.days.byId(transaction, command.attendanceDayId);

      if (state === undefined) return notFound<DayAffected>('attendance day');

      const exceptions = await dependencies.stores.exceptions.forDay(transaction, state.id);
      const day = AttendanceDay.rehydrate(state);
      const approved = day.approve(
        exceptions,
        currentActor(),
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!approved.ok) return refusedBy(approved.error);

      await dependencies.stores.days.update(transaction, day.snapshot(), command.expectedVersion);
      transaction.collect(day.pullEvents());
      return success(affected(day));
    }),
});

export interface ReviewDayCommand extends Command {
  readonly commandName: 'attendance.review-day';
  readonly attendanceDayId: string;
  readonly expectedVersion: number;
}

/** Taking a day out of the automatic flow so a human is looking at it. */
export const reviewDayHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<ReviewDayCommand, DayAffected> => ({
  commandName: 'attendance.review-day',
  permission: AttendancePermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.days.byId(transaction, command.attendanceDayId);

      if (state === undefined) return notFound<DayAffected>('attendance day');

      const day = AttendanceDay.rehydrate(state);
      const moved = day.beginReview();

      if (!moved.ok) return refusedBy(moved.error);

      await dependencies.stores.days.update(transaction, day.snapshot(), command.expectedVersion);
      return success(affected(day));
    }),
});

export interface ResolveExceptionCommand extends Command {
  readonly commandName: 'attendance.resolve-exception';
  readonly exceptionId: string;
  /** `waived` records that it did not apply; `resolved` records that it was dealt with. */
  readonly outcome: 'resolved' | 'waived';
  readonly reasonCode: string;
  readonly expectedVersion: number;
}

export interface ExceptionAffected {
  readonly exceptionId: string;
  readonly attendanceDayId: string;
  readonly state: string;
}

/**
 * Resolving or waiving an exception.
 *
 * Its own permission, because "we dealt with it" and "it did not apply to this person" are
 * different answers, and the second is the one an auditor asks about. Neither deletes anything: the
 * exception keeps its row, gains a reason, an actor and an instant, and stays readable.
 */
export const resolveExceptionHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<ResolveExceptionCommand, ExceptionAffected> => ({
  commandName: 'attendance.resolve-exception',
  permission: AttendancePermissions.exceptionResolve,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.exceptions.byId(transaction, command.exceptionId);

      if (state === undefined) return notFound<ExceptionAffected>('exception');

      const resolved = resolveException(
        state,
        {
          state: command.outcome,
          reasonCode: command.reasonCode,
          resolvedBy: currentActor(),
        },
        dependencies.clock.now(),
      );

      if (!resolved.ok) return refusedBy(resolved.error);

      await dependencies.stores.exceptions.update(
        transaction,
        resolved.value,
        command.expectedVersion,
      );
      return success({
        exceptionId: resolved.value.id,
        attendanceDayId: resolved.value.attendanceDayId,
        state: resolved.value.state,
      });
    }),
});

const affected = (day: AttendanceDay): DayAffected => ({
  attendanceDayId: day.id,
  employmentId: day.employmentId,
  attendanceDate: day.attendanceDate,
  state: day.state,
});
