import { createHash } from 'node:crypto';

import { roundMinutes, type PolicyState } from './attendance-policy.js';
import {
  isExpectedToWork,
  type DayKind,
  type ExceptionKind,
  type ExceptionSeverity,
  type LeaveState,
} from './attendance-vocabulary.js';
import { live, pair, type PairableEvent, type Pairing } from './pairing.js';
import type { SegmentState, ShiftState } from './shift.js';
import type { RosterEntryState } from './roster-entry.js';
import { minutesBetween, shiftBoundsOn } from './zoned-time.js';

/**
 * The calculation. Events plus expectation plus policy plus what Leave could say, in, and one
 * attendance result out.
 *
 * **Pure.** No clock, no database, no randomness. The same inputs give the same outputs for ever,
 * which is what makes a re-run of March reproduce March and what lets this be tested against a
 * table of scenarios rather than against a database.
 *
 * **Nothing here decides what time is worth.** It produces minutes in named buckets;
 * `overtimeCandidateMinutes` is a candidate and the word is load-bearing (ADR-0054).
 */

export const CALCULATION_VERSION = 1;

export interface Expectation {
  readonly dayKind: DayKind;
  readonly zone: string;
  readonly shift?: ShiftState;
  readonly segments: readonly SegmentState[];
  readonly rosterEntry?: RosterEntryState;
  readonly scheduleId?: string;
  readonly scheduleVersion?: number;
}

export interface LeaveOverlay {
  readonly state: LeaveState;
  readonly minutes: number;
}

export interface CalculationInput {
  readonly attendanceDate: string;
  readonly events: readonly PairableEvent[];
  readonly expectation: Expectation;
  readonly policy: PolicyState;
  readonly leave: LeaveOverlay;
  /** True when the day was already signed off. A late event then asks a human rather than voiding it. */
  readonly wasApproved: boolean;
}

export interface DetectedException {
  readonly kind: ExceptionKind;
  readonly severity: ExceptionSeverity;
  readonly minutes?: number;
  readonly detail?: string;
}

export interface CalculationResult {
  readonly dayKind: DayKind;
  readonly expectedStartAt?: Date;
  readonly expectedEndAt?: Date;
  readonly expectedMinutes: number;
  readonly expectedBreakMinutes: number;
  readonly firstInAt?: Date;
  readonly lastOutAt?: Date;
  readonly workedMinutes: number;
  readonly breakMinutesTaken: number;
  readonly paidBreakMinutes: number;
  readonly regularCandidateMinutes: number;
  readonly overtimeCandidateMinutes: number;
  readonly unpaidMinutes: number;
  readonly absenceMinutes: number;
  readonly leaveState: LeaveState;
  readonly leaveMinutes: number;
  readonly exceptions: readonly DetectedException[];
  readonly calculationVersion: number;
  readonly inputsDigest: string;
}

export const calculate = (input: CalculationInput): CalculationResult => {
  const pairing = pair(input.events);
  const bounds = expectedBounds(input);
  const worked = workedMinutesOf(pairing, input.expectation.segments, input.policy);
  const buckets = bucketsOf(worked, bounds.expectedMinutes, input);
  const exceptions = [
    ...punctuality(pairing, bounds, input),
    ...completeness(pairing, input),
    ...presence(pairing, bounds, input),
    ...overtime(buckets.overtimeCandidateMinutes, input),
  ];

  return {
    dayKind: input.expectation.dayKind,
    ...bounds.instants,
    expectedMinutes: bounds.expectedMinutes,
    expectedBreakMinutes: bounds.expectedBreakMinutes,
    ...(pairing.firstIn === undefined ? {} : { firstInAt: pairing.firstIn }),
    ...(pairing.lastOut === undefined ? {} : { lastOutAt: pairing.lastOut }),
    workedMinutes: worked.worked,
    breakMinutesTaken: worked.breaks,
    paidBreakMinutes: worked.paidBreaks,
    ...buckets,
    leaveState: input.leave.state,
    leaveMinutes: input.leave.minutes,
    exceptions,
    calculationVersion: CALCULATION_VERSION,
    inputsDigest: digestOf(input),
  };
};

interface Bounds {
  readonly instants: { readonly expectedStartAt?: Date; readonly expectedEndAt?: Date };
  readonly expectedMinutes: number;
  readonly expectedBreakMinutes: number;
}

/**
 * When the person was expected, as instants.
 *
 * Converted in the schedule's zone, and the end moved to the next civil date when the shift crosses
 * midnight — never by adding twenty-four hours. That distinction is what makes a night shift
 * spanning a daylight-saving transition the length it really was.
 */
