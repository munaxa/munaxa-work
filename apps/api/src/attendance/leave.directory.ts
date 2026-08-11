import type { ApprovedLeaveDay, LeaveCoverage, LeaveDirectoryPort } from '@work/attendance';
import type { ApprovedLeaveView } from '@work/leave';
import { runWithServiceGrant, type Query } from '@work/kernel';

import type { Asking } from '../leave/leave.composition.js';

/**
 * The real Leave adapter — the line Phase 8 left as `leaveUnavailable`, now wired.
 *
 * **The three answers, and why the third exists.** Attendance asks "was this absence authorized",
 * and there are three honest replies:
 *
 * 1. `known: true` with days — leave is approved on these dates, for these minutes.
 * 2. `known: true` with none — Leave was asked, and there is no approved leave. The absence is
 *    genuinely unexplained.
 * 3. `known: false` — **nobody could be asked.** Leave errored, or is not registered.
 *
 * The third is the one that matters and the one that is easy to get wrong. If a failure were
 * collapsed into "no leave approved", every unexplained absence during a Leave outage would be
 * written onto somebody's record as an absence *without leave* — a false statement about a person,
 * produced by a system fault they had nothing to do with. Attendance's calculation turns
 * `known: false` into `absence_pending_explanation` rather than `absent_unexplained`, and that
 * distinction only survives if this adapter refuses to guess (ADR-0056).
 *
 * So **every failure path here answers `known: false`**, including a thrown exception, and a test
 * with a throwing dispatcher proves it.
 *
 * The call runs under a **bounded service grant** (ADR-0043) naming exactly one Leave permission: a
 * supervisor recalculating a day must not thereby become somebody who can read the leave register,
 * where a sick-leave justification lives.
 *
 * **Nothing here writes to Leave**, and nothing in Leave writes to Attendance. The dependency
 * points one way; the reconciliation that keeps attendance current is Attendance *asking* through
 * `approvedLeaveAffecting`, which is this adapter's second method (ADR-0058).
 */

/** The one permission the grant permits. Listed, never a prefix. */
const LEAVE_READ = 'leave.read';

interface ApprovedLeaveForQuery extends Query {
  readonly queryName: 'leave.approved-leave-for';
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
}

interface ApprovedLeaveAffectingQuery extends Query {
  readonly queryName: 'leave.approved-leave-affecting';
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
  readonly changedSince?: Date;
}

export class AttendanceLeaveDirectory implements LeaveDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public approvedLeaveFor(employmentId: string, from: string, to: string): Promise<LeaveCoverage> {
    return this.coverage(
      { queryName: 'leave.approved-leave-for', employmentId, from, to },
      'attendance.recalculate',
    );
  }

  /**
   * The incremental read Attendance's own reconciliation runs.
   *
   * Same shape, same failure rule: a Leave that cannot be asked yields `known: false`, and the
   * reconciliation reports `leaveKnown: false` rather than marking nothing silently.
   */
  public approvedLeaveAffecting(
    employmentId: string,
    from: string,
    to: string,
    changedSince?: Date,
  ): Promise<LeaveCoverage> {
    const query: ApprovedLeaveAffectingQuery = {
      queryName: 'leave.approved-leave-affecting',
      employmentId,
      from,
      to,
      ...(changedSince === undefined ? {} : { changedSince }),
    };

    return this.coverage(query, 'attendance.reconcile-leave');
  }

  /**
   * The ask, and the single place every failure becomes `known: false`.
   *
   * The `catch` is deliberate and is the load-bearing line: a dispatcher that throws — Leave not
   * registered, a driver error, a bug — must not become "no leave approved". It becomes "nobody
   * could be asked", which is what the day's calculation is built to handle.
   */
  private async coverage(
    query: ApprovedLeaveForQuery | ApprovedLeaveAffectingQuery,
    operation: string,
  ): Promise<LeaveCoverage> {
    try {
      const result = await runWithServiceGrant(
        {
          module: 'attendance',
          operation,
          permits: [LEAVE_READ],
          reason: 'reading approved leave for an attendance date',
        },
        () => this.dispatcher.ask<ApprovedLeaveView>(query),
      );

      if (!result.ok) return { known: false };

      return { known: true, days: result.value.days.map(asAttendanceDay) };
    } catch {
      return { known: false };
    }
  }
}

/**
 * A Leave day as Attendance's own vocabulary.
 *
 * `minutes` is carried for every coverage, including a full day: Attendance uses the day's own
 * expected minutes for a full day and the stated figure otherwise, and giving it both leaves the
 * choice where the day's arithmetic already lives.
 */
const asAttendanceDay = (day: ApprovedLeaveView['days'][number]): ApprovedLeaveDay => ({
  onDate: day.onDate,
  coverage: coverageOf(day.coverage),
  minutes: day.minutes,
  leaveRequestId: day.leaveRequestId,
});

const coverageOf = (coverage: string): ApprovedLeaveDay['coverage'] => {
  if (coverage === 'full_day') return 'full_day';
  if (coverage === 'hourly') return 'hourly';
  return 'partial_day';
};
