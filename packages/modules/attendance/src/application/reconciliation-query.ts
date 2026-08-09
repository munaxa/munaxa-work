import { success, type Query, type QueryHandler } from '@work/kernel';

import { AttendancePermissions } from './attendance-permissions.js';
import { DEFAULT_BATCH, MAX_BATCH } from './recalculate.use-case.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * The reconciliation read: days whose inputs moved after they were last calculated.
 *
 * A first-class query rather than an operations script, because it is the mechanism that recovers
 * work a lost event would otherwise have dropped, and something a human can look at is something a
 * human notices is growing.
 *
 * It uses the same predicate as the partial index the migration creates — presence of the stale
 * mark, never a comparison against `calculated_at`. An input that moved within the same clock tick
 * as the calculation it invalidates would be lost by a comparison, and lost silently (ADR-0053).
 */

export interface DaysAwaitingRecalculation extends Query {
  readonly queryName: 'attendance.days-awaiting-recalculation';
  readonly limit?: number;
}

export interface AwaitingRecalculationView {
  readonly total: number;
  readonly days: readonly {
    readonly attendanceDayId: string;
    readonly employmentId: string;
    readonly attendanceDate: string;
    readonly state: string;
    readonly inputsChangedAt?: Date;
  }[];
}

export const daysAwaitingRecalculationHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<DaysAwaitingRecalculation, AwaitingRecalculationView> => ({
  queryName: 'attendance.days-awaiting-recalculation',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const limit = Math.min(MAX_BATCH, Math.max(1, query.limit ?? DEFAULT_BATCH));
      const stale = await dependencies.stores.days.stale(transaction, limit);

      return success({
        total: stale.length,
        days: stale.map((day) => ({
          attendanceDayId: day.id,
          employmentId: day.employmentId,
          attendanceDate: day.attendanceDate,
          state: day.state,
          ...(day.inputsChangedAt === undefined ? {} : { inputsChangedAt: day.inputsChangedAt }),
        })),
      });
    }),
});