const expectedBounds = (input: CalculationInput): Bounds => {
  const shift = input.expectation.shift;

  if (shift === undefined || !expectedToday(input)) {
    return { instants: {}, expectedMinutes: 0, expectedBreakMinutes: 0 };
  }

  const { startAt, endAt } = shiftBoundsOn(
    input.attendanceDate,
    shift.startLocal,
    shift.endLocal,
    input.expectation.zone,
  );
  const unpaidBreak = input.expectation.segments
    .filter((segment) => segment.kind === 'break' && !segment.paid)
    .reduce((total, segment) => total + segmentMinutes(segment), 0);

  return {
    instants: { expectedStartAt: startAt, expectedEndAt: endAt },
    // The shift's authored figure, not the interval. A transition day did not change what was
    // asked of the person, and recomputing it would silently turn an hour of clock into absence.
    expectedMinutes: shift.expectedMinutes,
    expectedBreakMinutes: unpaidBreak,
  };
};

const segmentMinutes = (segment: SegmentState): number => {
  const start = Number(segment.startLocal.slice(0, 2)) * 60 + Number(segment.startLocal.slice(3));
  const end = Number(segment.endLocal.slice(0, 2)) * 60 + Number(segment.endLocal.slice(3));

  return end >= start ? end - start : 1440 - start + end;
};

const expectedToday = (input: CalculationInput): boolean => {
  const entry = input.expectation.rosterEntry;

  if (entry !== undefined) return isExpectedToWork(entry.kind);
  return input.expectation.dayKind === 'working';
};

interface Worked {
  readonly worked: number;
  readonly breaks: number;
  readonly paidBreaks: number;
}

/**
 * How long the person actually worked.
 *
 * An unpaid break is deducted from the worked total; a paid one is not, which is the whole reason
 * the flag exists. **Which breaks are paid is a property of the shift, not of the punches** — a
 * person cannot make their own break paid by punching it — so the paid allowance comes from the
 * shift's segments and the break actually taken is credited up to that allowance. A day with no
 * shift has nothing declaring a break paid, so its breaks are unpaid.
 *
 * Rounding is applied once, at the end, so two ten-minute intervals do not each round up into a
 * quarter of an hour.
 */
const workedMinutesOf = (
  pairing: Pairing,
  segments: readonly SegmentState[],
  policy: PolicyState,
): Worked => {
  const gross = pairing.work.reduce((total, interval) => total + interval.minutes, 0);
  const breaks = pairing.breaks.reduce((total, interval) => total + interval.minutes, 0);
  const allowance = segments
    .filter((segment) => segment.kind === 'break' && segment.paid)
    .reduce((total, segment) => total + segmentMinutes(segment), 0);
  const paidBreaks = Math.min(breaks, allowance);

  return {
    worked: Math.max(0, roundMinutes(gross - (breaks - paidBreaks), policy)),
    breaks,
    paidBreaks,
  };
};

interface Buckets {
  readonly regularCandidateMinutes: number;
  readonly overtimeCandidateMinutes: number;
  readonly unpaidMinutes: number;
  readonly absenceMinutes: number;
}

/**
 * Worked time, split into the buckets Payroll will read.
 *
 * Overtime begins beyond the expected day *plus* the policy's threshold, so a tenant who has
 * configured nothing gets overtime the moment the day is exceeded and a tenant who has configured
 * fifteen minutes gets a quarter of an hour of tolerance. Neither figure ships.
 *
 * Absence is what was expected and not worked, less whatever leave covered — and when Leave cannot
 * be asked, it is still counted as absence *minutes* while the day's exception says plainly that
 * nobody could check (ADR-0056).
 */
const bucketsOf = (worked: Worked, expected: number, input: CalculationInput): Buckets => {
  const overtimeFrom = expected + input.policy.overtimeThresholdMinutes;
  const overtime = Math.max(0, worked.worked - overtimeFrom);
  const shortfall = Math.max(0, expected - worked.worked - input.leave.minutes);

  return {
    regularCandidateMinutes: worked.worked - overtime,
    overtimeCandidateMinutes: overtime,
    // Unpaid break time is already out of `worked`. It is named separately so Payroll does not
    // have to derive the difference between what somebody was present for and what they are
    // credited with — a derivation two consumers would do two ways.
    unpaidMinutes: worked.breaks - worked.paidBreaks,
    absenceMinutes: shortfall,
  };
};

const punctuality = (
  pairing: Pairing,
  bounds: Bounds,
  input: CalculationInput,
): readonly DetectedException[] => {
  const start = bounds.instants.expectedStartAt;
  const end = bounds.instants.expectedEndAt;
  const shift = input.expectation.shift;

  if (shift === undefined || start === undefined || end === undefined) return [];

  const found: DetectedException[] = [];
  // A flexible shift is measured against its core hours where it has them: arriving at 10:00 on a
  // shift whose core begins at 10:00 is not lateness, it is the arrangement working.
  const lateAfter = shift.graceInMinutes + input.policy.lateToleranceMinutes;
  const earlyBefore = shift.graceOutMinutes + input.policy.earlyDepartureToleranceMinutes;

  if (pairing.firstIn !== undefined) {
    const late = minutesBetween(coreStart(shift, start), pairing.firstIn);

    if (late > lateAfter) found.push({ kind: 'late_arrival', severity: 'warning', minutes: late });
  }
  if (pairing.lastOut !== undefined) {
    const early = minutesBetween(pairing.lastOut, coreEnd(shift, end));

    if (early > earlyBefore) {
      found.push({ kind: 'early_departure', severity: 'warning', minutes: early });
    }
  }
  return found;
};

