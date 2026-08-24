import { describe, expect, it } from 'vitest';

import { civilDateOf, custodyAgeing, isCivilDate, wholeDaysBetween } from './custody-ageing.js';
import type { CustodyRecord } from './custody.js';

/**
 * Ageing arithmetic, proved at its boundaries rather than in its middle.
 *
 * The middle of this function is subtraction and cannot be interestingly wrong. Every defect it could
 * carry lives at an edge: the day of issue, a date before the issue, a leap day, a year boundary, and
 * the difference between a figure that moves and one that has stopped.
 */

const custody = (over: Partial<CustodyRecord>): CustodyRecord => ({
  assetCustodyId: 'custody-1',
  assetId: 'asset-1',
  employmentId: 'employment-1',
  issuedOn: '2026-01-10',
  state: 'open',
  version: 1,
  ...over,
});

describe('an open custody ages against the date it is measured from', () => {
  it('counts the day of issue as day zero', () => {
    expect(custodyAgeing(custody({ issuedOn: '2026-01-10' }), '2026-01-10')).toEqual({
      daysOutstanding: 0,
    });
  });

  it('counts whole days across a month boundary', () => {
    expect(custodyAgeing(custody({ issuedOn: '2026-01-10' }), '2026-02-10')).toEqual({
      daysOutstanding: 31,
    });
  });

  it('counts across a year boundary', () => {
    expect(custodyAgeing(custody({ issuedOn: '2025-12-31' }), '2026-01-01')).toEqual({
      daysOutstanding: 1,
    });
  });

  it('counts the leap day in a leap year, and does not count one that is not there', () => {
    // 2028 is a leap year; 2027 is not. February is 29 days in one and 28 in the other, and a
    // calculation that assumed a fixed month would report the same number for both.
    expect(custodyAgeing(custody({ issuedOn: '2028-02-01' }), '2028-03-01')).toEqual({
      daysOutstanding: 29,
    });
    expect(custodyAgeing(custody({ issuedOn: '2027-02-01' }), '2027-03-01')).toEqual({
      daysOutstanding: 28,
    });
  });

  it('answers a future date, because asking how old this will be is a fair question', () => {
    expect(custodyAgeing(custody({ issuedOn: '2026-01-10' }), '2027-01-10')).toEqual({
      daysOutstanding: 365,
    });
  });
});

describe('what ageing refuses to claim', () => {
  /**
   * The one case with a genuine choice behind it. Zero would say the asset was outstanding on a day it
   * had not been handed over, and a negative number is arithmetic escaping into a report. Absence is
   * the only answer that is true.
   */
  it('publishes no figure at all when the date precedes the issue', () => {
    expect(custodyAgeing(custody({ issuedOn: '2026-01-10' }), '2026-01-09')).toEqual({});
  });

  it('publishes no daysOutstanding on a custody that has come back', () => {
    const returned = custody({
      issuedOn: '2026-01-10',
      returnedOn: '2026-01-20',
      state: 'returned',
    });

    expect(custodyAgeing(returned, '2026-06-01')).toEqual({ daysHeld: 10 });
    expect(custodyAgeing(returned, '2026-06-01')).not.toHaveProperty('daysOutstanding');
  });

  /**
   * A closed custody's span is a fact about what happened, not a measurement taken now. Reading it
   * against three different dates must produce three identical answers, or the figure is a moving
   * number pretending to be a record.
   */
  it('holds a returned custody’s span still, whatever date it is read against', () => {
    const returned = custody({
      issuedOn: '2026-01-10',
      returnedOn: '2026-01-20',
      state: 'returned',
    });

    for (const asAt of ['2026-01-20', '2026-03-01', '2030-12-31']) {
      expect(custodyAgeing(returned, asAt)).toEqual({ daysHeld: 10 });
    }
  });

  it('issued and returned on one day is a span of zero, not of one', () => {
    const sameDay = custody({
      issuedOn: '2026-01-10',
      returnedOn: '2026-01-10',
      state: 'returned',
    });

    expect(custodyAgeing(sameDay, '2026-01-10')).toEqual({ daysHeld: 0 });
  });
});

describe('the arithmetic underneath', () => {
  /**
   * Over UTC midnights, so no timezone and no daylight-saving transition can move a boundary. The
   * dates below straddle European and North American DST changes, where a local-time calculation
   * produces 30.958… days and truncates to the wrong answer.
   */
  it('is unmoved by daylight saving in either hemisphere', () => {
    expect(wholeDaysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(wholeDaysBetween('2026-10-01', '2026-11-01')).toBe(31);
  });

  it('returns a whole number, never a fraction', () => {
    expect(Number.isInteger(wholeDaysBetween('2026-03-01', '2026-11-01'))).toBe(true);
  });

  it('reduces an instant to the civil date it falls on, in UTC', () => {
    expect(civilDateOf(new Date('2026-01-10T23:59:59.999Z'))).toBe('2026-01-10');
    expect(civilDateOf(new Date('2026-01-11T00:00:00.000Z'))).toBe('2026-01-11');
  });

  it('accepts a civil date and refuses everything that is not one', () => {
    expect(isCivilDate('2026-01-10')).toBe(true);

    for (const malformed of ['2026-1-10', '10-01-2026', '2026-01-10T00:00:00Z', 'today', '']) {
      expect(isCivilDate(malformed)).toBe(false);
    }
  });
});
