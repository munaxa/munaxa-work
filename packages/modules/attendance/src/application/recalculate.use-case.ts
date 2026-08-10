import {
  rejected,
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { AttendanceDay, dayException } from '../domain/attendance-day.js';
import { calculate, type DetectedException, type LeaveOverlay } from '../domain/calculation.js';
import { definedOnly } from '../domain/attendance-aggregate.js';
import type { AttendanceDayState } from '../domain/attendance-day-state.js';
import type { TimeEventState } from '../domain/time-event.js';

import {
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './attendance-context.js';
import { resolveExpectation } from './expectation-resolution.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';
import type { LeaveCoverage } from './cross-module-ports.js';

/**
 * Recalculation, and the reconciliation that makes it reliable.
 *
 * **This is the phase's answer to an at-most-once event bus.** Every write that changes an input
 * marks the affected days in the same transaction; this command recalculates what is marked, and
 * the query beside it names what is still outstanding. Nothing waits to be told (ADR-0053).
 *
 * The reconciliation *query* beside it lives in `reconciliation-query.ts`, because a read and a
 * write are different things to authorize and different things to read.
 *
 * The command is **idempotent and bounded**: running it twice produces the same rows, and a run has
 * a limit so it finishes. Running it on a day whose inputs have not moved recomputes the same
 * digest and changes nothing observable.
 *
 * **Event received ≠ recalculation guarantee; event not received ≠ recalculation failure.**
 */

export const DEFAULT_BATCH = 200;
export const MAX_BATCH = 1000;

export interface RecalculateCommand extends Command {
  readonly commandName: 'attendance.recalculate';
  /** One employment and date, or nothing — in which case the stale days are taken in order. */
  readonly employmentId?: string;
  readonly attendanceDate?: string;
  readonly limit?: number;
}

export interface RecalculationOutcome {
  readonly examined: number;
  readonly recalculated: number;
  readonly unchanged: number;
  readonly failures: readonly { readonly attendanceDayId: string; readonly reason: string }[];
}

export const recalculateHandler = (
  dependencies: AttendanceDependencies,
): CommandHandler<RecalculateCommand, RecalculationOutcome> => ({
  commandName: 'attendance.recalculate',
  permission: AttendancePermissions.recalculate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const days = await targets(transaction, dependencies, command);

      if (days === undefined) return notFound<RecalculationOutcome>('attendance day');

      const failures: { attendanceDayId: string; reason: string }[] = [];
      let recalculated = 0;
      let unchanged = 0;

      for (const state of days) {
        const outcome = await recalculateOne(transaction, dependencies, state);

        if (!outcome.ok) {
          failures.push({ attendanceDayId: state.id, reason: reasonOf(outcome.error) });
          continue;
        }
        if (outcome.value) recalculated += 1;
        else unchanged += 1;
      }
      return success({ examined: days.length, recalculated, unchanged, failures });
    }),
});

const targets = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  command: RecalculateCommand,
): Promise<readonly AttendanceDayState[] | undefined> => {
  const limit = Math.min(MAX_BATCH, Math.max(1, command.limit ?? DEFAULT_BATCH));

  if (command.employmentId === undefined || command.attendanceDate === undefined) {
    return dependencies.stores.days.stale(transaction, limit);
  }

  const day = await dependencies.stores.days.byDate(
    transaction,
    command.employmentId,
    command.attendanceDate,
  );

  return day === undefined ? undefined : [day];
};

/**
 * Recalculates one day, and reports whether anything changed.
 *
 * The digest comparison is what makes a rerun cheap and a rerun honest: identical inputs produce an
 * identical digest, the row is left alone, and the caller is told `unchanged` rather than being
 * shown a write that did nothing.
 */
