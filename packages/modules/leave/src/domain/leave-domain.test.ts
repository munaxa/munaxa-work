import { describe, expect, it } from 'vitest';

import { figuresFrom, openBalance, recalculated } from './balance.js';
import { ledgerEntry, reversalOf } from './ledger.js';
import { signAgreesWithKind } from './leave-vocabulary.js';
import type { LedgerEntryState } from './ledger.js';

/**
 * The accounting core: the ledger, and the projection derived from it.
 *
 * The arithmetic is the priority. A leave balance that is wrong by one day is indistinguishable
 * from one that is right, and nobody notices until somebody is refused leave they had — so the
 * sign convention, the digest and the stale mark are each tested where they decide something.
 */

const TENANT = '00000000-0000-7000-8000-000000000001';
const AT = new Date('2026-06-15T09:00:00Z');

const anEntry = (overrides: Partial<Parameters<typeof ledgerEntry>[0]> = {}): LedgerEntryState => {
  const result = ledgerEntry(
    {
      tenantId: TENANT,
      employmentId: '00000000-0000-7000-8000-00000000000e',
      leaveTypeId: '00000000-0000-7000-8000-00000000000f',
      leaveYearStart: '2026-01-01',
      kind: 'accrual',
      minutes: 480,
      effectiveOn: '2026-01-31',
      sourceKind: 'accrual_run',
      sourceId: '00000000-0000-7000-8000-0000000000aa',
      balanceBeforeMinutes: 0,
      ...overrides,
    },
    AT,
  );

  if (!result.ok) throw new Error(`Could not build an entry: ${result.error.reason}`);
  return result.value;
};

describe('the ledger', () => {
  it('refuses a movement of no minutes, which would sum to nothing and read as a mystery', () => {
    const result = ledgerEntry(
      {
        tenantId: TENANT,
        employmentId: 'e',
        leaveTypeId: 't',
        leaveYearStart: '2026-01-01',
        kind: 'adjustment',
        minutes: 0,
        effectiveOn: '2026-01-31',
        sourceKind: 'adjustment',
        sourceId: 'a',
        reasonCode: 'correction',
        balanceBeforeMinutes: 0,
      },
      AT,
    );

    expect(result.ok).toBe(false);
  });

  /** The sign convention is in the database too; a domain that only learned it from a 23514 would
   * report somebody's mistake as a system fault. */
  it('refuses a credit kind carrying a debit', () => {
    const result = ledgerEntry(
      {
        tenantId: TENANT,
        employmentId: 'e',
        leaveTypeId: 't',
        leaveYearStart: '2026-01-01',
        kind: 'accrual',
        minutes: -480,
        effectiveOn: '2026-01-31',
        sourceKind: 'accrual_run',
        sourceId: 'a',
        balanceBeforeMinutes: 0,
      },
      AT,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.reason).toBe('ledger_sign_disagrees_with_kind');
  });

  it('agrees with the check constraint on every kind', () => {
    expect(signAgreesWithKind('opening', 1)).toBe(true);
    expect(signAgreesWithKind('opening', -1)).toBe(false);
    expect(signAgreesWithKind('consumption', -1)).toBe(true);
    expect(signAgreesWithKind('consumption', 1)).toBe(false);
    expect(signAgreesWithKind('adjustment', -1)).toBe(true);
    expect(signAgreesWithKind('adjustment', 1)).toBe(true);
  });

  it('requires a reason on an adjustment, the one movement no rule produced', () => {
    const result = ledgerEntry(
      {
        tenantId: TENANT,
        employmentId: 'e',
        leaveTypeId: 't',
        leaveYearStart: '2026-01-01',
        kind: 'adjustment',
        minutes: 60,
        effectiveOn: '2026-01-31',
        sourceKind: 'adjustment',
        sourceId: 'a',
        balanceBeforeMinutes: 0,
      },
      AT,
    );

    expect(result.ok ? '' : result.error.reason).toBe('adjustment_requires_a_reason');
  });

  it('records what it moved the balance to, so an adjustment needs no replay to explain', () => {
    const entry = anEntry({ minutes: 480, balanceBeforeMinutes: 1200 });

    expect(entry.balanceBeforeMinutes).toBe(1200);
    expect(entry.balanceAfterMinutes).toBe(1680);
  });

  it('reverses with the opposite sign and names what it reversed', () => {
    const original = anEntry({ kind: 'consumption', minutes: -960 });
    const reversal = reversalOf(
      original,
      {
        sourceKind: 'request',
        sourceId: '00000000-0000-7000-8000-0000000000bb',
        effectiveOn: '2026-03-01',
        balanceBeforeMinutes: -960,
      },
      AT,
    );

    expect(reversal.ok).toBe(true);
    expect(reversal.ok ? reversal.value.minutes : 0).toBe(960);
    expect(reversal.ok ? reversal.value.kind : '').toBe('reversal');
    expect(reversal.ok ? reversal.value.reversesEntryId : '').toBe(original.id);
  });
});

describe('the balance projection', () => {
  it('is a sum of every entry, not an expression built from the components', () => {
    const figures = figuresFrom([
      anEntry({ kind: 'opening', minutes: 9600, sourceId: 'a1' }),
      anEntry({ kind: 'accrual', minutes: 480, sourceId: 'a2' }),
      anEntry({ kind: 'consumption', minutes: -1920, sourceId: 'a3' }),
      anEntry({ kind: 'adjustment', minutes: -60, reasonCode: 'correction', sourceId: 'a4' }),
    ]);

    expect(figures.openingMinutes).toBe(9600);
    expect(figures.accruedMinutes).toBe(480);
    // Reported positive though the entries are negative: a screen reading "-1920 consumed" invites
    // somebody to subtract it twice.
    expect(figures.consumedMinutes).toBe(1920);
    expect(figures.adjustedMinutes).toBe(-60);
    expect(figures.availableMinutes).toBe(9600 + 480 - 1920 - 60);
  });

  it('produces the same digest for the same entries in any order', () => {
    const one = anEntry({ sourceId: 'a1' });
    const other = anEntry({ sourceId: 'a2' });

    expect(figuresFrom([one, other]).entriesDigest).toBe(figuresFrom([other, one]).entriesDigest);
  });

  /**
   * The Phase 8 defect, not repeated: recalculation clears the stale mark **whether or not the
   * figures moved**. A balance left marked would sit in the reconciliation queue for ever.
   */
  it('clears the stale mark even when nothing changed', () => {
    const opened = openBalance(
      {
        tenantId: TENANT,
        employmentId: 'e',
        leaveTypeId: 't',
        leaveYear: { start: '2026-01-01', end: '2026-12-31' },
      },
      AT,
    );

    expect(opened.inputsChangedAt).toBeDefined();

    const first = recalculated(opened, [], AT);

    expect(first.state.inputsChangedAt).toBeUndefined();

    const again = recalculated(first.state, [], AT);

    expect(again.changed).toBe(false);
    expect(again.state.inputsChangedAt).toBeUndefined();
  });

  it('does not clamp a negative balance, because a deficit is what somebody needs to see', () => {
    const figures = figuresFrom([anEntry({ kind: 'consumption', minutes: -480 })]);

    expect(figures.availableMinutes).toBe(-480);
  });
});
