import type {
  AttendanceDashboardView,
  AttendanceDaySnapshot,
  AttendanceDayView,
  AttendanceExceptionView,
  CorrectionView,
  ImportBatchView,
  RosterEntryView,
  ScheduleView,
  ShiftView,
  TimeEventView,
} from '@work/attendance/contracts';
import type { EmploymentView } from '@work/employment/contracts';

import type { AttendanceRegister, DayForDisplay } from './api';

/**
 * The attendance data the tests render, shaped by the module's published contracts.
 *
 * Every field is one the contract declares, so a fixture that drifts from the module fails to
 * compile rather than passing a test against a shape the API never produces.
 *
 * The values exercise the distinctions this slice exists to keep: all three leave states, a
 * superseded punch beside the one that replaced it, exceptions across all three severities, and
 * **three employments whose UUIDv7 identifiers share a timestamp prefix** — which is what a page of
 * rows written by one import batch actually looks like, and what makes truncation render three
 * identical cells.
 */

export const EMPLOYMENT_A = '01900000-0000-7000-8000-00000000e001';
export const EMPLOYMENT_B = '01900000-0000-7000-8000-00000000e002';
export const EMPLOYMENT_C = '01900000-0000-7000-8000-00000000e003';
export const ON_DATE = '2026-08-24';
export const SHIFT_DAY = '01900000-0000-7000-8000-00000000s001';
export const EVENT_ORIGINAL = '01900000-0000-7000-8000-00000000v001';
export const EVENT_REPLACEMENT = '01900000-0000-7000-8000-00000000v002';

const dashboard: AttendanceDashboardView = {
  onDate: ON_DATE,
  expected: 412,
  present: 388,
  absencePendingExplanation: 9,
  late: 23,
  openExceptions: 41,
  awaitingRecalculation: 6,
};

export const anAttendanceDay = (extra: Partial<AttendanceDayView> = {}): AttendanceDayView => ({
  attendanceDayId: '01900000-0000-7000-8000-00000000w001',
  employmentId: EMPLOYMENT_A,
  attendanceDate: ON_DATE,
  zone: 'Asia/Riyadh',
  dayKind: 'working',
  state: 'calculated',
  expectedStartAt: new Date('2026-08-24T05:00:00.000Z'),
  expectedEndAt: new Date('2026-08-24T14:00:00.000Z'),
  expectedMinutes: 480,
  firstInAt: new Date('2026-08-24T05:17:00.000Z'),
  lastOutAt: new Date('2026-08-24T14:03:00.000Z'),
  workedMinutes: 466,
  breakMinutesTaken: 60,
  paidBreakMinutes: 0,
  regularCandidateMinutes: 466,
  overtimeCandidateMinutes: 0,
  unpaidMinutes: 0,
  absenceMinutes: 0,
  leaveState: 'none',
  leaveMinutes: 0,
  calculationVersion: 3,
  inputsDigest: 'sha256:9f2c',
  calculatedAt: new Date('2026-08-25T02:00:00.000Z'),
  version: 2,
  ...extra,
});

const days: readonly AttendanceDayView[] = [
  anAttendanceDay(),
  anAttendanceDay({
    attendanceDayId: '01900000-0000-7000-8000-00000000w002',
    employmentId: EMPLOYMENT_B,
    attendanceDate: '2026-08-23',
    state: 'approved',
    leaveState: 'applied',
    leaveMinutes: 240,
    workedMinutes: 240,
    approvedAt: new Date('2026-08-24T06:00:00.000Z'),
    approvedBy: '01900000-0000-7000-8000-00000000m001',
  }),
  anAttendanceDay({
    attendanceDayId: '01900000-0000-7000-8000-00000000w003',
    employmentId: EMPLOYMENT_C,
    attendanceDate: '2026-08-22',
    state: 'pending',
    leaveState: 'unknown',
    absenceMinutes: 480,
    workedMinutes: 0,
    inputsChangedAt: new Date('2026-08-25T04:00:00.000Z'),
  }),
];

export const anException = (
  extra: Partial<AttendanceExceptionView> = {},
): AttendanceExceptionView => ({
  exceptionId: '01900000-0000-7000-8000-00000000x001',
  attendanceDayId: '01900000-0000-7000-8000-00000000w001',
  employmentId: EMPLOYMENT_A,
  attendanceDate: ON_DATE,
  kind: 'late_arrival',
  severity: 'warning',
  state: 'open',
  minutes: 17,
  version: 1,
  ...extra,
});

