/**
 * The search filters that are plain strings, listed once.
 *
 * Apart from the controller because a controller's budget is 150 lines and this is a list rather
 * than transport logic — and because listing them in one place is what stops a filter existing in
 * the query handler and being silently unreachable from the API.
 */
export const textFilters = (query: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    (
      [
        'term',
        'status',
        'personId',
        'employmentTypeCode',
        'unitId',
        'positionId',
        'costCenterId',
        'managerEmploymentId',
      ] as const
    )
      .filter((key) => query[key] !== undefined)
      .map((key) => [key, query[key] as string]),
  );
