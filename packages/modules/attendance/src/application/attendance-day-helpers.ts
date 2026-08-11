import { ask, send, testClock, type Harness } from './attendance-test-harness.js';
import type { EventRecorded } from './ingest.use-case.js';
import type { AttendanceDaySnapshot } from '../contracts/views.js';

/**
 * The four things every end-to-end attendance test does: punch, recalculate, read the day, and ask
 * what the calculation found.
 *
 * Shared rather than repeated because the punch helper carries a decision the suites depend on and
 * would otherwise each restate differently. See `punch`.
 */

/**
 * Records a punch as a server would receive it: at about the time it happened.
 *
 * The clock is advanced deliberately rather than left frozen, because ingestion disbelieves a
 * client whose claim diverges from the server's receipt by more than the policy's tolerance — and a
 * test that punched at 08:00 while the server thought it was 12:00 would be testing the skew rule
 * rather than the thing it meant to test. The skew rule has its own tests.
 */
export const punch = async (
  harness: Harness,
  employmentId: string,
  kind: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
  at: Date,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<EventRecorded> => {
  testClock.value = at;

  const result = await send<EventRecorded>(harness, {
    commandName: 'attendance.record-event',
    employmentId,
    kind,
    source: 'device',
    reportedAt: at,
    ...extra,
  });

  if (!result.ok) throw new Error(`Ingestion failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const readDay = async (
  harness: Harness,
  employmentId: string,
  attendanceDate = '2026-05-04',
): Promise<AttendanceDaySnapshot> => {
  const result = await ask<AttendanceDaySnapshot>(harness, {
    queryName: 'attendance.read-day',
    employmentId,
    attendanceDate,
  });

  if (!result.ok) throw new Error(`Could not read the day: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const recalculate = (harness: Harness): Promise<unknown> =>
  send(harness, { commandName: 'attendance.recalculate' });

export const kindsOn = (snapshot: AttendanceDaySnapshot): readonly string[] =>
  snapshot.exceptions.map((one) => one.kind);

/** A wall-clock time in Riyadh, as an instant. The zone the shared fixtures are configured in. */
export const punchAt = (time: string, date = '2026-05-04'): Date =>
  new Date(`${date}T${time}:00+03:00`);
