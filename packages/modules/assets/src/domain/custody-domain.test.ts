import { describe, expect, it } from 'vitest';

import {
  CUSTODY_NOTE_LIMIT,
  issueCustody,
  openCustodyAmong,
  returnCustody,
  type CustodyRecord,
} from './custody.js';
import {
  CUSTODY_ELIGIBLE_STATUS,
  CUSTODY_STATES,
  INITIAL_CUSTODY_STATE,
} from './assets-vocabulary.js';

/**
 * The custody rules, in isolation from persistence, the dispatcher and the API.
 *
 * What is asserted here is the shape of the decisions: what opens a custody, what closes one, which
 * dates are refused, and how the current holder is derived.
 */

const TODAY = '2026-08-23';

const anIssue = (overrides: Record<string, unknown> = {}) =>
  issueCustody({
    assetCustodyId: 'custody-1',
    assetId: 'asset-1',
    employmentId: 'employment-1',
    issuedOn: '2026-08-20',
    today: TODAY,
    ...overrides,
  });

const opened = (overrides: Record<string, unknown> = {}): CustodyRecord => {
  const issued = anIssue(overrides);

  if (!issued.ok) throw new Error(`Refused: ${issued.error.reason}`);
  return issued.value;
};

describe('opening a custody', () => {
  it('starts open, and the caller does not choose', () => {
    expect(opened().state).toBe('open');
    expect(INITIAL_CUSTODY_STATE).toBe('open');
  });

  it('records the asset, the employment and the day, and nothing else', () => {
    const custody = opened({ issueNote: 'Handed over at the service desk' });

    expect(custody.assetId).toBe('asset-1');
    expect(custody.employmentId).toBe('employment-1');
    expect(custody.issuedOn).toBe('2026-08-20');
    expect(custody.issueNote).toBe('Handed over at the service desk');
    expect(custody.returnedOn).toBeUndefined();
    expect(custody.version).toBe(1);
  });

  /**
   * A caller who could date a handover forward could record that somebody holds an asset they have
   * not been given — and the same rule is what stops a return being pre-dated.
   */
  it('refuses a handover dated into the future', () => {
    const issued = anIssue({ issuedOn: '2026-08-24' });

    expect(issued.ok).toBe(false);
    if (issued.ok) return;
    expect(issued.error.reason).toBe('issued_on_in_future');
  });

  it('accepts today, because a handover usually happens today', () => {
    expect(anIssue({ issuedOn: TODAY }).ok).toBe(true);
  });

  it('refuses a date that is not a calendar date', () => {
    for (const issuedOn of ['20-08-2026', '2026-8-20', 'yesterday', '']) {
      const issued = anIssue({ issuedOn });

      expect(issued.ok).toBe(false);
      if (issued.ok) continue;
      expect(issued.error.reason).toBe('issued_on_malformed');
    }
  });

  it('bounds the note, and treats a blank one as absent', () => {
    expect(opened({ issueNote: '   ' }).issueNote).toBeUndefined();

    const tooLong = anIssue({ issueNote: 'x'.repeat(CUSTODY_NOTE_LIMIT + 1) });

    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.error.reason).toBe('issue_note_too_long');
  });

  /**
   * The fields the specification puts on `CustodyAssignment` that this checkpoint omits.
   *
   * Each configures a capability nobody has authorized, and two are downstream of open decisions.
   */
  it('records no condition, no expected return, no acknowledgement and no amount', () => {
    const fields = Object.keys(opened());

    for (const absent of [
      'conditionAtIssue',
      'conditionAtReturn',
      'expectedReturnOn',
      'acknowledgedOn',
      'acknowledgementRecordedBy',
      'approvedBy',
      'amount',
      'value',
      'liability',
      'documentId',
      'personId',
    ]) {
      expect(fields).not.toContain(absent);
    }
  });
});

