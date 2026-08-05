import { DomainException } from '../errors/domain-exception.js';

/** Offset paging, for administration screens where a user expects page numbers. */
export interface PagedResult<TItem> {
  readonly items: readonly TItem[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

/**
 * Cursor paging, for large and changing sets.
 *
 * Offset paging over a table that is being written to shows duplicates and skips rows as the
 * offset shifts under the reader. Attendance events and audit trails are exactly that, and they
 * are also the largest tables in the system — a deep offset scan there is a full table scan.
 * Cursors are UUIDv7 identifiers, which sort by creation, which is why they are v7.
 */
export interface CursorResult<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

const MAXIMUM_PAGE_SIZE = 200;

export const pagedResult = <TItem>(
  items: readonly TItem[],
  page: number,
  pageSize: number,
  total: number,
): PagedResult<TItem> => {
  if (page < 1 || pageSize < 1 || pageSize > MAXIMUM_PAGE_SIZE) {
    throw new DomainException(
      'paging_out_of_range',
      `Page must be at least 1 and page size between 1 and ${String(MAXIMUM_PAGE_SIZE)}.`,
    );
  }
  return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
};

export const cursorResult = <TItem>(
  items: readonly TItem[],
  pageSize: number,
  cursorOf: (item: TItem) => string,
): CursorResult<TItem> => {
  const hasMore = items.length > pageSize;
  const page = hasMore ? items.slice(0, pageSize) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    hasMore,
    ...(hasMore && last !== undefined ? { nextCursor: cursorOf(last) } : {}),
  };
};
