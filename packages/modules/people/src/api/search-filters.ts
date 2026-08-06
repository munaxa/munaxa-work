/**
 * The string filters, hoisted so `search` stays inside the function budget.
 *
 * Only the named keys are carried through. The pipeline would refuse an undeclared property
 * anyway, but building the query from a fixed list rather than from whatever arrived means a
 * caller cannot reach a filter this endpoint did not intend to offer.
 */
const SEARCH_FILTERS = [
  'term',
  'status',
  'tagCode',
  'capabilityCode',
  'nationality',
  'identifierType',
  'identifierValue',
  'contactValue',
  'contactChannel',
] as const;

export const textFilters = (query: Record<string, string | undefined>): Record<string, string> => {
  const filters: Record<string, string> = {};

  for (const key of SEARCH_FILTERS) {
    const value = query[key];

    if (value !== undefined) filters[key] = value;
  }
  return filters;
};
