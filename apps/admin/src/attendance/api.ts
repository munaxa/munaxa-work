import type { EmploymentView } from '@work/employment/contracts';
import { apiOutcome } from '../shell/api-request.js';
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
} from '@work/attendance/contracts';

/**
 * Reading attendance from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps these screens from breaking on a refactor they have no
 * business knowing about.
 *
 * **One day is one read.** `attendance.read-day` returns the day, **its events including the
 * superseded ones**, and its exceptions together, and it answers `notFound` for a day it will not
 * resolve. Rebuilding that from `/days`, `/events` and `/exceptions` would be three requests, three
 * permission outcomes and three moments in time assembled into one page that claims to describe a
 * single day — so this layer asks the module the question the module already answers.
 *
 * **A 404 and a 403 are different answers.** The day route needs the distinction: a day the module
 * does not have is a not-found page, and a caller lacking `attendance.read` is a withheld one. This
 * is the shape the Leave slice introduced, carried forward.
 *
 * **Two permissions, two different refusals.** `attendance.read` answers days, exceptions,
 * corrections, the rota and the definitions; **`attendance.event.read` separately answers the
 * punches**, and that is where a device reference and — where a tenant enabled capture —
 * coordinates live. A caller may hold the first and not the second, so the punch list is kept as
 * its own value and the screen says it was withheld rather than showing an empty table.
 *
 * **The total is the server's, always.** Every paged read returns `{ items, total }` counted in the
 * database. The screen this replaced discarded `total` in an `itemsOf` helper.
 *
 * **Nothing here computes.** No worked hours, no lateness, no overtime, no percentage, no daily or
 * monthly total. Every figure is published or it is not shown.
 */

/** What one screen shows at once. The server clamps its own bound; this is the request. */
const PAGE = 'page=1&size=50';

interface Paged<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/** A page, or the fact that there was not one. Rows and the server's total travel together. */
export interface Listing<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

/**
 * What a read that defines a route actually answered.
 *
 * `missing` is a 404 the module raised deliberately; `refused` is a 401 or a 403. Collapsing them
 * would render a not-found page at a caller who simply lacks a permission — telling them the day
 * does not exist, which is the opposite of true.
 */
export type Outcome<TValue> =
  | { readonly kind: 'ok'; readonly value: TValue }
  | { readonly kind: 'missing' }
  | { readonly kind: 'refused' };

const outcome = async <TValue>(path: string): Promise<Outcome<TValue>> => {
  const answer = await apiOutcome<TValue>(`${path}`);

  if (answer.kind === 'ok') return { kind: 'ok', value: answer.value };
  return answer.kind === 'missing' ? { kind: 'missing' } : { kind: 'refused' };
};

/**
 * One fetch, failing closed.
 *
 * `cache: 'no-store'` because an attendance page says when a named person came and went, and a
 * cached copy of it is that record sitting somewhere nobody chose.
 */
const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  const answer = await outcome<TValue>(path);

  return answer.kind === 'ok' ? answer.value : undefined;
};

const listing = <TItem>(page: Paged<TItem> | undefined): Listing<TItem> | undefined =>
  page === undefined ? undefined : { items: page.items, total: page.total };

/** The reconciliation read publishes a total and a bounded sample, not a page. */
export interface Reconciliation {
  readonly total: number;
  readonly days: readonly {
    readonly attendanceDayId: string;
    readonly employmentId: string;
    readonly attendanceDate: string;
    readonly state: string;
    readonly inputsChangedAt?: Date;
  }[];
}

export interface AttendanceRegister {
  /** Absent means refused. The cheapest read under `attendance.read`, and the signal for the rest. */
  readonly dashboard: AttendanceDashboardView | undefined;
  readonly exceptions: Listing<AttendanceExceptionView> | undefined;
  readonly days: Listing<AttendanceDayView> | undefined;
  readonly corrections: Listing<CorrectionView> | undefined;
  readonly reconciliation: Reconciliation | undefined;
  readonly roster: readonly RosterEntryView[] | undefined;
  readonly shifts: readonly ShiftView[] | undefined;
  readonly schedules: readonly ScheduleView[] | undefined;
  /** Absent means `attendance.import` was refused — a third permission, and a third refusal. */
  readonly imports: readonly ImportBatchView[] | undefined;
}

