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

export const recurringFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['employmentId', 'componentId', 'effectiveOn']);

export const oneTimeFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['employmentId', 'componentId', 'fromDate', 'toDate']);

export const adjustmentFilters = (query: Record<string, string>): Record<string, string> =>
  filtersOf(query, ['employmentId', 'componentId']);

/**
 * Paging, bounded rather than trusted.
 *
 * `limit` and `offset` rather than `page` and `size`, because that is what the query handlers take
 * and translating between the two at the edge is one more place for an off-by-one. The bound is
 * applied here **and** in the handler: the edge is convenience, the handler is the guarantee.
 */
export const paging = (query: Record<string, string>): { limit: number; offset: number } => {
  const limit = Math.min(MAX_PAGE_SIZE, positiveInteger(query['size'], DEFAULT_PAGE_SIZE));
  const page = positiveInteger(query['page'], 1);

  return { limit, offset: (page - 1) * limit };
};

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * A comma-separated list of employment identifiers, bounded.
 *
 * The payroll-period read takes a **page** of employments; a caller asking for the whole workforce
 * in one request is asking for a query nobody can bound, and the answer is a page rather than a
 * refusal so a payroll run can simply keep asking.
 */
export const employmentIds = (value: string | undefined, bound: number): readonly string[] =>
  (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '')
    .slice(0, bound);
