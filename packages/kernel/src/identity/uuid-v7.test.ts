import { describe, expect, it } from 'vitest';

import { isUuidV7, timestampOf, uuidV7 } from './uuid-v7.js';

describe('uuidV7', () => {
  it('produces a syntactically valid v7 identifier', () => {
    expect(isUuidV7(uuidV7())).toBe(true);
  });

  it('encodes the minting time', () => {
    const now = Date.UTC(2026, 6, 27, 12, 0, 0);

    expect(timestampOf(uuidV7(now)).getTime()).toBe(now);
  });

  it('sorts by creation time as text — the property the database index relies on', () => {
    const identifiers = [
      uuidV7(Date.UTC(2026, 0, 1)),
      uuidV7(Date.UTC(2026, 5, 1)),
      uuidV7(Date.UTC(2026, 11, 1)),
    ];

    expect([...identifiers].sort()).toEqual(identifiers);
  });

  it('stays ordered within a single millisecond', () => {
    const now = Date.now();
    const identifiers = Array.from({ length: 500 }, () => uuidV7(now));

    expect([...identifiers].sort()).toEqual(identifiers);
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  it('is unique across many identifiers', () => {
    const identifiers = new Set(Array.from({ length: 20_000 }, () => uuidV7()));

    expect(identifiers.size).toBe(20_000);
  });

  it('rejects a value that is not a v7 identifier', () => {
    expect(isUuidV7('7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(false);
    expect(() => timestampOf('not-a-uuid')).toThrow(TypeError);
  });
});
