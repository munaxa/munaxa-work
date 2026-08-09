import { uuidV7, type HandlerFailure, type Result } from '@work/kernel';

import type { ShiftKind } from '../domain/attendance-vocabulary.js';

import { send, type Harness } from './attendance-test-harness.js';

/**
 * Builders for the shapes the edge-case suite needs: a night shift, a split shift, a flexible
 * shift, a schedule in a named zone.
 *
 * Separate from the shared harness because these are the *awkward* configurations rather than the
 * ordinary one, and everything here goes through the real commands for the same reason the harness
 * does — a fixture that wrote a published shift straight into the store would quietly disable the
 * rule that a published definition is immutable.
 */

const must = <TResult>(result: Result<TResult, HandlerFailure>, what: string): TResult => {
  if (!result.ok) throw new Error(`Could not ${what}: ${JSON.stringify(result.error)}`);
  return result.value;
};

export interface SegmentSpec {
  readonly sequence: number;
  readonly kind: 'work' | 'break' | 'core' | 'flex';
  readonly startLocal: string;
  readonly endLocal: string;
  readonly paid?: boolean;
}

export interface ShiftSpec {
  readonly kind: ShiftKind;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly segments: readonly SegmentSpec[];
  readonly flexWindowMinutes?: number;
  readonly graceInMinutes?: number;
  readonly graceOutMinutes?: number;
  readonly expectedMinutes?: number;
}

/** A published shift of any shape. Returns its identifier. */
export const aPublishedShift = async (harness: Harness, spec: ShiftSpec): Promise<string> => {
  const suffix = uuidV7().slice(-12);
  const { shiftId } = must<{ shiftId: string }>(
    await send(harness, {
      commandName: 'attendance.define-shift',
      code: `shift-${suffix}`,
      name: { en: 'Shift', ar: 'وردية' },
      kind: spec.kind,
      startLocal: spec.startLocal,
      endLocal: spec.endLocal,
      ...(spec.flexWindowMinutes === undefined
        ? {}
        : { flexWindowMinutes: spec.flexWindowMinutes }),
      ...(spec.graceInMinutes === undefined ? {} : { graceInMinutes: spec.graceInMinutes }),
      ...(spec.graceOutMinutes === undefined ? {} : { graceOutMinutes: spec.graceOutMinutes }),
      ...(spec.expectedMinutes === undefined ? {} : { expectedMinutes: spec.expectedMinutes }),
    }),
    'define a shift',
  );

  for (const segment of spec.segments) {
    must(
      await send(harness, {
        commandName: 'attendance.add-shift-segment',
        shiftId,
        sequence: segment.sequence,
        kind: segment.kind,
        startLocal: segment.startLocal,
        endLocal: segment.endLocal,
        ...(segment.paid === undefined ? {} : { paid: segment.paid }),
      }),
      'add a segment',
    );
  }
  must(
    await send(harness, {
      commandName: 'attendance.publish-shift',
      shiftId,
      expectedVersion: 1,
    }),
    'publish the shift',
  );
  return shiftId;
};

/** A published policy with whatever tolerances the scenario needs. */
export const aPolicy = async (
  harness: Harness,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<string> => {
  const { policyId } = must<{ policyId: string }>(
    await send(harness, {
      commandName: 'attendance.define-policy',
      code: `policy-${uuidV7().slice(-12)}`,
      name: { en: 'Policy', ar: 'سياسة' },
      effectiveFrom: '2026-01-01',
      ...overrides,
    }),
    'define a policy',
  );

  must(
    await send(harness, {
      commandName: 'attendance.publish-policy',
      policyId,
      expectedVersion: 1,
    }),
    'publish the policy',
  );
  return policyId;
};

export interface ScheduleSpec {
  readonly zone: string;
  readonly cycleLengthDays?: number;
  readonly cycleAnchorDate?: string;
  /** Cycle position → shift. A position with no entry is a rest day, and that is the answer. */
  readonly places: Readonly<Record<number, string>>;
}

/** A published schedule running the given shifts at the given cycle positions. */
export const aPublishedSchedule = async (harness: Harness, spec: ScheduleSpec): Promise<string> => {
  const { scheduleId } = must<{ scheduleId: string }>(
    await send(harness, {
      commandName: 'attendance.define-schedule',
      code: `schedule-${uuidV7().slice(-12)}`,
      name: { en: 'Schedule', ar: 'جدول' },
      zone: spec.zone,
      cycleLengthDays: spec.cycleLengthDays ?? 7,
      cycleAnchorDate: spec.cycleAnchorDate ?? '2026-05-04',
    }),
    'define a schedule',
  );

  for (const [position, shiftId] of Object.entries(spec.places)) {
    must(
      await send(harness, {
        commandName: 'attendance.place-shift',
        scheduleId,
        cyclePosition: Number(position),
        shiftId,
      }),
      'place a shift',
    );
  }
  must(
    await send(harness, {
      commandName: 'attendance.publish-schedule',
      scheduleId,
      expectedVersion: 1,
    }),
    'publish the schedule',
  );
  return scheduleId;
};

/** An employment in the fake directory, assigned to a schedule from a date. */
export const anEmploymentOn = async (
  harness: Harness,
  scheduleId: string,
  effectiveFrom = '2026-01-01',
): Promise<string> => {
  const employment = harness.employment.add({});

  must(
    await send(harness, {
      commandName: 'attendance.assign-schedule',
      employmentId: employment.employmentId,
      scheduleId,
      effectiveFrom,
    }),
    'assign the schedule',
  );
  return employment.employmentId;
};
