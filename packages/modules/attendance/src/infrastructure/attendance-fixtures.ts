import { uuidV7 } from '@work/kernel';

import { AttendanceDay } from '../domain/attendance-day.js';
import { AttendancePolicy } from '../domain/attendance-policy.js';
import { Schedule, scheduleAssignment, scheduleDay } from '../domain/schedule.js';
import { Shift, shiftSegment } from '../domain/shift.js';
import { recordTimeEvent } from '../domain/time-event.js';
import { requestCorrection } from '../domain/correction.js';
import { rosterEntry } from '../domain/roster-entry.js';
import type { AttendanceDayState } from '../domain/attendance-day-state.js';
import type { CorrectionRequestState } from '../domain/correction.js';
import type { PolicyState } from '../domain/attendance-policy.js';
import type { RosterEntryState } from '../domain/roster-entry.js';
import type {
  ScheduleAssignmentState,
  ScheduleDayState,
  ScheduleState,
} from '../domain/schedule.js';
import type { SegmentState, ShiftState } from '../domain/shift.js';
import type { TimeEventState } from '../domain/time-event.js';
import type { SnapshotState } from '../application/attendance-ports.js';

/**
 * Domain states for the integration suites, built through the real constructors.
 *
 * Through the constructors rather than as object literals, because the rows these produce have to
 * satisfy the migration's check constraints — and a literal that quietly violated one would fail
 * with a constraint name rather than with the rule it broke.
 */

export const NOW = new Date('2026-05-04T09:00:00Z');

const unwrap = <TValue>(result: { ok: boolean; value?: TValue; error?: unknown }): TValue => {
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value as TValue;
};

export const aShift = (tenantId: string): ShiftState =>
  unwrap(
    Shift.define(
      {
        tenantId,
        code: `day-${uuidV7().slice(-12)}`,
        name: { en: 'Day shift', ar: 'الوردية الصباحية' },
        kind: 'fixed',
        startLocal: '08:00',
        endLocal: '17:00',
      },
      NOW,
    ),
  ).snapshot();

export const aSegment = (tenantId: string, shiftId: string): SegmentState =>
  unwrap(
    shiftSegment(
      { tenantId, shiftId, sequence: 1, kind: 'work', startLocal: '08:00', endLocal: '17:00' },
      NOW,
    ),
  );

export const aSchedule = (tenantId: string, zone = 'Asia/Riyadh'): ScheduleState =>
  unwrap(
    Schedule.define(
      {
        tenantId,
        code: `weekly-${uuidV7().slice(-12)}`,
        name: { en: 'Weekly', ar: 'أسبوعي' },
        zone,
        cycleLengthDays: 7,
        cycleAnchorDate: '2026-05-04',
      },
      NOW,
    ),
  ).snapshot();

export const aScheduleDay = (
  tenantId: string,
  scheduleId: string,
  shiftId: string,
): ScheduleDayState =>
  unwrap(scheduleDay({ tenantId, scheduleId, shiftId, cyclePosition: 0, cycleLengthDays: 7 }, NOW));

export const anAssignment = (
  tenantId: string,
  employmentId: string,
  scheduleId: string,
): ScheduleAssignmentState =>
  unwrap(
    scheduleAssignment({ tenantId, employmentId, scheduleId, effectiveFrom: '2026-01-01' }, NOW),
  );

export const aPolicyState = (tenantId: string): PolicyState =>
  unwrap(
    AttendancePolicy.define(
      {
        tenantId,
        code: `standard-${uuidV7().slice(-12)}`,
        name: { en: 'Standard', ar: 'قياسي' },
        effectiveFrom: '2026-01-01',
      },
      NOW,
    ),
  ).snapshot();

export const aRosterEntry = (
  tenantId: string,
  employmentId: string,
  onDate = '2026-05-04',
): RosterEntryState =>
  unwrap(rosterEntry({ tenantId, employmentId, onDate, kind: 'rest', reasonCode: 'swapped' }, NOW));

export interface EventOverrides {
  readonly idempotencyKey?: string;
  readonly kind?: TimeEventState['kind'];
  readonly reportedAt?: Date;
  readonly deviceReference?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export const anEvent = (
  tenantId: string,
  employmentId: string,
  overrides: EventOverrides = {},
): TimeEventState => {
  const reportedAt = overrides.reportedAt ?? new Date('2026-05-04T05:00:00Z');
  const location =
    overrides.latitude === undefined || overrides.longitude === undefined
      ? {}
      : {
          location: {
            latitude: overrides.latitude,
            longitude: overrides.longitude,
            accuracyMetres: 12,
          },
        };

  return unwrap(
    recordTimeEvent({
      tenantId,
      employmentId,
      kind: overrides.kind ?? 'clock_in',
      source: 'device',
      ...(overrides.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: overrides.idempotencyKey }),
      ...(overrides.deviceReference === undefined
        ? {}
        : { deviceReference: overrides.deviceReference }),
      ...location,
      reportedAt,
      receivedAt: reportedAt,
      zone: 'Asia/Riyadh',
      attendanceDate: '2026-05-04',
      clockSkewToleranceSeconds: 300,
    }),
  );
};

export const aDay = (
  tenantId: string,
  employmentId: string,
  attendanceDate = '2026-05-04',
): AttendanceDayState =>
  AttendanceDay.open(
    { tenantId, employmentId, attendanceDate, zone: 'Asia/Riyadh' },
    NOW,
  ).snapshot();

export const aCorrection = (
  tenantId: string,
  employmentId: string,
  requestedBy: string,
): CorrectionRequestState =>
  unwrap(
    requestCorrection(
      {
        tenantId,
        employmentId,
        attendanceDate: '2026-05-04',
        kind: 'add_event',
        proposedKind: 'clock_out',
        proposedOccurredAt: new Date('2026-05-04T14:00:00Z'),
        reasonCode: 'reader-offline',
        justification: 'The lobby reader was down; security logged the departure.',
        requestedBy,
      },
      NOW,
    ),
  );

/** An approved-removal request, which names the event it takes out and proposes nothing. */
export const aRemoval = (
  tenantId: string,
  employmentId: string,
  targetEventId: string,
  requestedBy: string,
): CorrectionRequestState =>
  unwrap(
    requestCorrection(
      {
        tenantId,
        employmentId,
        attendanceDate: '2026-05-04',
        kind: 'remove_event',
        targetEventId,
        reasonCode: 'duplicate-reader',
        justification: 'The second reader recorded the same arrival twice.',
        requestedBy,
      },
      NOW,
    ),
  );

export const aSnapshot = (
  tenantId: string,
  employmentId: string,
  sequence: number,
): SnapshotState => ({
  id: uuidV7(NOW.getTime() + sequence),
  tenantId,
  employmentId,
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  sequence,
  frozenAt: NOW,
  frozenBy: 'user:payroll',
  workedMinutes: 9600,
  regularCandidateMinutes: 9600,
  overtimeCandidateMinutes: 0,
  unpaidMinutes: 0,
  absenceMinutes: 0,
  leaveMinutes: 0,
  leaveState: 'unknown',
  daysTotal: 21,
  daysApproved: 21,
  daysUnapproved: 0,
  blockingExceptions: 0,
  calculationVersion: 1,
  inputsDigest: 'a'.repeat(64),
  version: 0,
});
