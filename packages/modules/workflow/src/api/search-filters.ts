/**
 * The query-string values a controller may accept.
 *
 * Bounded here as well as in the handler because a page size arrives as a string from an untrusted
 * edge, and `Number('abc')` is `NaN` — which compares false against every bound and would sail
 * through a naive check. **Every collection this module exposes is paginated**: there is no
 * unbounded definition, instance, queue, decision or history read on any route, and no route fetches
 * a collection in order to filter it in memory.
 *
 * **No date is converted here, and there is nothing to convert.** Workflow has no civil date at all
 * — a request, a decision and a step becoming current are moments, stored as `timestamptz` and
 * published as ISO instants. No route below accepts a date, no filter parses one, and there is no
 * `Date` anywhere on this path to get wrong.
 *
 * **No filter here names a person.** A queue is resolved from the membership on the request and from
 * nothing else, so there is deliberately no `approverMembershipId`, no `decidedBy` and no `me`
 * parameter in this file — a filter that could name somebody would be a filter that could name
 * somebody *else*.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface Page {
  readonly page: number;
  readonly size: number;
}

/**
 * A whole number from the query string, or the fallback.
 *
 * `Number(undefined)`, `Number('')`, `Number('abc')` and `Number('1.5')` all fail `isInteger` or the
 * lower bound, so every malformed page falls back rather than reaching a repository as `NaN` — where
 * `offset NaN` is a driver error and `limit NaN` is worse.
 */
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
