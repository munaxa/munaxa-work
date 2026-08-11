import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  AttendancePolicy,
  INERT_POLICY,
  roundMinutes,
  type PolicyState,
} from './attendance-policy.js';
import { Shift, shiftSegment, type SegmentState, type ShiftState } from './shift.js';
import { calculate, type CalculationInput, type Expectation } from './calculation.js';
import type { PairableEvent } from './pairing.js';
import { rosterEntry } from './roster-entry.js';
import { instantAt } from './zoned-time.js';

/**
 * What a day of punches is worth in minutes.
 *
 * Split from `attendance-domain.test.ts` for size, along the seam that matters: that file proves
 * *when* something happened — the zone rules everything else rests on — and this one proves what
 * follows from it. Ingestion, corrections and rostering are in `attendance-capture.test.ts`.
 *
 * Every figure here is minutes. Not one of them is money: what worked time is worth is
 * Compensation's and Payroll's, and a test that asserted an amount would be asserting a decision
 * this module refuses to make (ADR-0054).
 */

const TENANT = uuidV7();
const NOW = new Date('2026-08-10T09:00:00Z');
const RIYADH = 'Asia/Riyadh';

const unwrap = <TValue>(result: { ok: boolean; value?: TValue; error?: unknown }): TValue => {
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value as TValue;
};

