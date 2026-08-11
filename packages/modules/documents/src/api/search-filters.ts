/**
 * The query-string values a controller may accept, bounded before they reach a handler.
 *
 * Bounded here as well as in the handler because a page size arrives as a string from an untrusted
 * edge, and `Number('abc')` is `NaN` — which compares false against every bound and would sail
 * through a naive check. Every collection this module exposes is paginated; there is no unbounded
 * document read on any route.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface Page {
  readonly page: number;
  readonly size: number;
}

const whole = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

export const paged = (query: Record<string, string | undefined>): Page => ({
  page: whole(query['page'], 1, Number.MAX_SAFE_INTEGER),
  size: whole(query['size'], DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
});
