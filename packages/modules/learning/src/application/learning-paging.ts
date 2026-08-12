import type { Page, Paged } from './learning-ports.js';

/**
 * The bound every collection read in this module takes.
 *
 * Stated once so no query can quietly omit it: a tenant reconciling annual safety training for a
 * hundred thousand employments is the case this is designed for, not the exception.
 */

const DEFAULT_SIZE = 50;
const MAX_SIZE = 200;

export const pageOf = (query: { readonly page?: number; readonly size?: number }): Paged => {
  const size = Math.min(MAX_SIZE, Math.max(1, query.size ?? DEFAULT_SIZE));

  return { limit: size, offset: (Math.max(1, query.page ?? 1) - 1) * size };
};

/** What a caller with no read scope gets. Never an unbounded page, and never a forbidden. */
export const emptyPage = <TItem>(): Page<TItem> => ({ items: [], total: 0 });
