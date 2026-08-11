/**
 * The search filters that are plain strings, listed once per search.
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

export const requisitionFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['term', 'status', 'positionId', 'unitId', 'hiringManagerEmploymentId']);

export const vacancyFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['status', 'requisitionId']);

export const candidateFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['term', 'status', 'email', 'phone', 'sourceCode', 'personId', 'profileCode']);

export const applicationFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['term', 'status', 'vacancyId', 'candidateId', 'stageCode']);

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
