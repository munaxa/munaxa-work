/**
 * The values this screen must not touch, and the named identity functions that stop it.
 *
 * Learning holds **no money column, no `bigint` and no `numeric`**. Every number it stores is a
 * small schema-constrained integer — a duration in minutes, a recurrence in months, a step's
 * position — and there is nothing here to scale, divide or round. That makes this file shorter than
 * Performance's equivalent and no less necessary, because the two values that *are* exact travel
 * through this screen as strings and would be destroyed by the most ordinary-looking formatting.
 *
 * **A mark is the tenant's own text.** `rawMark` is a `varchar(32)` nothing in this product parses:
 * an assessor wrote `18.50` and `Number('18.50')` renders `18.5`, which is a different mark in a
 * transcript and one nobody could explain a year later. Nothing computes with it, so nothing is
 * entitled to normalize it — and because the value is already a string, the mistake would not be a
 * visible cast but a plausible-looking `.toFixed(2)` somebody added to "tidy the column up".
 *
 * **A civil date is a day, not an instant.** Every date Learning stores is a `YYYY-MM-DD` string
 * end to end: the column is read with `to_char`, the view carries the string, and no `Date` exists
 * anywhere on the path. `new Date('2026-08-12').toLocaleDateString()` on a server west of UTC
 * renders the 11th — a certificate that expires a day early, or a requirement that falls overdue a
 * day late. So a civil date is rendered exactly as it arrived, in every language.
 *
 * Both functions have names and comments rather than being written out at each call site, so a
 * later reader reaching for a conversion meets the reason first.
 */

/**
 * A mark, as the assessor wrote it.
 *
 * The identity function, deliberately and with a name. `Number(value)`, `parseFloat(value)` and
 * `Number(value).toFixed(2)` all render `18.50` as `18.5`; this renders `18.50`.
 */
export const exactMark = (value: string | undefined): string => value ?? '—';

/**
 * A civil date, as the domain stored it.
 *
 * Not formatted, not localized and never parsed. Rendering `٢٠٢٦-٠٨-١٢` in Arabic would be a
 * cosmetic improvement bought with a `Date`, and the same `Date` is what shifts the day by one
 * either side of UTC. A day is the same day in every time zone precisely because nothing converts
 * it.
 */
export const civil = (value: string | undefined): string => value ?? '—';

/**
 * A whole count the API reported, as text.
 *
 * Learning's integers are all small and schema-bounded, so this is `String` — but naming it keeps
 * the counts in the same shape as the two values above, and stops a future reader from reaching for
 * `toLocaleString()` on a figure that also appears in an export.
 */
export const count = (value: number | undefined): string =>
  value === undefined ? '—' : String(value);