/** `exactOptionalPropertyTypes` forbids an explicit `undefined`, so the key is removed instead. */
const withoutMinutes = (exception: AttendanceExceptionView): AttendanceExceptionView => {
  const { minutes: _minutes, ...rest } = exception;

  return rest;
};

const exceptions: readonly AttendanceExceptionView[] = [
  anException(),
  anException({
    exceptionId: '01900000-0000-7000-8000-00000000x002',
    employmentId: EMPLOYMENT_B,
    kind: 'overtime_candidate',
    severity: 'information',
    minutes: 45,
  }),
  // A blocking exception with no minutes at all: "no departure was recorded" has no duration,
  // and the screen must render the absence rather than a zero.
  withoutMinutes(
    anException({
      exceptionId: '01900000-0000-7000-8000-00000000x003',
      employmentId: EMPLOYMENT_C,
      kind: 'missing_clock_out',
      severity: 'blocking',
    }),
  ),
];

/** The original punch, and the one a correction wrote to replace it. */
export const events: readonly TimeEventView[] = [
  {
    eventId: EVENT_ORIGINAL,
    employmentId: EMPLOYMENT_A,
    kind: 'clock_in',
    source: 'device',
    occurredAt: new Date('2026-08-24T05:17:00.000Z'),
    reportedAt: new Date('2026-08-24T05:17:03.000Z'),
    receivedAt: new Date('2026-08-24T05:17:05.000Z'),
    clockSkewSeconds: 2,
    capturedOffline: false,
    zone: 'Asia/Riyadh',
    attendanceDate: ON_DATE,
    deviceReference: 'TERM-04',
  },
  {
    eventId: EVENT_REPLACEMENT,
    employmentId: EMPLOYMENT_A,
    kind: 'clock_in',
    source: 'correction',
    occurredAt: new Date('2026-08-24T05:02:00.000Z'),
    reportedAt: new Date('2026-08-25T09:00:00.000Z'),
    receivedAt: new Date('2026-08-25T09:00:00.000Z'),
    clockSkewSeconds: 0,
    capturedOffline: false,
    zone: 'Asia/Riyadh',
    attendanceDate: ON_DATE,
    supersedesEventId: EVENT_ORIGINAL,
  },
  {
    eventId: '01900000-0000-7000-8000-00000000v003',
    employmentId: EMPLOYMENT_A,
    kind: 'clock_out',
    source: 'mobile',
    occurredAt: new Date('2026-08-24T14:03:00.000Z'),
    reportedAt: new Date('2026-08-24T14:03:00.000Z'),
    receivedAt: new Date('2026-08-24T18:40:00.000Z'),
    clockSkewSeconds: 47,
    capturedOffline: true,
    zone: 'Asia/Riyadh',
    attendanceDate: ON_DATE,
  },
];

const corrections: readonly CorrectionView[] = [
  {
    correctionId: '01900000-0000-7000-8000-00000000c001',
    employmentId: EMPLOYMENT_A,
    attendanceDate: ON_DATE,
    kind: 'amend_event',
    state: 'approved',
    targetEventId: EVENT_ORIGINAL,
    proposedOccurredAt: new Date('2026-08-24T05:02:00.000Z'),
    reasonCode: 'terminal-queue',
    justification: 'The gate terminal queued for fifteen minutes; the guard log confirms it.',
    requestedBy: '01900000-0000-7000-8000-00000000m002',
    requestedAt: new Date('2026-08-25T08:00:00.000Z'),
    decidedBy: '01900000-0000-7000-8000-00000000m001',
    decidedAt: new Date('2026-08-25T09:00:00.000Z'),
    resultingEventId: EVENT_REPLACEMENT,
    version: 2,
  },
];

