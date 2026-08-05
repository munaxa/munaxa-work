import { describe, expect, it } from 'vitest';

import { DomainException } from '../errors/domain-exception.js';

import { cursorResult, pagedResult } from './paged-result.js';

describe('pagedResult', () => {
  it('reports the page count', () => {
    expect(pagedResult([1, 2], 1, 20, 41).totalPages).toBe(3);
  });

  it('refuses a page size that would let a caller pull the table', () => {
    expect(() => pagedResult([], 1, 5000, 0)).toThrow(DomainException);
    expect(() => pagedResult([], 0, 20, 0)).toThrow(DomainException);
  });
});

describe('cursorResult', () => {
  const id = (value: { id: string }): string => value.id;

  it('trims the lookahead row and hands back a cursor', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = cursorResult(rows, 2, id);

    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('b');
  });

  it('omits the cursor on the last page rather than returning an empty one', () => {
    const result = cursorResult([{ id: 'a' }], 2, id);

    expect(result.hasMore).toBe(false);
    expect('nextCursor' in result).toBe(false);
  });
});
