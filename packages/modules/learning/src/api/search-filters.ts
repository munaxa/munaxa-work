/**
 * The query-string values a controller may accept.
 *
 * Bounded here as well as in the handler because a page size arrives as a string from an untrusted
 * edge, and `Number('abc')` is `NaN` — which compares false against every bound and would sail
 * through a naive check. **Every collection this module exposes is paginated**; there is no
 * unbounded course, assignment, enrolment or certification read on any route.
 *
 * **No civil date is converted here, and that is the whole point.** Every date Learning speaks —
 * a due date, an occurrence key, an issue date, an expiry, a completion day — is a `YYYY-MM-DD`
 * string in the domain, in the application command and in the published view. There is nothing to
 * convert, so there is nothing to convert wrongly: the Phase 8 defect cannot occur on this path
 * because no `Date` exists on it.
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

/** A page beyond the last is an empty page, not an error: the caller asked a legitimate question. */
export const paged = (query: Record<string, string | undefined>): Page => ({
  page: whole(query['page'], 1, Number.MAX_SAFE_INTEGER),
  size: whole(query['size'], DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
});

/** How many days ahead count as expiring. Absent means a plain yes-or-no question (ADR-0070). */
export const noticeDays = (query: Record<string, string | undefined>): number => {
  const parsed = Number(query['noticeDays']);

  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 3650);
};

/**
 * A boolean from the query string.
 *
 * Only the literal `true` turns a flag on. `?activeOnly=false` and `?activeOnly=maybe` both mean
 * off, because a filter that switched on for any present value would make `?activeOnly=false`
 * return exactly the rows it says it excludes.
 */
export const flag = (
  query: Record<string, string | undefined>,
  key: string,
): Record<string, boolean> => (query[key] === 'true' ? { [key]: true } : {});

/**
 * The filters a caller actually supplied.
 *
 * A key present with `undefined` is not the same as absent under `exactOptionalPropertyTypes`, and a
 * filter that arrived as `undefined` would narrow a search to rows whose column is literally null.
 * Dropping them here is what keeps an empty query string meaning "everything".
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

/** The same, for a body whose optional fields are already typed. Keeps numbers and booleans. */
export const present = <TShape extends object>(
  candidate: TShape,
): { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> } =>
  Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)) as {
    [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined>;
  };
