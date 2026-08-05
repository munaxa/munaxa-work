import { randomUUID } from 'node:crypto';

/**
 * UUIDv7 — a time-ordered identifier (RFC 9562).
 *
 * Every identifier in Munaxa Work is UUIDv7, not v4, and the reason is physical: a v4 primary
 * key writes to a random page of the index on every insert, so a table taking millions of
 * attendance events per month spends its life rewriting scattered B-tree pages. A v7 key is
 * ordered by time, so inserts land at the right edge of the index.
 *
 * Layout: 48 bits of Unix milliseconds, 4 bits version, 12 bits of counter, 2 bits variant,
 * 62 bits random.
 *
 * The counter guarantees that identifiers minted within the same millisecond still order by
 * creation, which is what makes them safe to sort by and to paginate on.
 */

const VERSION = 0x7;
const VARIANT = 0b10;
const MAXIMUM_COUNTER = 0xfff;

let lastTimestamp = -1;
let counter = 0;

const randomBytes = (): Uint8Array => {
  const bytes = new Uint8Array(8);
  const hex = randomUUID().replace(/-/g, '').slice(0, 16);

  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

const hex = (value: number, digits: number): string =>
  value.toString(16).padStart(digits, '0').slice(-digits);

/**
 * Mints a UUIDv7. `now` is injectable so tests can prove ordering behaviour without sleeping;
 * production callers pass nothing and get the wall clock.
 */
export const uuidV7 = (now: number = Date.now()): string => {
  if (now === lastTimestamp) {
    counter += 1;
    // Exhausting 4096 identifiers inside one millisecond is possible under bulk import. Waiting
    // for the next millisecond is correct; reusing a counter value would break ordering.
    if (counter > MAXIMUM_COUNTER) {
      return uuidV7(now + 1);
    }
  } else {
    lastTimestamp = now;
    counter = 0;
  }

  const timestampHex = hex(Math.floor(now / 0x100000000), 4) + hex(now % 0x100000000, 8);
  const versionAndCounter = hex((VERSION << 12) | counter, 4);
  const random = randomBytes();
  const variantAndRandom = hex(((VARIANT << 14) | (((random[0] ?? 0) << 6) | 0x3f)) & 0xffff, 4);
  const tail = Array.from(random.slice(1, 7))
    .map((byte) => hex(byte, 2))
    .join('');

  return [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    versionAndCounter,
    variantAndRandom,
    tail,
  ].join('-');
};

/** True when the value is a syntactically valid UUIDv7. */
export const isUuidV7 = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** The instant a UUIDv7 was minted. Useful in support, and in tests of ordering. */
export const timestampOf = (uuid: string): Date => {
  if (!isUuidV7(uuid)) {
    throw new TypeError(`Not a UUIDv7: ${uuid}`);
  }
  return new Date(Number.parseInt(uuid.slice(0, 8) + uuid.slice(9, 13), 16));
};