/**
 * A civil date window ending on the date asked for.
 *
 * The screen is honest about this: it is a default range for a list, not an attendance date. Which
 * civil date a punch belongs to is decided by the schedule's zone, in the domain, and never here —
 * a screen that computed an attendance date would be a second answer to the question this whole
 * module exists to answer once.
 */
export const windowEnding = (onDate: string, days: number): { from: string; to: string } => ({
  from: new Date(Date.parse(`${onDate}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10),
  to: onDate,
});

/**
 * The register: what today looks like, what is wrong, and what people are measured against.
 *
 * The exception queue is asked for first among the lists because it is the work — an attendance
 * administrator's day is the queue, not the register behind it.
 */
export const loadAttendanceRegister = async (onDate: string): Promise<AttendanceRegister> => {
  const range = windowEnding(onDate, 30);
  const dates = `fromDate=${range.from}&toDate=${range.to}`;

  const [
    dashboard,
    exceptions,
    days,
    corrections,
    reconciliation,
    roster,
    shifts,
    schedules,
    imports,
  ] = await Promise.all([
    read<AttendanceDashboardView>(`/attendance/dashboard?onDate=${onDate}`),
    read<Paged<AttendanceExceptionView>>(`/attendance/exceptions?state=open&${PAGE}`),
    read<Paged<AttendanceDayView>>(`/attendance/days?${dates}&${PAGE}`),
    read<Paged<CorrectionView>>(`/attendance/corrections?${PAGE}`),
    read<Reconciliation>('/attendance/reconciliation'),
    read<readonly RosterEntryView[]>(`/attendance/roster?from=${range.from}&to=${range.to}`),
    read<readonly ShiftView[]>('/attendance/shifts'),
    read<readonly ScheduleView[]>('/attendance/schedules'),
    read<readonly ImportBatchView[]>('/attendance/imports'),
  ]);

  return {
    dashboard,
    exceptions: listing(exceptions),
    days: listing(days),
    corrections: listing(corrections),
    reconciliation,
    roster,
    shifts,
    schedules,
    imports,
  };
};

/** True when not one of the register's reads answered — the ordinary state of this deployment. */
export const registerAnsweredNothing = (register: AttendanceRegister): boolean =>
  register.dashboard === undefined &&
  register.exceptions === undefined &&
  register.days === undefined &&
  register.corrections === undefined &&
  register.reconciliation === undefined &&
  register.shifts === undefined;

/**
 * One day, from the one read that answers it whole.
 *
 * `AttendanceDaySnapshot` is the day, its events — superseded included — and its exceptions,
 * together and from one moment. The outcome is carried out whole so the route can tell a day the
 * module does not have from a caller who may not read days.
 */
export const loadDay = async (
  employmentId: string,
  attendanceDate: string,
): Promise<Outcome<AttendanceDaySnapshot>> =>
  outcome<AttendanceDaySnapshot>(`/attendance/days/${employmentId}/${attendanceDate}`);

export interface DayForDisplay {
  readonly snapshot: AttendanceDaySnapshot;
  /**
   * The employment, from Employment's own bounded read of one identifier.
   *
   * One request for one employment, never a list scanned for a match. `personName` is present only
   * when the caller may read the person, which Employment decides rather than this screen.
   */
  readonly employment: EmploymentView | undefined;
  /** The configured shifts, read once to name the day's own. Attendance publishes no read by id. */
  readonly shifts: readonly ShiftView[] | undefined;
  /** This employment's corrections, so a pending one is visible on the day it concerns. */
  readonly corrections: Listing<CorrectionView> | undefined;
}

/**
 * Everything else about the day, in one round.
 *
 * Three reads beside the snapshot, none of them per row: the employment for its name, the shift
 * list to name a shift, and this employment's corrections. A correction is filtered by employment
 * and date at the server, so a pending one appears on the day it concerns rather than being
 * searched for.
 */
export const loadDayDetail = async (snapshot: AttendanceDaySnapshot): Promise<DayForDisplay> => {
  const { employmentId } = snapshot.day;

  const [employment, shifts, corrections] = await Promise.all([
    read<EmploymentView>(`/employments/${employmentId}`),
    read<readonly ShiftView[]>('/attendance/shifts'),
    read<Paged<CorrectionView>>(`/attendance/corrections?employmentId=${employmentId}&${PAGE}`),
  ]);

  return {
    snapshot,
    employment,
    shifts,
    corrections: listing(corrections),
  };
};
