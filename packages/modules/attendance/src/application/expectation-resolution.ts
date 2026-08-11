import type { Transaction } from '@work/kernel';

import { policyOn, type PolicyState } from '../domain/attendance-policy.js';
import { assignmentOn } from '../domain/schedule.js';
import { isExpectedToWork, type DayKind } from '../domain/attendance-vocabulary.js';
import { definedOnly } from '../domain/attendance-aggregate.js';
import type { RosterEntryState } from '../domain/roster-entry.js';
import type { SegmentState, ShiftState } from '../domain/shift.js';
import type { Expectation } from '../domain/calculation.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * What was expected of one employment on one date — and, just as importantly, in which zone.
 *
 * **The resolution order is the whole rule**, and it is written once here so ingestion and
 * recalculation cannot disagree about it:
 *
 * ```
 * roster entry for (employment, date)  ──►  schedule assignment in force on date  ──►  unscheduled
 * ```
 *
 * A roster entry wins because it is somebody stating explicitly what this person is doing on this
 * day. A schedule answers when nobody has. Neither answering is a real state, not an error: a
 * casual worker between engagements is unscheduled, and inventing a schedule for them would invent
 * absences.
 *
 * **Everything is read as at the date, never as at today.** A schedule assignment changed in June
 * does not move March's expectation, because `assignmentOn` asks for March; a policy published in
 * June does not forgive March's lateness, because `policyOn` asks for March. That is what makes a
 * recalculation of an old month reproduce that month (ADR-0053).
 */

export interface Resolved {
  readonly expectation: Expectation;
  readonly policy: PolicyState;
  readonly zone: string;
}

/**
 * The zone used when nothing else has an opinion.
 *
 * Ingestion needs a zone before it knows which schedule applies — it has to resolve an attendance
 * date in order to look one up — so an employment with no schedule at all still needs an answer.
 * The tenant's configured zone is that answer, read from Organization's published settings and
 * defaulted to UTC only when a tenant has configured none.
 */
export const DEFAULT_ZONE = 'UTC';

/**
 * Resolves the expectation, or reports that the tenant has configured no policy.
 *
 * A missing policy is a refusal rather than a silent default, and that is deliberate: this product
 * ships no rounding, no grace and no overtime threshold, so calculating without a policy would mean
 * inventing all three (00B). The tenant configures one, and the screen says so until they do.
 */
export const resolveExpectation = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  request: { readonly employmentId: string; readonly attendanceDate: string },
): Promise<Resolved | undefined> => {
  const policies = await dependencies.stores.policies.published(transaction);
  const policy = policyOn(policies, request.attendanceDate);

  if (policy === undefined) return undefined;

  const roster = await dependencies.stores.rosters.on(
    transaction,
    request.employmentId,
    request.attendanceDate,
  );
  const scheduled = await resolveSchedule(transaction, dependencies, request);
  const zone = scheduled?.zone ?? DEFAULT_ZONE;
  const running = await runningShift(transaction, dependencies, shiftIdFor(roster, scheduled));
  const { shift, segments } = running;

  return {
    zone,
    policy,
    expectation: {
      dayKind: dayKindOf(roster?.kind, shift !== undefined),
      zone,
      segments,
      ...definedOnly({
        shift,
        rosterEntry: roster,
        scheduleId: scheduled?.scheduleId,
        scheduleVersion: scheduled?.scheduleVersion,
      }),
    },
  };
};

/**
 * Which shift the date runs, if any.
 *
 * A roster entry wins outright: somebody stated explicitly what this person is doing, including
 * that they are doing nothing — a rest entry names no shift, and that absence is the answer rather
 * than a reason to fall back to the schedule.
 */
const shiftIdFor = (
  roster: RosterEntryState | undefined,
  scheduled: Scheduled | undefined,
): string | undefined => (roster === undefined ? scheduled?.shiftId : roster.shiftId);

/** The shift and its segments, or neither. One read where the caller would otherwise branch. */
const runningShift = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  shiftId: string | undefined,
): Promise<{ readonly shift?: ShiftState; readonly segments: readonly SegmentState[] }> => {
  if (shiftId === undefined) return { segments: [] };

  const shift = await dependencies.stores.shifts.byId(transaction, shiftId);

  if (shift === undefined) return { segments: [] };
  return { shift, segments: await dependencies.stores.segments.forShift(transaction, shift.id) };
};

interface Scheduled {
  readonly zone: string;
  readonly scheduleId: string;
  readonly scheduleVersion: number;
  readonly shiftId?: string;
}

/**
 * The schedule in force, and the shift its cycle puts on this date.
 *
 * A cycle position with no row is a rest day, and the absence of a row is the answer rather than a
 * gap — which is why this returns the schedule even when it finds no shift.
 */
const resolveSchedule = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  request: { readonly employmentId: string; readonly attendanceDate: string },
): Promise<Scheduled | undefined> => {
  const assignments = await dependencies.stores.assignments.forEmployment(
    transaction,
    request.employmentId,
  );
  const assignment = assignmentOn(assignments, request.attendanceDate);

  if (assignment === undefined) return undefined;

  const schedule = await dependencies.stores.schedules.byId(transaction, assignment.scheduleId);

  if (schedule === undefined) return undefined;

  const days = await dependencies.stores.scheduleDays.forSchedule(transaction, schedule.id);
  const position = positionOn(
    schedule.cycleAnchorDate,
    schedule.cycleLengthDays,
    request.attendanceDate,
  );
  const day = days.find((entry) => entry.cyclePosition === position);

  return {
    zone: schedule.zone,
    scheduleId: schedule.id,
    scheduleVersion: schedule.versionNumber,
    ...(day === undefined ? {} : { shiftId: day.shiftId }),
  };
};

const positionOn = (anchor: string, length: number, onDate: string): number => {
  const elapsed = Math.round(
    (Date.parse(`${onDate}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000,
  );

  return ((elapsed % length) + length) % length;
};

const dayKindOf = (rosterKind: string | undefined, hasShift: boolean): DayKind => {
  if (rosterKind === 'holiday') return 'holiday';
  if (rosterKind === 'rest') return 'rest';
  if (rosterKind !== undefined) {
    return isExpectedToWork(rosterKind as 'shift') ? 'working' : 'rest';
  }
  return hasShift ? 'working' : 'rest';
};

/**
 * The zone an event's attendance date is resolved in, before any day exists.
 *
 * Ingestion is a chicken and egg: the attendance date decides which roster entry applies, and the
 * roster entry can carry a shift whose zone decides the attendance date. It is resolved by asking
 * the *schedule* — whose zone does not depend on the date's shift — and falling back to the
 * tenant's. A roster entry that moves somebody to a different zone for one night is a case this
 * phase does not model, and §36 of the plan records it rather than guessing.
 */
export const zoneFor = async (
  transaction: Transaction,
  dependencies: AttendanceDependencies,
  request: { readonly employmentId: string; readonly onDate: string; readonly tenantZone: string },
): Promise<string> => {
  const assignments = await dependencies.stores.assignments.forEmployment(
    transaction,
    request.employmentId,
  );
  const assignment = assignmentOn(assignments, request.onDate);

  if (assignment === undefined) return request.tenantZone;

  const schedule = await dependencies.stores.schedules.byId(transaction, assignment.scheduleId);

  return schedule?.zone ?? request.tenantZone;
};
