import type { Paged } from './assets-ports.js';

/**
 * How a caller asks for a page, and how that request is bounded.
 *
 * Extracted from `assets-queries.ts` when custody's reads needed the same rules: one place decides
 * what a page is, so an unbounded read cannot appear by somebody writing their own arithmetic. A
 * second copy would eventually disagree, and the copy that was wrong would be the one that let a
 * caller ask for an entire tenant's inventory in one response.
 *
 * **A malformed page or size falls back rather than reaching the database.** `NaN` in a `limit` is a
 * query that either errors or returns everything, and neither is an answer.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAXIMUM_PAGE_SIZE = 200;

export interface PageRequest {
  readonly page?: number;
  readonly pageSize?: number;
}

export const pagedFrom = (request: PageRequest): Paged => {
  const size = boundedSize(request.pageSize);
  const page =
    request.page !== undefined && Number.isInteger(request.page) && request.page > 0
      ? request.page
      : 1;

  return { limit: size, offset: (page - 1) * size };
};

const boundedSize = (size: number | undefined): number => {
  if (size === undefined || !Number.isInteger(size) || size < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(size, MAXIMUM_PAGE_SIZE);
};