describe('returning a custody', () => {
  it('closes the period it began, rather than creating a second record', () => {
    const returned = returnCustody({
      custody: opened(),
      returnedOn: '2026-08-22',
      today: TODAY,
    });

    expect(returned.ok).toBe(true);
    if (!returned.ok) return;

    expect(returned.value.assetCustodyId).toBe('custody-1');
    expect(returned.value.state).toBe('returned');
    expect(returned.value.returnedOn).toBe('2026-08-22');
    expect(returned.value.issuedOn).toBe('2026-08-20');
  });

  it('refuses a custody that has already been returned', () => {
    const once = returnCustody({ custody: opened(), returnedOn: '2026-08-22', today: TODAY });

    expect(once.ok).toBe(true);
    if (!once.ok) return;

    const twice = returnCustody({ custody: once.value, returnedOn: '2026-08-23', today: TODAY });

    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.error.reason).toBe('custody_not_open');
  });

  /** A period whose end precedes its beginning is not a period. */
  it('refuses a return dated before its own issue', () => {
    const returned = returnCustody({
      custody: opened({ issuedOn: '2026-08-20' }),
      returnedOn: '2026-08-19',
      today: TODAY,
    });

    expect(returned.ok).toBe(false);
    if (returned.ok) return;
    expect(returned.error.reason).toBe('returned_before_issued');
  });

  it('refuses a return dated into the future', () => {
    const returned = returnCustody({
      custody: opened(),
      returnedOn: '2026-08-24',
      today: TODAY,
    });

    expect(returned.ok).toBe(false);
    if (returned.ok) return;
    expect(returned.error.reason).toBe('returned_on_in_future');
  });

  it('permits a same-day return, because an asset can go out and come back', () => {
    expect(
      returnCustody({
        custody: opened({ issuedOn: '2026-08-22' }),
        returnedOn: '2026-08-22',
        today: TODAY,
      }).ok,
    ).toBe(true);
  });

  it('bounds the return note, and treats a blank one as absent', () => {
    const tooLong = returnCustody({
      custody: opened(),
      returnedOn: '2026-08-22',
      returnNote: 'x'.repeat(CUSTODY_NOTE_LIMIT + 1),
      today: TODAY,
    });

    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.error.reason).toBe('return_note_too_long');
  });
});

describe('the current holder', () => {
  it('is the open custody among a set', () => {
    const open = opened({ assetCustodyId: 'open-one' });
    const closed = returnCustody({
      custody: opened({ assetCustodyId: 'closed-one' }),
      returnedOn: '2026-08-21',
      today: TODAY,
    });

    expect(closed.ok).toBe(true);
    if (!closed.ok) return;

    expect(openCustodyAmong([closed.value, open])?.assetCustodyId).toBe('open-one');
  });

  /** Nobody holding it is a real answer, not a gap. */
  it('is absent when every custody has been returned', () => {
    const closed = returnCustody({ custody: opened(), returnedOn: '2026-08-21', today: TODAY });

    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(openCustodyAmong([closed.value])).toBeUndefined();
    expect(openCustodyAmong([])).toBeUndefined();
  });
});

describe('the custody vocabulary', () => {
  it('holds exactly two states', () => {
    expect(CUSTODY_STATES).toEqual(['open', 'returned']);
  });

  /**
   * The specification's wider lifecycle is absent, and its absence is the design: a vocabulary listing
   * a state nothing can produce is a promise the code cannot keep.
   */
  it('names no state a capability nobody authorized would produce', () => {
    const states: readonly string[] = CUSTODY_STATES;

    for (const absent of [
      'issued',
      'accepted',
      'acknowledged',
      'cancelled',
      'corrected',
      'transferred',
      'overdue',
      'outstanding',
      'written_off',
    ]) {
      expect(states).not.toContain(absent);
    }
  });

  /**
   * A custody may open only from `available`.
   *
   * `registered` is not yet in service, `under_repair` is out of it and `retired` is out for good.
   */
  it('opens only from an available asset', () => {
    expect(CUSTODY_ELIGIBLE_STATUS).toBe('available');
  });
});
