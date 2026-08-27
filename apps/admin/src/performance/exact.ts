import type { Language } from './locale';

/**
 * The values these screens must not alter, and the named functions that stop them.
 *
 * Performance publishes a rating somebody was given. A rating destroyed by formatting is worse than
 * one not shown, and a rating *invented* by formatting is worse than either.
 *
 * **A score is a whole number of hundredths and a weight is a whole number of basis points.** Both
 * are converted by string surgery in `scoring.ts`, never by division — see the reasoning there.
 * Nothing in this file touches them; they are named here so a reader looking for "where scores are
 * formatted" finds the answer rather than reaching for `Number(...)`.
 *
 * **A civil date is a day on somebody's calendar.** `startDate`, `dueDate`, `periodStart`,
 * `periodEnd` and the four cycle due dates are `YYYY-MM-DD` strings. Putting one through
 * `new Date(...).toLocaleDateString()` in a process west of Greenwich renders the day before, which
 * on a review deadline moves it.
 *
 * **An instant is a moment and must stay the same moment.** `scoredAt`, `completedAt`, `archivedAt`,
 * `submittedAt`, `requestedAt`, `recordedAt`, `givenAt`, `placedAt`, `concludedAt` and
 * `scheduledFor` are rendered with `toLocaleString` **pinned to UTC**. Unpinned, the same completion
 * reads as happening on a different day depending on where this process runs.
 *
 * **Nothing here computes.** No count of open cycles, no count of completed reviews, no average, no
 * completion percentage, no "awaiting calibration" derived from a score and a status. The screen
 * this replaced computed all four from one page of fifty rows and displayed them beside the
 * server's own totals, where an administrator had no way to tell which was which.
 */

/** An absent value. A dash rather than an empty cell, which reads as a rendering fault. */
export const DASH = '—';

const locale = (language: Language): string => (language === 'ar' ? 'ar' : 'en-GB');

/** A civil date, exactly as the module stored it. */
export const day = (value: string | undefined): string => value ?? DASH;

/** An instant, in the reader's language and pinned to UTC. */
export const instant = (value: string | undefined, language: Language): string =>
  value === undefined
    ? DASH
    : new Date(value).toLocaleString(locale(language), { timeZone: 'UTC' });

/** A whole count, version or band the API reported, as text. */
export const count = (value: number | undefined): string =>
  value === undefined ? DASH : String(value);

/**
 * A reference to something another module owns, in full and never shortened.
 *
 * Performance holds no name for anybody — resolving an employment is People's read behind People's
 * permission — so an employment here is an identifier and stays one.
 *
 * The screen this replaced shortened every identifier to eight characters through a `short()`
 * helper, on seven sections at once. Those eight characters are the top 32 bits of a UUIDv7's
 * 48-bit millisecond timestamp, so every identifier minted inside the same 65,536 ms window renders
 * identically — and a review queue is written exactly that way, by one enrolment run over a cycle.
 * An administrator comparing the subject of a review against the owner of a goal was comparing two
 * strings that were equal for reasons that had nothing to do with the people involved.
 */
export const reference = (value: string | undefined): string => value ?? DASH;

/** Free text a person wrote — a comment, a rationale, a feedback body. Never reflowed or trimmed. */
export const wrote = (value: string | undefined): string | undefined => value;
