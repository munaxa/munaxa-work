import { describe, expect, it } from 'vitest';
import { DomainException } from '@work/kernel';

import {
  UnitPlacement,
  parentOn,
  placementTimeline,
  wouldCreateCycle,
  type UnitPlacementState,
} from './unit-placement.js';

/**
 * The placement timeline — the invariant this whole phase rests on.
 *
 * The property under test is not "a placement can be saved". It is that *"what did this
 * structure look like on this date" has exactly one answer, for every date*. Two answers is a
 * reorganization that produces two different cost allocations for the same month; no answer is a
 * unit that vanishes from the org chart for a week.
 */

const origin = { tenantId: 'tenant', correlationId: 'correlation', actor: 'user:test' };
const at = (iso: string): Date => new Date(iso);

const period = (
  from: string,
  to: string | undefined,
  parentUnitId: string | undefined,
  id = `placement-${from}`,
): UnitPlacementState => ({
  id,
  tenantId: 'tenant',
  unitId: 'unit',
  ...(parentUnitId === undefined ? {} : { parentUnitId }),
  effectiveFrom: at(from),
  ...(to === undefined ? {} : { effectiveTo: at(to) }),
  version: 1,
});

describe('a placement period', () => {
  it('records where a unit sits and from when', () => {
    const placement = UnitPlacement.open(
      {
        tenantId: 'tenant',
        unitId: 'unit',
        parentUnitId: 'parent',
        effectiveFrom: at('2026-01-01'),
      },
      origin,
      at('2026-01-01'),
    );

    expect(placement.unitId).toBe('unit');
    expect(placement.parentUnitId).toBe('parent');
    expect(placement.isOpen).toBe(true);
    expect(placement.pullEvents()[0]?.eventName).toBe('organization.unit.placed');
  });

  it('treats a unit with no parent as a root, which is a placement rather than an absence', () => {
    const placement = UnitPlacement.open(
      { tenantId: 'tenant', unitId: 'unit', effectiveFrom: at('2026-01-01') },
      origin,
      at('2026-01-01'),
    );

    expect(placement.parentUnitId).toBeUndefined();
    expect(placement.isOpen).toBe(true);
  });

  it('refuses to end before it began, which would be a period nothing is in force during', () => {
    const placement = UnitPlacement.open(
      { tenantId: 'tenant', unitId: 'unit', effectiveFrom: at('2026-06-01') },
      origin,
      at('2026-06-01'),
    );
    const closed = placement.closeAt(at('2026-06-01'), origin, at('2026-06-01'));

    expect(closed.ok).toBe(false);
    expect(closed.ok === false && closed.error.reason).toBe('placement_closed_before_it_opened');
  });

  it('refuses to close a period that has already been closed', () => {
    const placement = UnitPlacement.rehydrate(period('2026-01-01', '2026-06-01', 'parent'));

    const closed = placement.closeAt(at('2026-09-01'), origin, at('2026-09-01'));

    expect(closed.ok === false && closed.error.reason).toBe('placement_already_closed');
  });
});

describe("the timeline a unit's periods make", () => {
  it('answers where a unit was on a date, for each period in turn', () => {
    const periods = [
      period('2026-01-01', '2026-06-01', 'division-a'),
      period('2026-06-01', undefined, 'division-b'),
    ];

    expect(parentOn(periods, at('2026-03-01'))?.value.parentUnitId).toBe('division-a');
    expect(parentOn(periods, at('2026-09-01'))?.value.parentUnitId).toBe('division-b');
  });

  it('is half-open, so the move date itself belongs to the new period and not to both', () => {
    const periods = [
      period('2026-01-01', '2026-06-01', 'division-a'),
      period('2026-06-01', undefined, 'division-b'),
    ];

    // The exact instant of the move. With inclusive ends this date would be in both periods,
    // and "which division was this under on 1 June" would have two answers.
    expect(parentOn(periods, at('2026-06-01'))?.value.parentUnitId).toBe('division-b');
  });

  it('answers nothing for a date before the unit was ever placed', () => {
    expect(
      parentOn([period('2026-06-01', undefined, 'division')], at('2026-01-01')),
    ).toBeUndefined();
  });

  it('refuses to exist at all if two periods are in force at once', () => {
    const overlapping = [
      period('2026-01-01', '2026-09-01', 'division-a', 'first'),
      period('2026-06-01', undefined, 'division-b', 'second'),
    ];

    // Not a display problem: two answers to "where is this unit". The kernel's Timeline makes
    // the state unrepresentable rather than merely unlikely, so a database that had somehow
    // acquired such rows fails loudly here instead of answering with whichever row came first.
    expect(() => placementTimeline(overlapping)).toThrow(DomainException);
    expect(() => placementTimeline(overlapping)).toThrow(/exactly one value/);
  });

  it('orders periods by their start regardless of the order they arrive in', () => {
    const shuffled = [
      period('2026-06-01', undefined, 'division-b'),
      period('2026-01-01', '2026-06-01', 'division-a'),
    ];

    expect(placementTimeline(shuffled).all.map((entry) => entry.value.parentUnitId)).toEqual([
      'division-a',
      'division-b',
    ]);
  });
});

describe('the cycle guard', () => {
  it('refuses a unit as its own parent', () => {
    expect(wouldCreateCycle('unit', 'unit', [])).toBe(true);
  });

  it('refuses a parent that the unit is already an ancestor of', () => {
    // Moving the division under its own department: a walk that never terminates.
    expect(wouldCreateCycle('division', 'department', ['branch', 'division', 'company'])).toBe(
      true,
    );
  });

  it('permits an unrelated parent', () => {
    expect(wouldCreateCycle('team-a', 'department-b', ['division', 'company'])).toBe(false);
  });
});
