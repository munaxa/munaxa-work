import { success, type Query, type QueryHandler } from '@work/kernel';

import { LeavePermissions } from './leave-permissions.js';
import type { CoveredDay } from './leave-ports.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * The two reads Attendance calls, and the whole of what Leave publishes to it.
 *
 * **This is the entire Leave→Attendance surface, and it points the other way.** Attendance depends
 * on Leave; Leave does not depend on Attendance for these. Leave never writes an Attendance table,
 * never sends an Attendance command and never marks an Attendance day stale — that would be a
 * circular module dependency, since Attendance already reads Leave. Attendance **pulls** on its own
 * reconciliation run.
 *
 * `leave.approved-leave-for` answers "what leave is approved for this employment over these dates".
 * It is on the path of **every attendance recalculation**, so its cost is multiplied by every day
 * of every run — which is why it reads one index (`leave_request_day_coverage_idx`) and does no
 * arithmetic. The rows it returns *are* the day rows, so Attendance and Leave cannot disagree about
 * which dates are covered.
 *
 * `leave.approved-leave-affecting` adds `changedSince`, and it is the reconciliation half:
 * Attendance asks which employments' leave has moved since it last looked, and marks **its own**
 * days stale accordingly. Narrow by design — one employment, one date range, one instant. There is
 * no global cursor, no feed, no event bus and no outbox, because a single consumer does not justify
 * building one and Phases 16/17 own that work properly.
 *
 * **A request that is not approved is not leave.** A draft, a submitted-but-undecided, a rejected, a
 * withdrawn and a cancelled request all return nothing here. Somebody who has *asked* for the
 * fourteenth off has not been granted it, and an attendance record saying otherwise would be wrong.
 */

export interface ApprovedLeaveDayView {
  readonly onDate: string;
  /** `full_day` | `partial_day` | `hourly` — Attendance's own vocabulary, not Leave's portions. */
  readonly coverage: string;
  readonly minutes: number;
  readonly leaveRequestId: string;
  readonly leaveTypeId: string;
}

export interface ApprovedLeaveFor extends Query {
  readonly queryName: 'leave.approved-leave-for';
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
}

export interface ApprovedLeaveView {
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
  readonly days: readonly ApprovedLeaveDayView[];
}

export const approvedLeaveForHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ApprovedLeaveFor, ApprovedLeaveView> => ({
  queryName: 'leave.approved-leave-for',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const days = await dependencies.stores.requestDays.covering(transaction, {
        employmentId: query.employmentId,
        from: query.from,
        to: query.to,
      });

      return success({
        employmentId: query.employmentId,
        from: query.from,
        to: query.to,
        days: days.map(asCoverage),
      });
    }),
});

export interface ApprovedLeaveAffecting extends Query {
  readonly queryName: 'leave.approved-leave-affecting';
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
  /** Only leave whose request changed at or after this instant. What makes the pull incremental. */
  readonly changedSince?: Date;
}

export const approvedLeaveAffectingHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ApprovedLeaveAffecting, ApprovedLeaveView> => ({
  queryName: 'leave.approved-leave-affecting',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const days = await dependencies.stores.requestDays.covering(transaction, {
        employmentId: query.employmentId,
        from: query.from,
        to: query.to,
        ...(query.changedSince === undefined ? {} : { changedSince: query.changedSince }),
      });

      return success({
        employmentId: query.employmentId,
        from: query.from,
        to: query.to,
        days: days.map(asCoverage),
      });
    }),
});

/**
 * A Leave day row as Attendance's vocabulary.
 *
 * The translation is one word wide and it lives here rather than in Attendance, because it is
 * Leave's business to say what its portions mean. `first_half` and `second_half` are both
 * `partial_day` to Attendance, which cares how many minutes were authorized rather than which half
 * of the day they fell in.
 */
const asCoverage = (day: CoveredDay): ApprovedLeaveDayView => ({
  onDate: day.onDate,
  coverage: coverageOf(day.portion),
  minutes: day.minutes,
  leaveRequestId: day.leaveRequestId,
  leaveTypeId: day.leaveTypeId,
});

const coverageOf = (portion: string): string => {
  if (portion === 'full_day') return 'full_day';
  if (portion === 'hours') return 'hourly';
  return 'partial_day';
};
