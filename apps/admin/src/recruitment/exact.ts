import type { Language } from './locale';

/**
 * The values these screens must not alter, and the named functions that stop them.
 *
 * Recruitment publishes three kinds of value a screen destroys by formatting them, and each goes
 * wrong differently.
 *
 * **A civil date is a day somebody agreed, and it has no time and no zone.** `appliedOn`,
 * `targetStartDate`, `proposedStartDate`, `openedOn`, `closesOn` and `expiresOn` are `YYYY-MM-DD`
 * strings, and putting one through `new Date(...).toLocaleDateString()` in a process running west of
 * Greenwich renders the day before. They are rendered as stored, which is what Employment's record
 * already does for a contract date.
 *
 * **An instant is a moment, and it must stay the same moment.** `submittedAt`, `issuedAt`,
 * `decidedAt`, `occurredAt`, `scheduledFrom`, `scheduledTo` and `anonymizedAt` are instants, and the
 * Admin convention for one is `toLocaleString` **pinned to UTC** — the shape the workflow, leave and
 * documents screens already use. Unpinned, the same interview reads as a different day in Riyadh and
 * in Los Angeles depending on where this process happens to run.
 *
 * **A count is a whole number the server decided, and it is not a quantity to localize.**
 * `headcountRequested`, `headcountFilled`, `headcountRemaining`, a pipeline count, a page total, an
 * interview round, a feedback score and a version are all `String`, never `toLocaleString` — which
 * renders a round of 3 as `٣` in Arabic and inserts a thousands separator into a total the moment a
 * tenant grows. A hiring figure must read identically in both languages.
 *
 * **Nothing here computes.** No sum of headcount across requisitions, no pipeline percentage, no
 * average score, no days-open, no age of an application. Every one of those is either published by
 * the module or is a hiring policy the module deliberately refuses to hold.
 */

/** An absent value. A dash rather than an empty cell, which reads as a rendering fault. */
export const DASH = '—';

const locale = (language: Language): string => (language === 'ar' ? 'ar' : 'en-GB');

/**
 * A civil date, exactly as the module stored it.
 *
 * Not reformatted and not passed through a `Date`: the reader's calendar is the kernel's business
 * (ADR-0027) and this product renders no Hijri anywhere yet, so inventing a conversion on one screen
 * would be the only screen in the product that had one.
 */
export const day = (value: string | undefined): string => value ?? DASH;

/**
 * An instant, in the reader's language and pinned to UTC.
 *
 * The zone is fixed so the moment survives; the locale is the reader's so the rendering is legible.
 */
export const instant = (value: Date | string | undefined, language: Language): string =>
  value === undefined
    ? DASH
    : new Date(value).toLocaleString(locale(language), { timeZone: 'UTC' });

/**
 * A whole count, version, round or score the API reported, as text.
 *
 * `String`, deliberately and with a name — not `toLocaleString`, not `toFixed`, and not arithmetic
 * of any kind, because nothing on these screens is entitled to compute with a number the server
 * already decided.
 */
export const count = (value: number | undefined): string =>
  value === undefined ? DASH : String(value);

/**
 * A reference to something another module owns, in full and never shortened.
 *
 * A position, an organizational unit and a cost centre appear here as identifiers because
 * Organization publishes no reachable bounded read for any of them — `ListUnits` has no `unitId`
 * filter and `ListPositions.positionId` exists in the application layer and is not forwarded by its
 * controller. Shortening one would make two positions created in the same afternoon render
 * identically, and resolving one would mean caching a name this screen does not own. So it is shown
 * whole, and the boundaries note says why.
 */
export const reference = (value: string | undefined): string => value ?? DASH;
