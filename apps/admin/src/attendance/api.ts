import { loadPortalProcessEnvironment } from '@work/config';
import type {
  AttendanceDashboardView,
  AttendanceDayView,
  AttendanceExceptionView,
  CorrectionView,
  ImportBatchView,
  RosterEntryView,
  ScheduleView,
  ShiftView,
  TimeEventView,
} from '@work/attendance/contracts';

/**
 * Reading the attendance register from the API.
 *
 * The types come from the module's published *contracts*, never from its internals — which is what
 * the lint layer enforces, and what keeps this screen from breaking on a refactor it has no
 * business knowing about.
 *
 * **What this cannot do yet, and why.** Every business endpoint returns 401 until Platform's
 * authentication adapter is supplied; this repository authenticates nobody, by design (ADR-0032).
 * So these calls are written against the real contract and fail closed: an unreachable or
 * unauthorized API renders the empty state rather than an error page, because "not signed in yet"
 * is the expected condition today rather than a fault.
 *
 * **The reconciliation count is read and shown but never acted on from here.** It is the one number
 * on the screen that reveals a *failure* — days whose inputs moved and which nobody has
 * recalculated — and running the recalculation is a `POST` an operator or a scheduler makes.
 */

export interface AttendanceForDisplay {
  readonly dashboard: AttendanceDashboardView | undefined;
  readonly days: readonly AttendanceDayView[];
  readonly events: readonly TimeEventView[];
  readonly exceptions: readonly AttendanceExceptionView[];
  readonly corrections: readonly CorrectionView[];
  readonly shifts: readonly ShiftView[];
  readonly schedules: readonly ScheduleView[];
  readonly roster: readonly RosterEntryView[];
  readonly imports: readonly ImportBatchView[];
  /** True when the API could not be reached or refused the caller — the ordinary state today. */
  readonly unavailable: boolean;
}

const BASE = loadPortalProcessEnvironment().WORK_API_URL;

const read = async <TValue>(path: string): Promise<TValue | undefined> => {
  try {
    const response = await fetch(`${BASE}/api/v1/attendance${path}`, { cache: 'no-store' });

    if (!response.ok) return undefined;
    return (await response.json()) as TValue;
  } catch {
    return undefined;
  }
};

interface Page<TItem> {
  readonly items: readonly TItem[];
}

const EMPTY: AttendanceForDisplay = {
  dashboard: undefined,
  days: [],
  events: [],
  exceptions: [],
  corrections: [],
  shifts: [],
  schedules: [],
  roster: [],
  imports: [],
  unavailable: true,
};

/**
 * A civil date window ending today, in whichever zone the *browser process* is in.
 *
 * The screen is honest about this: it is a default range for a list, not an attendance date. Which
 * civil date a punch belongs to is decided by the schedule's zone, in the domain, and never here —
 * a screen that computed an attendance date would be a second answer to the question this whole
 * module exists to answer once.
 */
const windowEnding = (today: Date, days: number): { from: string; to: string } => {
  const start = new Date(today.getTime() - days * 86_400_000);

  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
};

/**
 * The reads the screen makes.
 *
 * The dashboard is read first and its failure is the signal: if the service will not answer the
 * cheapest question, the rest is a page of empty tables and a wall of failed requests.
 */
export const loadAttendance = async (today = new Date()): Promise<AttendanceForDisplay> => {
  const dashboard = await read<AttendanceDashboardView>('/dashboard');

  if (dashboard === undefined) return EMPTY;

  const range = windowEnding(today, 30);

  return { dashboard, unavailable: false, ...(await lists(range)) };
};

/**
 * The eight reads behind the eight sections.
 *
 * Each one falls back to empty rather than failing the page: a caller who holds `attendance.read`
 * but not `attendance.event.read` should get the day list and an empty punch list, which is what
 * the permission separation means (ADR-0055).
 */
const lists = async (range: {
  readonly from: string;
  readonly to: string;
}): Promise<Omit<AttendanceForDisplay, 'dashboard' | 'unavailable'>> => {
  const window = `from=${range.from}&to=${range.to}`;
  const dates = `fromDate=${range.from}&toDate=${range.to}`;

  return {
    days: itemsOf(await read<Page<AttendanceDayView>>(`/days?${dates}`)),
    events: itemsOf(await read<Page<TimeEventView>>(`/events?${dates}`)),
    exceptions: itemsOf(await read<Page<AttendanceExceptionView>>('/exceptions?state=open')),
    corrections: itemsOf(await read<Page<CorrectionView>>('/corrections')),
    shifts: (await read<readonly ShiftView[]>('/shifts')) ?? [],
    schedules: (await read<readonly ScheduleView[]>('/schedules')) ?? [],
    roster: (await read<readonly RosterEntryView[]>(`/roster?${window}`)) ?? [],
    imports: (await read<readonly ImportBatchView[]>('/imports')) ?? [],
  };
};

const itemsOf = <TItem>(page: Page<TItem> | undefined): readonly TItem[] => page?.items ?? [];
