import type { Page, Paged } from './career-ports.js';

/**
 * The bound every collection read in this module takes.
 *
 * Stated once so no query can quietly omit it. A tenant with a hundred thousand employments is the
 * case this is designed for, not the exception — and the two reads most likely to be asked for
 * unbounded, "every critical position" and "the whole nine-box", are the two this module cannot
 * answer at all (D-4, D-5).
 *
 * `size` is clamped rather than refused. A caller asking for 10,000 rows gets 200 and a `total`
 * that tells them how many there are, which is a truthful answer; refusing would tempt a client
 * into paging in a loop, which is the same unbounded read spelled differently.
 */

const DEFAULT_SIZE = 50;
const MAX_SIZE = 200;

export const pageOf = (query: { readonly page?: number; readonly size?: number }): Paged => {
  const size = Math.min(MAX_SIZE, Math.max(1, query.size ?? DEFAULT_SIZE));

  return { limit: size, offset: (Math.max(1, query.page ?? 1) - 1) * size };
};

/** What a caller with no read scope gets. Never an unbounded page, and never a forbidden. */
export const emptyPage = <TItem>(): Page<TItem> => ({ items: [], total: 0 });

/** The largest page this module will produce, stated so a test can assert on the number itself. */
export const MAXIMUM_PAGE_SIZE = MAX_SIZE;
