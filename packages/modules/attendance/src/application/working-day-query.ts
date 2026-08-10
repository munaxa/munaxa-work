import { success, type Query, type QueryHandler } from '@work/kernel';

import { AttendancePermissions } from './attendance-permissions.js';
import { DEFAULT_ZONE, resolveExpectation } from './expectation-resolution.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * What was expected of one employment, date by date — published so Leave does not have to guess.
 *
 * **Attendance already owns this answer.** It resolves roster → schedule assignment → unscheduled,
 * in the schedule's own zone, as at each date; it picks up a public holiday recorded as a roster
 * entry; and it reads a schedule assignment that was in force *then* rather than the one in force
 * now. A second module computing the same thing would be a second answer to "was Tuesday a working
 * day", and the two would disagree the first time a rota changed.
 *
 * So this query is **additive and derived**: a new read over `resolveExpectation`, with no schema
 * change, no behaviour change and nothing new stored. It is the approved D-1 decision, and it is
 * what lets Leave compute a `working_days` duration without duplicating a schedule engine or
 * reaching into Organization's calendar tables.
 *
 * **A date the module cannot answer for is reported as `unscheduled` with zero minutes**, not
 * omitted. A caller that received a shorter list than it asked for would have to guess whether the
 * missing dates were rest days or unknown, and that guess is exactly the mistake this contract
 * exists to prevent. Where the tenant has configured no attendance policy at all, the query says so
 * by refusing rather than by answering "nobody works" for everybody.
 *
 * It is bounded: a range longer than a year is refused rather than answered slowly.
 */

export interface ExpectedWorkingDays extends Query {
  readonly queryName: 'attendance.expected-working-days';
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
}

export interface ExpectedWorkingDayView {
  readonly onDate: string;
  readonly expected: boolean;
  readonly expectedMinutes: number;
  /** `working` | `rest` | `holiday` | `unscheduled` — Attendance's own vocabulary. */
  readonly dayKind: string;
  /** The IANA zone the schedule places the day in. Never a caller's guess. */
  readonly zone: string;
}

export interface ExpectedWorkingDaysView {
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
  readonly days: readonly ExpectedWorkingDayView[];
}

/** A year and a bit. A run has to finish, and a leave request longer than this is a mistake. */
const MAX_RANGE_DAYS = 400;
const MILLISECONDS_PER_DAY = 86_400_000;

export const expectedWorkingDaysHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ExpectedWorkingDays, ExpectedWorkingDaysView> => ({
  queryName: 'attendance.expected-working-days',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const dates = datesBetween(query.from, query.to);

      if (dates.length === 0 || dates.length > MAX_RANGE_DAYS) {
        return rejectedRange<ExpectedWorkingDaysView>();
      }

      const days: ExpectedWorkingDayView[] = [];

      for (const onDate of dates) {
        const resolved = await resolveExpectation(transaction, dependencies, {
          employmentId: query.employmentId,
          attendanceDate: onDate,
        });

        days.push(resolved === undefined ? unscheduled(onDate) : expectedOn(onDate, resolved));
      }

      return success({
        employmentId: query.employmentId,
        from: query.from,
        to: query.to,
        days,
      });
    }),
});

/**
 * One date's answer.
 *
 * `expected` is `dayKind === 'working'` rather than a roster-kind test, because the day kind is
 * what the resolution already decided: a rest day, a public holiday and an unscheduled date are all
 * days on which nothing was asked of the person, and only `working` is not.
 *
 * `expectedMinutes` is the shift's **authored** figure, not the interval between its start and its
 * end. On a day the clocks go forward those differ by an hour, and what was *asked* of the person
 * did not change — a figure recomputed from the interval would turn a transition night into an hour
 * of absence, in Leave's arithmetic as well as in Attendance's.
 */
const expectedOn = (
  onDate: string,
  resolved: NonNullable<Awaited<ReturnType<typeof resolveExpectation>>>,
): ExpectedWorkingDayView => ({
  onDate,
  expected: resolved.expectation.dayKind === 'working',
  expectedMinutes: resolved.expectation.shift?.expectedMinutes ?? 0,
  dayKind: resolved.expectation.dayKind,
  zone: resolved.expectation.zone === '' ? DEFAULT_ZONE : resolved.expectation.zone,
});

/** No policy is configured, so nothing can be said about the date. Said plainly, not as a zero. */
const unscheduled = (onDate: string): ExpectedWorkingDayView => ({
  onDate,
  expected: false,
  expectedMinutes: 0,
  dayKind: 'unscheduled',
  zone: DEFAULT_ZONE,
});

const datesBetween = (from: string, to: string): readonly string[] => {
  const dates: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

  for (let at = start; at <= end; at += MILLISECONDS_PER_DAY) {
    dates.push(new Date(at).toISOString().slice(0, 10));
  }
  return dates;
};

const rejectedRange = <TValue>(): ReturnType<QueryHandler<ExpectedWorkingDays, TValue>['handle']> =>
  Promise.resolve({
    ok: false,
    error: { kind: 'rejected', reason: 'attendance.rejection.period_out_of_range' },
  });