const coreStart = (shift: ShiftState, expectedStart: Date): Date => {
  if (shift.kind !== 'flexible' || shift.flexWindowMinutes === undefined) return expectedStart;
  return new Date(expectedStart.getTime() + shift.flexWindowMinutes * 60_000);
};

const coreEnd = (shift: ShiftState, expectedEnd: Date): Date => {
  if (shift.kind !== 'flexible' || shift.flexWindowMinutes === undefined) return expectedEnd;
  return new Date(expectedEnd.getTime() - shift.flexWindowMinutes * 60_000);
};

/** Punches that do not pair, and punches that make no sense where they are. */
const completeness = (pairing: Pairing, input: CalculationInput): readonly DetectedException[] => {
  const found: DetectedException[] = pairing.unmatched.map((event) => ({
    kind:
      event.kind === 'clock_in' || event.kind === 'break_start'
        ? 'missing_clock_out'
        : 'missing_clock_in',
    // Blocking, because a day whose end is unknown has no defensible worked figure and must not be
    // signed off or frozen into a payable snapshot.
    severity: 'blocking',
    detail: event.id,
  }));

  for (const event of pairing.invalid) {
    found.push({ kind: 'invalid_punch', severity: 'warning', detail: event.id });
  }
  if (input.wasApproved && input.events.length > 0) {
    found.push({ kind: 'late_event_after_approval', severity: 'warning' });
  }
  return found;
};

/** Whether somebody was where they were expected, and whether they were expected at all. */
const presence = (
  pairing: Pairing,
  bounds: Bounds,
  input: CalculationInput,
): readonly DetectedException[] => {
  const attended = pairing.work.length > 0 || pairing.unmatched.length > 0;
  const expected = bounds.expectedMinutes > 0;

  if (expected && !attended) return [absenceException(input)];
  if (!attended) return [];

  const entry = input.expectation.rosterEntry;

  if (entry?.kind === 'rest') return [{ kind: 'rest_day_work', severity: 'information' }];
  if (entry?.kind === 'holiday') return [{ kind: 'holiday_work', severity: 'information' }];
  if (!expected) return [{ kind: 'unscheduled_attendance', severity: 'warning' }];
  return [];
};

/**
 * The difference between "nobody can tell" and "somebody checked".
 *
 * With Leave unavailable the answer is `absence_pending_explanation`, never `absent_unexplained`.
 * Asserting that an employee was absent without leave when the system has no way to know is a false
 * statement on their record, and it is the one this module refuses to make (ADR-0056).
 */
const absenceException = (input: CalculationInput): DetectedException => {
  const blocking = input.policy.absenceBlocksApproval;

  if (input.leave.state === 'unknown') {
    return {
      kind: 'absence_pending_explanation',
      severity: blocking ? 'blocking' : 'warning',
    };
  }
  if (input.leave.state === 'applied') {
    return { kind: 'undertime', severity: 'information' };
  }
  return { kind: 'absent_unexplained', severity: blocking ? 'blocking' : 'warning' };
};

const overtime = (
  candidateMinutes: number,
  input: CalculationInput,
): readonly DetectedException[] => {
  if (candidateMinutes === 0) return [];
  return [
    {
      kind: 'overtime_candidate',
      // Blocking only where the tenant said overtime needs a decision. Attendance never decides
      // that it does: whether unapproved overtime is payable is a policy and a jurisdiction
      // question, not a product opinion.
      severity: input.policy.overtimeRequiresApproval ? 'blocking' : 'information',
      minutes: candidateMinutes,
    },
  ];
};

/**
 * A fingerprint of everything the calculation read.
 *
 * Two things depend on it. **Reproducibility**: the same digest and the same version must give the
 * same result, and a test asserts it. **Staleness**: a day whose digest would differ is a day whose
 * inputs moved, which is how recalculation is found by asking rather than by being told (ADR-0053).
 */
const digestOf = (input: CalculationInput): string => {
  const parts = [
    input.attendanceDate,
    input.expectation.zone,
    input.expectation.dayKind,
    input.expectation.shift?.id ?? '-',
    input.expectation.scheduleId ?? '-',
    String(input.expectation.scheduleVersion ?? 0),
    input.expectation.rosterEntry?.id ?? '-',
    input.policy.id,
    String(input.policy.versionNumber),
    input.leave.state,
    String(input.leave.minutes),
    ...live(input.events).map((event) => `${event.id}:${event.occurredAt.toISOString()}`),
  ].join('|');

  return createHash('sha256').update(parts).digest('hex').slice(0, 64);
};
