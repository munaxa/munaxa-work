import type { Language } from './locale';

/**
 * The values these screens must not alter, and the named functions that stop them.
 *
 * Leave publishes four kinds of value a screen destroys by formatting them, and minutes are the one
 * that destroys a customer's entitlement rather than merely their patience.
 *
 * **A duration is minutes, and it stays minutes.** Every figure Leave publishes — a request's
 * total, a day's portion, a balance, a ledger movement, an adjustment, a projection — is integer
 * minutes, because storage is always minutes regardless of the unit a leave type is *expressed* in
 * (§10.4). Converting them to days in the browser would require the policy's own duration basis and
 * the schedule's expected minutes, both of which the domain already used once to produce these
 * numbers; doing the arithmetic a second time here is how a screen and a payslip come to disagree
 * about the same absence. `LeaveTypeView.unit` says which unit the type is authored in, and the
 * screen renders that word beside the type rather than acting on it.
 *
 * **A civil date is a day somebody agreed.** `fromDate`, `toDate`, `onDate`, `effectiveOn`,
 * `leaveYearStart` and `leaveYearEnd` are `YYYY-MM-DD` strings. Putting one through
 * `new Date(...).toLocaleDateString()` in a process west of Greenwich renders the day before, which
 * on a leave date is a different day of somebody's holiday.
 *
 * **An instant is a moment and must stay the same moment.** `requestedAt`, `approvedAt`,
 * `cancelledAt`, `decidedAt`, `recordedAt`, `adjustedAt`, `calculatedAt` and `inputsChangedAt` are
 * instants, rendered with `toLocaleString` **pinned to UTC** — the shape every composed screen
 * before this uses. Unpinned, the same request reads as approved on a different day depending on
 * where this process runs.
 *
 * **A count is a whole number the server decided.** An entry count, an approvals-required figure, a
 * page total and a version are all `String`, never `toLocaleString`, which localizes the digits and
 * inserts a thousands separator the moment a tenant's ledger grows past a thousand entries.
 *
 * **Nothing here computes.** No balance from a sum of entries, no duration from two dates, no
 * working-day count, no accrual, no running total, no percentage, no "current" leave year. Every
 * one of those is either published by Leave or is a leave rule this screen has no business
 * inventing.
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
 * The catalogue supplies the unit word in both languages — `{minutes} min` and `{minutes} دقيقة` —
 * so the number and its unit are one translated phrase rather than a number with English glued to
 * it. A negative movement keeps its sign, because a ledger whose debits look like credits is a
 * ledger nobody can read.
 */
export const minutes = (t: (key: string) => string, value: number | undefined): string =>
  value === undefined ? DASH : t('leave.label.minutes').replace('{minutes}', String(value));

/**
 * A reference to something another module owns, in full and never shortened.
 *
 * Leave holds no name for anybody: no person, no employee number, no employment status (ADR-0051).
 * So an employment on a request, a balance, a ledger entry or an adjustment is an identifier and
 * stays one. Shortening it to eight characters — which every screen in this product outside the two
 * most recent slices still does — makes two employments created inside the same 65-second window
 * render identically, and on this screen the employment is the subject of every row of every
 * section.
 */
export const reference = (value: string | undefined): string => value ?? DASH;

/**
 * Today, as a civil date, for the one read that requires one.
 *
 * `leave.projected-balance` takes the date it projects *from*, and there is no such thing as a
 * projection without one. This is the browser process's own calendar day in UTC and the screen says
 * so: it is a default for a request parameter, never a leave date. Which dates a request covers is
 * decided by the day rows the domain wrote, in the schedule's own zone, and never here.
 */
export const todayIn = (now: Date): string => now.toISOString().slice(0, 10);