const shifts: readonly ShiftView[] = [
  {
    shiftId: SHIFT_DAY,
    code: 'DAY-A',
    name: { en: 'Day shift A', ar: 'الوردية الصباحية أ' },
    kind: 'fixed',
    startLocal: '08:00',
    endLocal: '17:00',
    crossesMidnight: false,
    expectedMinutes: 480,
    graceInMinutes: 10,
    graceOutMinutes: 10,
    status: 'published',
    versionNumber: 2,
    publishedBy: '01900000-0000-7000-8000-00000000m001',
    version: 2,
  },
  {
    shiftId: '01900000-0000-7000-8000-00000000s002',
    code: 'NIGHT',
    name: { en: 'Night shift', ar: 'الوردية الليلية' },
    kind: 'night',
    startLocal: '22:00',
    endLocal: '06:00',
    crossesMidnight: true,
    expectedMinutes: 480,
    graceInMinutes: 15,
    graceOutMinutes: 15,
    status: 'draft',
    versionNumber: 1,
    version: 1,
  },
];

const schedules: readonly ScheduleView[] = [
  {
    scheduleId: '01900000-0000-7000-8000-00000000d001',
    code: 'STD-5-2',
    name: { en: 'Standard five-day week', ar: 'أسبوع عمل خمسة أيام' },
    zone: 'Asia/Riyadh',
    cycleLengthDays: 7,
    cycleAnchorDate: '2026-01-04',
    status: 'published',
    versionNumber: 3,
    version: 3,
  },
];

const roster: readonly RosterEntryView[] = [
  {
    rosterEntryId: '01900000-0000-7000-8000-00000000r001',
    employmentId: EMPLOYMENT_A,
    onDate: ON_DATE,
    kind: 'shift',
    shiftId: SHIFT_DAY,
    version: 1,
  },
  {
    rosterEntryId: '01900000-0000-7000-8000-00000000r002',
    employmentId: EMPLOYMENT_B,
    onDate: ON_DATE,
    kind: 'rest',
    version: 1,
  },
];

const imports: readonly ImportBatchView[] = [
  {
    batchId: '01900000-0000-7000-8000-00000000i001',
    source: 'device',
    sourceLabel: 'Gate terminals, overnight',
    submittedAt: new Date('2026-08-25T03:00:00.000Z'),
    submittedBy: '01900000-0000-7000-8000-00000000m003',
    rowsSubmitted: 4120,
    rowsCreated: 4108,
    rowsSkipped: 0,
    rowsFailed: 12,
  },
];

const employment: EmploymentView = {
  employmentId: EMPLOYMENT_A,
  employmentNumber: 'EMP-000417',
  personId: '01900000-0000-7000-8000-00000000p001',
  personName: { en: 'Layla Haddad', ar: 'ليلى حداد' },
  status: 'active',
  employmentTypeCode: 'full-time',
  originalHireDate: '2021-03-01',
  startDate: '2021-03-01',
  asOf: ON_DATE,
  metadata: {},
  version: 4,
};

const paged = <TItem>(items: readonly TItem[], total: number) => ({ items, total });

export const aFullRegister = (): AttendanceRegister => ({
  dashboard,
  exceptions: paged(exceptions, 41),
  days: paged(days, 9814),
  corrections: paged(corrections, 18),
  reconciliation: {
    total: 6,
    days: [
      {
        attendanceDayId: '01900000-0000-7000-8000-00000000w003',
        employmentId: EMPLOYMENT_C,
        attendanceDate: '2026-08-22',
        state: 'pending',
        inputsChangedAt: new Date('2026-08-25T04:00:00.000Z'),
      },
    ],
  },
  roster,
  shifts,
  schedules,
  imports,
});

export const anEmptyRegister = (): AttendanceRegister => ({
  dashboard: { ...dashboard, late: 0, openExceptions: 0, awaitingRecalculation: 0 },
  exceptions: paged([], 0),
  days: paged([], 0),
  corrections: paged([], 0),
  reconciliation: { total: 0, days: [] },
  roster: [],
  shifts: [],
  schedules: [],
  imports: [],
});

export const aRefusedRegister = (): AttendanceRegister => ({
  dashboard: undefined,
  exceptions: undefined,
  days: undefined,
  corrections: undefined,
  reconciliation: undefined,
  roster: undefined,
  shifts: undefined,
  schedules: undefined,
  imports: undefined,
});

export const aSnapshot = (extra: Partial<AttendanceDaySnapshot> = {}): AttendanceDaySnapshot => ({
  day: anAttendanceDay(),
  events,
  exceptions: [anException()],
  ...extra,
});

export const aDayDetail = (extra: Partial<DayForDisplay> = {}): DayForDisplay => ({
  snapshot: aSnapshot(),
  employment,
  shifts,
  corrections: paged(corrections, 18),
  ...extra,
});
