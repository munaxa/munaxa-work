/**
 * The values this screen must not convert, and the named identity functions that stop it.
 *
 * Career holds **no money, no rate, no percentage and nothing computed** (ADR-0074). Its schema has
 * no `numeric`, no `double precision` and no `bigint`: every number it stores is a small ordered
 * integer a human chose — a stage's position in a path (≤ 500), a successor's rank (≤ 50), a
 * readiness level's ordinal (≤ 100) — and every date is a civil date. That makes this file shorter
 * than Learning's equivalent and no less necessary, because both kinds of value are destroyed by the
 * most ordinary-looking formatting.
 *
 * **A civil date is a day, not an instant.** Every date Career stores is a `YYYY-MM-DD` string end
 * to end: the column is read with `to_char`, the view carries the string, and no `Date` exists
 * anywhere on the path. `new Date('2026-02-28').toLocaleDateString()` on a server west of UTC
 * renders the 27th — a plan that started a day early, or an assessment attributed to the wrong day.
 * So a civil date is rendered exactly as it arrived, in every language, including in Arabic where
 * rendering `٢٠٢٦-٠٢-٢٨` would be a cosmetic improvement bought with a `Date`.
 *
 * **An ordinal is a whole number somebody chose, and it is not a score.** `String(500)` is `'500'`
 * and always will be, but naming this keeps a future reader from reaching for `toLocaleString()` —
 * which renders a sequence of 500 as `500` in English and `٥٠٠` in Arabic, and inserts a thousands
 * separator the moment a bound moves. A sequence is an identifier of a rung on a ladder, not a
 * quantity, and it must read identically in both languages.
 *
 * Both functions have names and comments rather than being written out at each call site, so a
 * later reader reaching for a conversion meets the reason first.
 */

/**
 * A civil date, as the domain stored it.
 *
 * Not formatted, not localized and never parsed. A day is the same day in every time zone precisely
 * because nothing converts it.
 */
export const civil = (value: string | undefined): string => value ?? '—';

/**
 * A whole ordinal or count the API reported, as text.
 *
 * `String`, deliberately and with a name. Not `toLocaleString`, which localizes the digits and would
 * make a stage sequence read differently in the two languages; not `toFixed`, which would turn a
 * rank into `1.00`; and not arithmetic of any kind, because nothing on this screen is entitled to
 * compute with a number the server already decided.
 */
export const count = (value: number | undefined): string =>
  value === undefined ? '—' : String(value);