const recalculateOne = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  state: AttendanceDayState,
): Promise<Result<boolean, HandlerFailure>> => {
  const resolved = await resolveExpectation(transaction, dependencies, {
    employmentId: state.employmentId,
    attendanceDate: state.attendanceDate,
  });

  if (resolved === undefined) {
    return rejected<boolean>('attendance.rejection.no_policy_in_force');
  }

  const events = await countedEvents(transaction, dependencies, state);
  const leave = await leaveOverlayFor(dependencies, state);
  const day = AttendanceDay.rehydrate(state);
  const result = calculate({
    attendanceDate: state.attendanceDate,
    events,
    expectation: resolved.expectation,
    policy: resolved.policy,
    leave,
    wasApproved: day.wasApproved,
  });

  if (result.inputsDigest === state.inputsDigest && state.calculatedAt !== undefined) {
    // Nothing moved. The stale mark is cleared so the day leaves the reconciliation queue, and
    // nothing else about the row changes.
    day.applyCalculation(
      result,
      inputsOf(resolved, state),
      originOfCurrentRequest(),
      dependencies.clock.now(),
    );
    await dependencies.stores.days.update(transaction, day.snapshot(), state.version);
    return success(false);
  }

  const now = dependencies.clock.now();
  const applied = day.applyCalculation(
    result,
    inputsOf(resolved, state),
    originOfCurrentRequest(),
    now,
  );

  if (!applied.ok) return refusedBy(applied.error);

  await dependencies.stores.days.update(transaction, day.snapshot(), state.version);
  transaction.collect(day.pullEvents());
  // Open exceptions from the previous calculation are superseded rather than deleted: what the
  // system thought yesterday is part of why somebody corrected something today.
  await dependencies.stores.exceptions.supersedeOpen(transaction, state.id, now);
  await recordExceptions(transaction, dependencies, state, { found: result.exceptions, now });
  return success(true);
};

/**
 * The events that count towards the day's arithmetic.
 *
 * Every event on the date is read, then the ones an approved removal took out are dropped. They
 * stay in the table and stay readable; they simply leave the sum, and the correction record says
 * who removed them and why — which is the difference between a corrected record and a deleted one
 * (ADR-0052).
 */
const countedEvents = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  state: AttendanceDayState,
): Promise<readonly TimeEventState[]> => {
  const stored = await dependencies.stores.events.forDay(
    transaction,
    state.employmentId,
    state.attendanceDate,
  );
  const removed = new Set(
    await dependencies.stores.corrections.appliedRemovals(
      transaction,
      state.employmentId,
      state.attendanceDate,
    ),
  );

  return stored.filter((event) => !removed.has(event.id));
};

/** What the calculation found, written as rows a human can work through. */
const recordExceptions = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  state: AttendanceDayState,
  detected: { readonly found: readonly DetectedException[]; readonly now: Date },
): Promise<void> => {
  for (const one of detected.found) {
    await dependencies.stores.exceptions.insert(
      transaction,
      dayException(
        {
          tenantId: currentTenant(),
          attendanceDayId: state.id,
          employmentId: state.employmentId,
          attendanceDate: state.attendanceDate,
          kind: one.kind,
          severity: one.severity,
          ...definedOnly({ minutes: one.minutes, detail: one.detail }),
        },
        detected.now,
      ),
    );
  }
};

const inputsOf = (
  resolved: NonNullable<Awaited<ReturnType<typeof resolveExpectation>>>,
  state: AttendanceDayState,
): {
  readonly scheduleId?: string;
  readonly scheduleVersion?: number;
  readonly shiftId?: string;
  readonly rosterEntryId?: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly zone: string;
} => ({
  ...(resolved.expectation.scheduleId === undefined
    ? {}
    : { scheduleId: resolved.expectation.scheduleId }),
  ...(resolved.expectation.scheduleVersion === undefined
    ? {}
    : { scheduleVersion: resolved.expectation.scheduleVersion }),
  ...(resolved.expectation.shift === undefined ? {} : { shiftId: resolved.expectation.shift.id }),
  ...(resolved.expectation.rosterEntry === undefined
    ? {}
    : { rosterEntryId: resolved.expectation.rosterEntry.id }),
  policyId: resolved.policy.id,
  policyVersion: resolved.policy.versionNumber,
  zone: resolved.zone || state.zone,
});

/**
 * What Leave could say about the day.
 *
 * `known: false` becomes the `unknown` state, and the calculation turns that into
 * `absence_pending_explanation` rather than `absent_unexplained`. Nothing here invents an answer
 * when Leave cannot give one (ADR-0056).
 */
const leaveOverlayFor = async (
  dependencies: AttendanceDependencies,
  state: AttendanceDayState,
): Promise<LeaveOverlay> => {
  const coverage: LeaveCoverage = await dependencies.leave.approvedLeaveFor(
    state.employmentId,
    state.attendanceDate,
    state.attendanceDate,
  );

  if (!coverage.known) return { state: 'unknown', minutes: 0 };

  const day = coverage.days.find((entry) => entry.onDate === state.attendanceDate);

  if (day === undefined) return { state: 'none', minutes: 0 };
  return {
    state: 'applied',
    minutes: day.coverage === 'full_day' ? state.expectedMinutes : (day.minutes ?? 0),
  };
};

const reasonOf = (failure: HandlerFailure): string => {
  if (failure.kind === 'rejected') return failure.reason;
  if (failure.kind === 'conflict') return failure.reason;
  if (failure.kind === 'not_found') return `not_found:${failure.resource}`;
  return failure.kind;
};
