import type { Page, Paged } from './workflow-ports.js';

/**
 * The bound every collection read in this module takes.
 *
 * Stated once so no query can quietly omit it. An approval queue and an instance history are the two
 * reads most likely to be asked for unbounded — "show me everything waiting" and "show me the whole
 * timeline" — and both grow without limit in a tenant that has been running for a year.
 *
 * `size` is clamped rather than refused. A caller asking for 10,000 rows gets 200 and a `total` that
 * tells them how many there are, which is a truthful answer; refusing would tempt a client into
 * paging in a loop, which is the same unbounded read spelled differently.
 *
 * **`Number.isFinite` rather than `Math.max` alone, and that is a real difference.** `Math.max(1,
 * NaN)` is `NaN`, so the shared shape used by Career and Learning turns `?size=abc` into a `NaN`
 * limit and a `NaN` offset — which reaches `slice(NaN, NaN)` in a fake and `limit NaN` in SQL. Those
 * modules are protected at the HTTP edge by a `class-validator` integer rule and are not defective in
 * production, but the *application layer* answering an unparsed number should not depend on an edge
 * that a future caller — a reconciliation command, a test, another module — may not go through. The
 * copies in the completed modules are left alone and recorded as debt; this one is written correctly.
 */

const DEFAULT_SIZE = 50;
const MAX_SIZE = 200;

/** A whole number of at least one, or the stated fallback. Rejects NaN, Infinity and fractions. */
const wholeAtLeastOne = (value: number | undefined, fallback: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
};

export const pageOf = (query: { readonly page?: number; readonly size?: number }): Paged => {
  const size = Math.min(MAX_SIZE, wholeAtLeastOne(query.size, DEFAULT_SIZE));

  return { limit: size, offset: (wholeAtLeastOne(query.page, 1) - 1) * size };
};

/** What a caller with no read scope gets. Never an unbounded page, and never a forbidden. */
export const emptyPage = <TItem>(): Page<TItem> => ({ items: [], total: 0 });

/** The largest page this module will produce, stated so a test can assert on the number itself. */
export const MAXIMUM_PAGE_SIZE = MAX_SIZE;
export const DEFAULT_PAGE_SIZE = DEFAULT_SIZE;
