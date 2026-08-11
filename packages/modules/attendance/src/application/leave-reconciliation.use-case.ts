import { success, type Command, type CommandHandler } from '@work/kernel';

import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * Attendance discovering that somebody's leave has moved, and marking **its own** days stale.
 *
 * **The direction is the decision.** Attendance already depends on Leave; a Leave-to-Attendance
 * write would close a dependency cycle and make Leave responsible for mutating another module's
 * derived state. So Leave publishes a read and **Attendance pulls**: this command asks
 * `leave.approved-leave-affecting` what has changed for an employment since it last looked, and
 * then does the only thing it should — marks its own attendance days as needing recalculation.
 *
 * That also makes the mechanism **recoverable rather than dependent on delivery**. Event delivery
 * here is post-commit, in-process and at-most-once with no outbox; if every event were dropped, an
 * operator running this command would still find the change and the attendance record would still
 * converge. Nothing waits to be told (ADR-0053).
 *
 * **`changedSince` is supplied, not remembered.** There is no cursor table, no feed and no
 * subscription: an operator or a scheduled job passes the instant it last reconciled from, and a
 * run with no instant re-examines the whole range. A stored cursor would be a piece of
 * cross-module state that could drift out of step with what was actually recalculated, and
 * recovering from a drifted cursor is harder than re-reading a range.
 *
 * **It marks; it does not calculate.** `attendance.recalculate` does that, idempotently and
 * boundedly, and separating the two means a marking run that half-finished can simply be re-run.
 */

export interface ReconcileLeaveCommand extends Command {
  readonly commandName: 'attendance.reconcile-leave';
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
  /** Only leave changed at or after this instant. Absent re-examines the whole range. */
  readonly changedSince?: Date;
}

export interface LeaveReconciliationOutcome {
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
  /** False where Leave could not be asked. **Not** the same as "no leave changed" (ADR-0056). */
  readonly leaveKnown: boolean;
  readonly datesAffected: number;
  readonly daysMarked: number;
}

export const reconcileLeaveHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<ReconcileLeaveCommand, LeaveReconciliationOutcome> => ({
  commandName: 'attendance.reconcile-leave',
  permission: AttendancePermissions.recalculate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const coverage = await dependencies.leave.approvedLeaveAffecting(
        command.employmentId,
        command.from,
        command.to,
        command.changedSince,
      );

      // Nobody could be asked. Marking nothing and *saying so* is the honest outcome: marking
      // everything would recalculate a hundred thousand days on the strength of an unavailable
      // system, and marking nothing silently would look identical to "no leave changed".
      if (!coverage.known) {
        return success({
          employmentId: command.employmentId,
          from: command.from,
          to: command.to,
          leaveKnown: false,
          datesAffected: 0,
          daysMarked: 0,
        });
      }

      const marked = await dependencies.stores.days.markStale(
        transaction,
        { employmentId: command.employmentId, from: command.from, to: command.to },
        dependencies.clock.now(),
      );

      return success({
        employmentId: command.employmentId,
        from: command.from,
        to: command.to,
        leaveKnown: true,
        datesAffected: coverage.days.length,
        daysMarked: marked,
      });
    }),
});
