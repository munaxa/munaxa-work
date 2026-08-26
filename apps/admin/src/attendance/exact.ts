import type { Language } from './locale';

/**
 * The values these screens must not alter, and the named functions that stop them.
 *
 * Attendance publishes verdicts, and a verdict destroyed by formatting is worse than one not shown.
 *
 * **A duration is minutes the domain decided.** `workedMinutes`, `expectedMinutes`,
 * `overtimeCandidateMinutes`, `absenceMinutes`, `leaveMinutes` and an exception's own `minutes` are
 * all integers the calculation produced against a shift, a schedule, a policy and a zone this
 * screen cannot see. Converting them to hours here would be a second arithmetic beside the domain's
 * own, and the first time the two disagreed the domain would be right. The word *candidate* in
 * `overtimeCandidateMinutes` is load-bearing: it is minutes, never money.
 *
 * **A civil date is a day on somebody's calendar.** `attendanceDate` and `onDate` are `YYYY-MM-DD`
 * strings. Putting one through `new Date(...).toLocaleDateString()` in a process west of Greenwich
 * renders the day before — which on an attendance date files a night shift against the wrong day,
 * the exact failure ADR-0055 exists to prevent.
 *
 * **An instant is a moment and must stay the same moment.** `occurredAt`, `reportedAt`,
 * `receivedAt`, `approvedAt`, `lockedAt`, `calculatedAt`, `inputsChangedAt`, `requestedAt` and
 * `decidedAt` are instants, rendered with `toLocaleString` **pinned to UTC**. Unpinned, the same
 * punch reads as happening on a different day depending on where this process runs.
 *
 * **A wall clock is not an instant.** `startLocal` and `endLocal` on a shift are wall-clock strings
 * that mean nothing without the schedule's zone, and the zone is rendered beside them rather than
 * applied to them.
 *
 * **Nothing here computes.** No worked hours from two timestamps, no lateness from a comparison, no
 * overtime, no attendance percentage, no absence percentage, no daily or monthly total, no decision
 * about which of two events is correct. Every one of those is either published by Attendance or is
 * an attendance rule this screen has no business inventing.
 */

/** An absent value. A dash rather than an empty cell, which reads as a rendering fault. */
export const DASH = '—';

const locale = (language: Language): string => (language === 'ar' ? 'ar' : 'en-GB');

/** A civil date, exactly as the module stored it. */
export const day = (value: string | undefined): string => value ?? DASH;

/** An instant, in the reader's language and pinned to UTC. */
export const instant = (value: Date | string | undefined, language: Language): string =>
  value === undefined
    ? DASH
    : new Date(value).toLocaleString(locale(language), { timeZone: 'UTC' });

/** A whole count, sequence or version the API reported, as text. */
export const count = (value: number | undefined): string =>
  value === undefined ? DASH : String(value);

/**
 * A published duration, in the unit it was published in.
 *
 * The catalogue supplies the unit word in both languages — `{minutes} min` and `{minutes} د` — so
 * the number and its unit are one translated phrase rather than a number with English glued to it.
 */
export const minutes = (t: (key: string) => string, value: number | undefined): string =>
  value === undefined ? DASH : t('attendance.label.minutes').replace('{minutes}', String(value));

/**
 * A reference to something another module owns, in full and never shortened.
 *
 * Attendance holds no name for anybody — "a queue shows an employment identifier; resolving one is
 * People's read behind People's permission" — so an employment here is an identifier and stays one.
 * Shortening it to eight characters, which the screen this replaced did on six sections at once,
 * makes every row written inside the same 65-second window render identically: those eight
 * characters are the top 32 bits of a UUIDv7's millisecond timestamp, and attendance rows are
 * written in exactly that pattern by an import batch or a recovering device uplink.
 */
export const reference = (value: string | undefined): string => value ?? DASH;

/** A wall clock, rendered as stored. The zone it means is shown beside it, never applied to it. */
export const wallClock = (value: string | undefined): string => value ?? DASH;

/**
 * Today, as a civil date, for the one read that takes one.
 *
 * `attendance.dashboard` defaults to its own clock when given no date; this is the browser
 * process's calendar day in UTC and the screen treats it as a request parameter, never as an
 * attendance date. Which civil date a punch belongs to is decided by the schedule's zone, in the
 * domain, and never here.
 */
export const todayIn = (now: Date): string => now.toISOString().slice(0, 10);
