/**
 * The query-string values a controller may accept, and the one date conversion this module makes.
 *
 * Bounded here as well as in the handler because a page size arrives as a string from an untrusted
 * edge, and `Number('abc')` is `NaN` — which compares false against every bound and would sail
 * through a naive check. **Every collection this module exposes is paginated**; there is no
 * unbounded review, goal or feedback read on any route.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface Page {
  readonly page: number;
  readonly size: number;
}

const whole = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

export const paged = (query: Record<string, string | undefined>): Page => ({
  page: whole(query['page'], 1, Number.MAX_SAFE_INTEGER),
  size: whole(query['size'], DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
});

/**
 * A civil date on the wire, as the `Date` the application contract declares.
 *
 * **This is the Phase 8 defect, and it is why this function exists rather than the conversion being
 * written out at each call site.** A `YYYY-MM-DD` string passed to a query expecting a `Date` used
 * to travel three layers before failing; the upstream stubs now throw a `TypeError` on one, and the
 * DTOs refuse anything that is not this shape.
 *
 * The instant is **UTC midnight**, not local midnight. `new Date('2026-01-01')` is already UTC in
 * every conforming runtime, but `new Date('2026-01-01T00:00:00')` is the server's local midnight —
 * and on a server west of UTC that is the 31st of December. A cycle that started a day early because
 * of where a container happened to run is not a bug anybody finds quickly, so the suffix is written
 * explicitly and never inferred.
 *
 * The DTO has already matched the pattern, so this cannot receive a malformed value from a validated
 * body. It is defensive about it anyway — a `NaN` date reaching a query becomes `null` in SQL and
 * quietly matches nothing, which is worse than a refusal because the answer looks like an answer.
 */
export const civil = (value: string): Date => {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Not a civil date: ${value}.`);
  return parsed;
};

/** The same conversion for a field that may be absent. An absent date stays absent, never `now`. */
export const civilIf = (value: string | undefined): Date | undefined =>
  value === undefined ? undefined : civil(value);

/**
 * The filters a caller actually supplied.
 *
 * A key present with `undefined` is not the same as absent under `exactOptionalPropertyTypes`, and
 * a filter that arrived as `undefined` would narrow a search to rows whose column is literally
 * null. Dropping them here is what keeps an empty query string meaning "everything".
 */
export const optional = (
  query: Record<string, string | undefined>,
  names: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    names
      .map((name) => [name, query[name]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );

/** The same, for a body whose optional fields are already typed. Keeps `Date`s and numbers. */
export const present = <TShape extends object>(
  candidate: TShape,
): { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> } =>
  Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)) as {
    [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined>;
  };