describe('The calculation is deterministic, and it produces candidates rather than pay', () => {
  const policy = (overrides: Partial<PolicyState> = {}): PolicyState => ({
    ...unwrap(
      AttendancePolicy.define(
        {
          tenantId: TENANT,
          code: 'standard',
          name: { en: 'Standard', ar: 'قياسي' },
          effectiveFrom: '2026-01-01',
        },
        NOW,
      ),
    ).snapshot(),
    ...overrides,
  });

  const shiftFor = (start: string, end: string, kind: ShiftState['kind'] = 'fixed'): ShiftState =>
    unwrap(
      Shift.define(
        {
          tenantId: TENANT,
          code: 'day',
          name: { en: 'Day', ar: 'يوم' },
          kind,
          startLocal: start,
          endLocal: end,
          ...(kind === 'flexible' ? { flexWindowMinutes: 60 } : {}),
        },
        NOW,
      ),
    ).snapshot();

  const segmentsFor = (shiftId: string, paidBreak: boolean): readonly SegmentState[] => [
    unwrap(
      shiftSegment(
        {
          tenantId: TENANT,
          shiftId,
          sequence: 1,
          kind: 'work',
          startLocal: '08:00',
          endLocal: '17:00',
        },
        NOW,
      ),
    ),
    unwrap(
      shiftSegment(
        {
          tenantId: TENANT,
          shiftId,
          sequence: 2,
          kind: 'break',
          startLocal: '12:00',
          endLocal: '12:30',
          paid: paidBreak,
        },
        NOW,
      ),
    ),
  ];

  const inputFor = (
    events: readonly PairableEvent[],
    overrides: Partial<CalculationInput> = {},
  ): CalculationInput => {
    const shift = shiftFor('08:00', '17:00');
    const expectation: Expectation = {
      dayKind: 'working',
      zone: RIYADH,
      shift,
      segments: segmentsFor(shift.id, false),
      scheduleId: 'schedule-1',
      scheduleVersion: 1,
    };

    return {
      attendanceDate: '2026-05-04',
      events,
      expectation,
      policy: policy(),
      leave: { state: 'unknown', minutes: 0 },
      wasApproved: false,
      ...overrides,
    };
  };

  const punch = (
    kind: PairableEvent['kind'],
    time: string,
    date = '2026-05-04',
  ): PairableEvent => ({
    id: `${kind}-${time}`,
    kind,
    occurredAt: instantAt(date, time, RIYADH),
  });

  it('produces the same digest and the same buckets for the same inputs', () => {
    const input = inputFor([punch('clock_in', '08:00'), punch('clock_out', '17:00')]);
    const first = calculate(input);
    const second = calculate(input);

    expect(first.inputsDigest).toBe(second.inputsDigest);
    expect(first.workedMinutes).toBe(second.workedMinutes);
    expect(first.inputsDigest).toHaveLength(64);
  });

  it('deducts an unpaid break and keeps a paid one', () => {
    const events = [
      punch('clock_in', '08:00'),
      punch('break_start', '12:00'),
      punch('break_end', '12:30'),
      punch('clock_out', '17:00'),
    ];
    const shift = shiftFor('08:00', '17:00');
    const unpaid = calculate(inputFor(events));
    const paid = calculate(
      inputFor(events, {
        expectation: {
          dayKind: 'working',
          zone: RIYADH,
          shift,
          segments: segmentsFor(shift.id, true),
        },
      }),
    );

    expect(unpaid.workedMinutes).toBe(510);
    expect(unpaid.unpaidMinutes).toBe(30);
    expect(paid.workedMinutes).toBe(540);
    expect(paid.paidBreakMinutes).toBe(30);
  });

  /** Candidate minutes, and nothing that resembles money. */
  it('splits worked time into regular and overtime candidates at the policy threshold', () => {
    const events = [punch('clock_in', '08:00'), punch('clock_out', '19:00')];
    const none = calculate(inputFor(events));
    const tolerant = calculate(
      inputFor(events, { policy: policy({ overtimeThresholdMinutes: 60 }) }),
    );

    expect(none.workedMinutes).toBe(660);
    expect(none.overtimeCandidateMinutes).toBe(120);
    expect(none.regularCandidateMinutes).toBe(540);
    expect(tolerant.overtimeCandidateMinutes).toBe(60);
  });

  it('forgives lateness inside grace and reports it beyond', () => {
    const shift = { ...shiftFor('08:00', '17:00'), graceInMinutes: 10 };
    const within = calculate(
      inputFor([punch('clock_in', '08:08'), punch('clock_out', '17:00')], {
        expectation: { dayKind: 'working', zone: RIYADH, shift, segments: [] },
      }),
    );
    const beyond = calculate(
      inputFor([punch('clock_in', '08:20'), punch('clock_out', '17:00')], {
        expectation: { dayKind: 'working', zone: RIYADH, shift, segments: [] },
      }),
    );

    expect(within.exceptions.map((one) => one.kind)).not.toContain('late_arrival');
    expect(beyond.exceptions.find((one) => one.kind === 'late_arrival')?.minutes).toBe(20);
  });

  /** A flexible shift is measured against its core, not its nominal start. */
  it('does not call a flexible arrival late inside the flex window', () => {
    const shift = shiftFor('08:00', '17:00', 'flexible');
    const result = calculate(
      inputFor([punch('clock_in', '08:45'), punch('clock_out', '17:00')], {
        expectation: { dayKind: 'working', zone: RIYADH, shift, segments: [] },
      }),
    );

    expect(result.exceptions.map((one) => one.kind)).not.toContain('late_arrival');
  });

  it('measures an overnight shift that ends on the following civil date', () => {
    const shift = shiftFor('22:00', '06:00');
    const result = calculate(
      inputFor([punch('clock_in', '22:00'), punch('clock_out', '06:00', '2026-05-05')], {
        expectation: { dayKind: 'working', zone: RIYADH, shift, segments: [] },
      }),
    );

    expect(result.workedMinutes).toBe(480);
    expect(result.expectedMinutes).toBe(480);
    expect(result.absenceMinutes).toBe(0);
  });

  /**
   * The distinction the phase turns on. With Leave unavailable the answer is "nobody can tell",
   * not "absent without leave" — the second is a statement about a person that the system has no
   * way to support.
   */
  it('says an absence is pending explanation when Leave cannot be asked', () => {
    const unknown = calculate(inputFor([]));
    const noLeave = calculate(inputFor([], { leave: { state: 'none', minutes: 0 } }));
    const onLeave = calculate(inputFor([], { leave: { state: 'applied', minutes: 540 } }));

    expect(unknown.exceptions.map((one) => one.kind)).toContain('absence_pending_explanation');
    expect(unknown.exceptions.map((one) => one.kind)).not.toContain('absent_unexplained');
    expect(noLeave.exceptions.map((one) => one.kind)).toContain('absent_unexplained');
    expect(onLeave.absenceMinutes).toBe(0);
    expect(onLeave.exceptions.map((one) => one.kind)).not.toContain('absent_unexplained');
  });

  it('reports attendance on a rest day and on an unscheduled day differently', () => {
    const rest = calculate(
      inputFor([punch('clock_in', '08:00'), punch('clock_out', '12:00')], {
        expectation: {
          dayKind: 'rest',
          zone: RIYADH,
          segments: [],
          rosterEntry: unwrap(
            rosterEntry(
              { tenantId: TENANT, employmentId: uuidV7(), onDate: '2026-05-04', kind: 'rest' },
              NOW,
            ),
          ),
        },
      }),
    );
    const unscheduled = calculate(
      inputFor([punch('clock_in', '08:00'), punch('clock_out', '12:00')], {
        expectation: { dayKind: 'unscheduled', zone: RIYADH, segments: [] },
      }),
    );

    expect(rest.exceptions.map((one) => one.kind)).toContain('rest_day_work');
    expect(unscheduled.exceptions.map((one) => one.kind)).toContain('unscheduled_attendance');
  });

  it('blocks approval when a punch is missing', () => {
    const result = calculate(inputFor([punch('clock_in', '08:00')]));
    const missing = result.exceptions.find((one) => one.kind === 'missing_clock_out');

    expect(missing?.severity).toBe('blocking');
  });

  it('asks a human when an event lands after the day was signed off', () => {
    const result = calculate(
      inputFor([punch('clock_in', '08:00'), punch('clock_out', '17:00')], { wasApproved: true }),
    );

    expect(result.exceptions.map((one) => one.kind)).toContain('late_event_after_approval');
  });

  it('rounds once, the way the policy says', () => {
    const nearest = policy({ roundingMinutes: 15, roundingMode: 'nearest' });
    const down = policy({ roundingMinutes: 15, roundingMode: 'down' });

    expect(roundMinutes(517, nearest)).toBe(510);
    expect(roundMinutes(517, down)).toBe(510);
    expect(roundMinutes(523, nearest)).toBe(525);
    expect(roundMinutes(523, INERT_POLICY as unknown as PolicyState)).toBe(523);
  });
});
