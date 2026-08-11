import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { AttendanceDay } from '../domain/attendance-day.js';
import type { AttendanceDayState } from '../domain/attendance-day-state.js';
import { isCivilDate } from '../domain/attendance-vocabulary.js';

import { conflicted, currentActor, currentTenant } from './attendance-context.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';
import type { SnapshotState } from './attendance-ports.js';

/**
 * Freezing a period into the shape Payroll reads.
 *
 * **Frozen means frozen.** A later correction never alters a snapshot; it produces sequence *n+1*.
 * Payroll records which sequence it paid, and a dispute six months later can compare the two. That
 * is ADR-0048's immutability argument applied to a number rather than to a checklist — and it is
 * impossible to retrofit once a customer has run a payroll (ADR-0054).
 *
 * **Attendance does not own the payroll period.** The range comes from the caller, because a payroll
 * calendar is Payroll's and inventing one here would give the product two owners of "when does the
 * month end".
 *
 * **Nothing is filtered out to make the number look better.** `daysUnapproved` and
 * `blockingExceptions` are on the contract, so Payroll decides visibly rather than being handed a
 * silently incomplete month.
 */

export interface FreezePeriodCommand extends Command {
  readonly commandName: 'attendance.freeze-period';
  readonly employmentId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface PeriodFrozen {
  readonly snapshotId: string;
  readonly employmentId: string;
  readonly sequence: number;
  readonly workedMinutes: number;
  readonly overtimeCandidateMinutes: number;
  readonly daysUnapproved: number;
  readonly blockingExceptions: number;
}

export const freezePeriodHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<FreezePeriodCommand, PeriodFrozen> => ({
  commandName: 'attendance.freeze-period',
  permission: AttendancePermissions.periodFreeze,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (!isCivilDate(command.periodStart) || !isCivilDate(command.periodEnd)) {
        return conflicted('period_malformed');
      }
      if (command.periodEnd < command.periodStart)
        return conflicted('period_ends_before_it_begins');

      const days = await dependencies.stores.days.forPeriod(
        transaction,
        command.employmentId,
        command.periodStart,
        command.periodEnd,
      );

      // A day whose inputs have moved but which has not been recalculated would freeze a figure the
      // system already knows is out of date. Refused by name so an operator recalculates first.
      const stale = days.filter((day) => AttendanceDay.rehydrate(day).isStale);

      if (stale.length > 0) {
        return conflicted('days_awaiting_recalculation');
      }

      const now = dependencies.clock.now();
      const previous = await dependencies.stores.snapshots.latest(
        transaction,
        command.employmentId,
        command.periodStart,
        command.periodEnd,
      );
      const blocking = await dependencies.stores.exceptions.countBlocking(
        transaction,
        command.employmentId,
        command.periodStart,
        command.periodEnd,
      );
      const snapshot = snapshotOf(command, days, {
        sequence: (previous?.sequence ?? 0) + 1,
        blocking,
        frozenAt: now,
        frozenBy: currentActor(),
      });

      await dependencies.stores.snapshots.insert(transaction, snapshot);
      await lockApproved(transaction, dependencies, days, now);
      return success({
        snapshotId: snapshot.id,
        employmentId: snapshot.employmentId,
        sequence: snapshot.sequence,
        workedMinutes: snapshot.workedMinutes,
        overtimeCandidateMinutes: snapshot.overtimeCandidateMinutes,
        daysUnapproved: snapshot.daysUnapproved,
        blockingExceptions: snapshot.blockingExceptions,
      });
    }),
});

const snapshotOf = (
  command: FreezePeriodCommand,
  days: readonly AttendanceDayState[],
  meta: {
    readonly sequence: number;
    readonly blocking: number;
    readonly frozenAt: Date;
    readonly frozenBy: string;
  },
): SnapshotState => {
  const total = (pick: (day: AttendanceDayState) => number): number =>
    days.reduce((sum, day) => sum + pick(day), 0);
  const approved = days.filter((day) => day.state === 'approved' || day.state === 'locked').length;

  return {
    id: uuidV7(meta.frozenAt.getTime()),
    tenantId: currentTenant(),
    employmentId: command.employmentId,
    periodStart: command.periodStart,
    periodEnd: command.periodEnd,
    sequence: meta.sequence,
    frozenAt: meta.frozenAt,
    frozenBy: meta.frozenBy,
    workedMinutes: total((day) => day.workedMinutes),
    regularCandidateMinutes: total((day) => day.regularCandidateMinutes),
    overtimeCandidateMinutes: total((day) => day.overtimeCandidateMinutes),
    unpaidMinutes: total((day) => day.unpaidMinutes),
    absenceMinutes: total((day) => day.absenceMinutes),
    leaveMinutes: total((day) => day.leaveMinutes),
    // The weakest answer any day gave. A month containing one day Leave could not be asked about is
    // a month whose absence figure is not yet settled, and saying `none` would hide that.
    leaveState: weakestLeaveState(days),
    daysTotal: days.length,
    daysApproved: approved,
    daysUnapproved: days.length - approved,
    blockingExceptions: meta.blocking,
    calculationVersion: Math.max(0, ...days.map((day) => day.calculationVersion)),
    inputsDigest: digestOf(days),
    version: 0,
  };
};

const weakestLeaveState = (days: readonly AttendanceDayState[]): string => {
  if (days.some((day) => day.leaveState === 'unknown')) return 'unknown';
  if (days.some((day) => day.leaveState === 'applied')) return 'applied';
  return 'none';
};

/**
 * A fingerprint of the days this snapshot was built from.
 *
 * Payroll can prove which attendance it paid, and a re-freeze after a correction produces a
 * different digest — which is exactly how a dispute is settled rather than argued.
 */
const digestOf = (days: readonly AttendanceDayState[]): string =>
  [...days]
    .sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate))
    .map((day) => day.inputsDigest.slice(0, 8))
    .join('')
    .slice(0, 64);

/** Approved days become locked, so a later correction is visibly a change to a frozen period. */
const lockApproved = async (
  transaction: Parameters<AttendanceDependencies['stores']['days']['update']>[0],
  dependencies: AttendanceDependencies,
  days: readonly AttendanceDayState[],
  now: Date,
): Promise<void> => {
  for (const state of days) {
    if (state.state !== 'approved') continue;

    const day = AttendanceDay.rehydrate(state);

    if (!day.lock(now).ok) continue;
    await dependencies.stores.days.update(transaction, day.snapshot(), state.version);
  }
};
