/**
 * The search filters that arrive as plain strings, listed once per search.
 *
 * Apart from the controllers because a controller's budget is 150 lines and this is a list rather
 * than transport logic — and because listing them in one place is what stops a filter existing in
 * the query handler and being silently unreachable from the API.
 */

const filtersOf = (
  query: Record<string, string>,
  keys: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    keys.filter((key) => query[key] !== undefined).map((key) => [key, query[key] as string]),
  );

export const planFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['status', 'code']);

export const onboardingFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['state', 'planId', 'employmentId', 'plannedStartFrom', 'plannedStartTo']);

export const taskFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['onboardingId', 'ownerKind', 'ownerRef', 'ownerRole', 'status', 'kind']);

/**
 * A boolean from the query string.
 *
 * Only the literal `true` turns a flag on. `?overdue=false` and `?overdue=maybe` both mean off,
 * because a filter that switched on for any present value would make `?overdue=false` return exactly
 * the rows it says it excludes.
 */
export const flag = (query: Record<string, string>, key: string): Record<string, boolean> =>
  query[key] === 'true' ? { [key]: true } : {};

/** A paging parameter from the query string, bounded rather than trusted. */
export const paging = (query: Record<string, string>): { page: number; size: number } => ({
  page: positiveInteger(query['page'], 1),
  size: positiveInteger(query['size'], DEFAULT_PAGE_SIZE),
});

const DEFAULT_PAGE_SIZE = 25;

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
