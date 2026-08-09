/**
 * The ubiquitous language of Attendance, in one file so the API, the contracts and the aggregates
 * cannot drift into three spellings of the same idea.
 *
 * Several words are deliberately absent, and their absence is a boundary being kept rather than
 * described. *Employee number*, *employment status*, *contracted hours*, *manager* and *person*
 * appear nowhere as owned state: each is Employment's or People's, referenced by identifier and
 * read as at a date (ADR-0051). Neither does *leave balance*, *entitlement*, *rate*, *multiplier*
 * or *amount* — Leave owns the first two and Compensation and Payroll own the rest.
 *
 * *Work location*, *site* and *geofence* are absent too, and that is the most deliberate absence
 * here: there is no location model in this product, and inventing one inside Attendance is what
 * ADR-0041 was written to prevent (ADR-0055).
 *
 * The pattern is the one every module before this uses. A **state** is product behaviour and is
 * checked in the database. A **code** — a reason, a waiver, a policy identifier — is tenant or
 * country-pack data, validated by shape and never against a list this product ships (00B).
 */

/**
 * What a raw event says happened.
 *
 * Four kinds, closed. A break is a pair like a shift is a pair, which is what lets one pairing
 * algorithm serve both and one `missing_*` exception describe either.
 */
export const EVENT_KINDS = ['clock_in', 'clock_out', 'break_start', 'break_end'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const isOpeningEvent = (kind: EventKind): boolean =>
  kind === 'clock_in' || kind === 'break_start';

/**
 * Where an event came from.
 *
 * A vendor is **not** a source. A biometric reader, a turnstile and a QR gate all arrive as
 * `device`, normalized by an adapter outside this module — which is what stops a vendor SDK
 * reaching the domain and what lets a new device ship without a schema change.
 */
export const EVENT_SOURCES = [
  'web',
  'mobile',
  'device',
  'manual',
  'import',
  'api',
  'correction',
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** What kind of day the calculation decided this was, before looking at what happened. */
export const DAY_KINDS = ['working', 'rest', 'holiday', 'unscheduled'] as const;
export type DayKind = (typeof DAY_KINDS)[number];

/**
 * The day's lifecycle.
 *
 * `pending` exists because ingestion creates the day before anything is calculated: a day that is
 * only created by the calculator is a day the reconciliation query cannot find when the calculator
 * never ran.
 */
export const DAY_STATES = ['pending', 'calculated', 'under_review', 'approved', 'locked'] as const;
export type DayState = (typeof DAY_STATES)[number];

export const DAY_TRANSITIONS: Readonly<Record<DayState, readonly DayState[]>> = {
  pending: ['calculated'],
  // Recalculation returns an approved day to `calculated`, which is deliberate and visible: an
  // input moved after somebody signed off, and pretending the signature still covers it would be
  // the quiet version of forging it.
  calculated: ['under_review', 'approved', 'calculated'],
  under_review: ['calculated', 'approved'],
  approved: ['calculated', 'locked'],
  locked: ['calculated'],
};

/**
 * What Leave was able to say about this day.
 *
 * `unknown` is a real answer and is not `none`. The first means nobody can be asked — there is no
 * Leave module in this repository — and the second means somebody was asked and said no leave was
 * approved. Collapsing them would let the product assert that a person was absent without leave
 * when it has no way to know, which is a false statement on somebody's record (ADR-0056).
 */
export const LEAVE_STATES = ['none', 'applied', 'unknown'] as const;
export type LeaveState = (typeof LEAVE_STATES)[number];

/** What a shift is. Five kinds, closed; a sixth is a schema change, not configuration. */
export const SHIFT_KINDS = ['fixed', 'flexible', 'split', 'night', 'open'] as const;
export type ShiftKind = (typeof SHIFT_KINDS)[number];

export const SEGMENT_KINDS = ['work', 'break'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/** What a roster entry says about one employment on one date. It overrides the schedule. */
export const ROSTER_KINDS = ['shift', 'rest', 'holiday', 'off_site'] as const;
export type RosterKind = (typeof ROSTER_KINDS)[number];

export const isExpectedToWork = (kind: RosterKind): boolean =>
  kind === 'shift' || kind === 'off_site';

/** Definitions that are drafted, frozen, then replaced. Shifts, schedules and policies share it. */
export const DEFINITION_STATUSES = ['draft', 'published', 'superseded'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

/**
 * Every deviation this product understands.
 *
 * Closed and checked in the database, because product behaviour branches on them and a screen
 * renders each with its own bilingual message. Which of them requires whose decision is *policy*
 * data; which of them exist is product behaviour.
 */
export const EXCEPTION_KINDS = [
  'missing_clock_in',
  'missing_clock_out',
  'late_arrival',
  'early_departure',
  /** Expected, nothing recorded, and Leave cannot yet be asked. Not the same as being absent. */
  'absence_pending_explanation',
  /** Expected, nothing recorded, and Leave was asked and said no leave was approved. */
  'absent_unexplained',
  'unscheduled_attendance',
  'rest_day_work',
  'holiday_work',
  'duplicate_punch',
  'invalid_punch',
  'clock_skew',
  'overtime_candidate',
  'undertime',
  /** An event arrived after somebody signed the day off. A human decides; nothing is auto-voided. */
  'late_event_after_approval',
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export const EXCEPTION_SEVERITIES = ['information', 'warning', 'blocking'] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

export const EXCEPTION_STATES = ['open', 'resolved', 'waived', 'superseded'] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

/** What a correction proposes to do. Nothing here edits a raw event in place. */
export const CORRECTION_KINDS = [
  'add_event',
  'amend_event',
  'remove_event',
  'manual_day',
  'overtime',
  'shift_swap',
  'off_site',
] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_STATES = [
  'requested',
  'approved',
  'rejected',
  'applied',
  'withdrawn',
] as const;
export type CorrectionState = (typeof CORRECTION_STATES)[number];

/** How a policy rounds. `none` is the default a tenant gets by configuring nothing. */
export const ROUNDING_MODES = ['none', 'nearest', 'down', 'up'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

/** Where a policy came from. `country_pack` is what Phase 11.1 writes; nothing writes it today. */
export const POLICY_SOURCES = ['tenant', 'country_pack'] as const;
export type PolicySource = (typeof POLICY_SOURCES)[number];

/**
 * A stable, human-authored code, unique within its tenant and its kind.
 *
 * ASCII by design, for the same reason every other module's codes are: a code travels into an
 * export a customer opens in a spreadsheet and into an integration's payload.
 */
export const isEntityCode = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);

/** A civil date as `YYYY-MM-DD`. An attendance date is the same date in every time zone. */
export const isCivilDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** A wall-clock time as `HH:MM`, in the zone its schedule declares. `24:00` is not a time. */
export const isWallClock = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Minutes since local midnight. The form every schedule comparison is made in. */
export const minutesOfDay = (wallClock: string): number => {
  const hours = Number(wallClock.slice(0, 2));
  const minutes = Number(wallClock.slice(3, 5));

  return hours * 60 + minutes;
};

export const MINUTES_PER_DAY = 1440;

/**
 * Whether a shift written `start_local`–`end_local` runs past midnight.
 *
 * Equal times mean a full twenty-four hours rather than nothing, which is the reading a continuous
 * operation expects and the only one that is not silently zero.
 */
export const crossesMidnight = (startLocal: string, endLocal: string): boolean =>
  minutesOfDay(endLocal) <= minutesOfDay(startLocal);

/** Adds whole days to a civil date. UTC arithmetic on a date-only value, never on an instant. */
export const addDays = (civilDate: string, days: number): string => {
  const at = new Date(`${civilDate}T00:00:00Z`);

  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/** Whole days between two civil dates. Used to find a schedule's cycle position. */
export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * 60 * 1000),
  );
