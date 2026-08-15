import type { Language } from './locale';

/**
 * The values this screen must not alter, and the named functions that stop it.
 *
 * Workflow holds **no civil date, no money, no rate and nothing computed**. Every moment it stores
 * is an instant — a request was raised, a step became current, somebody answered — and every number
 * is a small whole one somebody chose or the server counted: a step's position in a chain, a
 * version's number, a row's optimistic version, a total. Both kinds of value are destroyed by the
 * most ordinary-looking formatting, and each has its own way of going wrong.
 *
 * **An instant is a moment, and it must stay the same moment.** The repository's Admin convention
 * for an instant is `toLocaleString` **pinned to UTC** — the shape Documents, Compensation, Leave
 * and Attendance already use. The pin is the whole point: `new Date('2026-02-28T23:30:00Z')`
 * rendered in the server's own zone reads as the 28th at 15:30 in Los Angeles and as the 1st of
 * March in Riyadh, so the same approval appears to have been decided on a different day depending
 * on where the server happens to run. Pinned, the day and the time are the ones the API sent, in
 * both languages.
 *
 * Nothing here computes *with* an instant. No elapsed time, no age, no overdue, no business-day
 * arithmetic and no browser clock: Workflow publishes no such value, and a screen that derived one
 * would be inventing the service level this phase deliberately does not have.
 *
 * **An ordinal is a whole number somebody chose, and it is not a quantity.** `String(3)` is `'3'`
 * and always will be, but naming this keeps a future reader from reaching for `toLocaleString()` —
 * which renders a position of 3 as `3` in English and `٣` in Arabic, and inserts a thousands
 * separator into a total the moment a tenant grows. A position in an approval chain must read
 * identically in both languages, and a total of four thousand approvals is `4000` in both.
 *
 * **An identifier is a string and stays one.** Never through `Number`: a UUID is not a quantity, and
 * the one thing worse than a truncated identifier on a screen is a rounded one.
 */

/**
 * An instant, in the reader's language and pinned to UTC.
 *
 * The zone is fixed so the moment survives; the locale is the reader's so the rendering is legible.
 * Never the server's own zone, which would make the displayed day depend on where this process runs.
 */
export const instant = (value: string | undefined, language: Language): string =>
  value === undefined ? '—' : new Date(value).toLocaleString(locale(language), { timeZone: 'UTC' });

const locale = (language: Language): string => (language === 'ar' ? 'ar' : 'en-GB');

/**
 * A whole ordinal, version or count the API reported, as text.
 *
 * `String`, deliberately and with a name. Not `toLocaleString`, which localizes the digits and would
 * make a step's position read differently in the two languages; not `toFixed`, which would turn a
 * version number into `2.00`; and not arithmetic of any kind, because nothing on this screen is
 * entitled to compute with a number the server already decided.
 */
export const count = (value: number | undefined): string =>
  value === undefined ? '—' : String(value);

/**
 * An identifier, shortened for a table cell — and never converted.
 *
 * The full value is what the API published; this shortens it for display only, which is why it takes
 * a string and returns one. A screen that parsed an identifier to shorten it would be a screen that
 * could round one.
 *
 * **Not for a membership.** See `member` below.
 */
export const short = (value: string | undefined): string =>
  value === undefined ? '—' : `${value.slice(0, 8)}…`;

/**
 * A membership identifier, in full.
 *
 * Every other identifier on this screen is shortened to eight characters for the width of a cell.
 * A membership must not be, and the reason is arithmetic rather than aesthetic: these identifiers
 * are UUIDv7, whose leading forty-eight bits are a millisecond timestamp, so the first eight
 * characters are **the same for every membership created within about four and a half hours of each
 * other**. Two directors admitted to a tenant on the same afternoon would render identically.
 *
 * That is tolerable for a row identifier nobody compares. It is not tolerable here, because this is
 * the module where two memberships appear side by side and the whole point is that they are two: the
 * person who decided and the person whose authority they used, or the approver a step names and the
 * deputy who answered it. A truncation that made those look like one person would say a director
 * approved something their deputy approved — the exact claim the domain keeps two columns to avoid.
 */
export const member = (value: string | undefined): string => value ?? '—';
