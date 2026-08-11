import type { AttendanceStores } from '../application/attendance-ports.js';

import { AttendanceDayRepository } from './day.repository.js';
import {
  CorrectionRepository,
  ImportBatchRepository,
  SnapshotRepository,
} from './correction.repository.js';
import { ExceptionRepository } from './exception.repository.js';
import { PolicyRepository, RosterRepository } from './roster.repository.js';
import {
  AssignmentRepository,
  ScheduleDayRepository,
  ScheduleRepository,
} from './schedule.repository.js';
import { SegmentRepository, ShiftRepository } from './shift.repository.js';
import { TimeEventRepository } from './time-event.repository.js';

/**
 * The PostgreSQL implementation of every store the application declares.
 *
 * Assembled here so the composition root wires one thing rather than thirteen, and so that swapping
 * an implementation is one edit rather than a search. The repositories hold no state and no
 * connection — every method takes the `Transaction` — so one instance each is correct and a
 * per-request factory would only be ceremony.
 */
export const postgresAttendanceStores = (): AttendanceStores => ({
  events: new TimeEventRepository(),
  days: new AttendanceDayRepository(),
  exceptions: new ExceptionRepository(),
  shifts: new ShiftRepository(),
  segments: new SegmentRepository(),
  schedules: new ScheduleRepository(),
  scheduleDays: new ScheduleDayRepository(),
  assignments: new AssignmentRepository(),
  rosters: new RosterRepository(),
  policies: new PolicyRepository(),
  corrections: new CorrectionRepository(),
  snapshots: new SnapshotRepository(),
  imports: new ImportBatchRepository(),
});
