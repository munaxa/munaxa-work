import type { Transaction } from '@work/kernel';

import { parentOn, type UnitPlacementState } from '../domain/unit-placement.js';

import type { PlacementStore } from './organization-ports.js';

/**
 * Walking the structure as it stood on a date.
 *
 * These are the only functions in the module that traverse the hierarchy, and they are shared
 * rather than repeated because every one of them can loop forever on a cycle. Concentrating them
 * here means the guard against that is written once, and `ancestorsOf` is also what the move
 * use case calls *before* writing, so a cycle is refused rather than survived.
 *
 * Depth is never assumed and never bounded by a constant (AD-003). What bounds the walk is the
 * set of units already visited: a structure with N units has at most N ancestors, so a walk that
 * revisits a unit has found a cycle and stops. That is a correctness guard, not a depth limit —
 * a thousand-level hierarchy walks a thousand levels.
 */

export interface PlacementIndex {
  /** Every placement period, grouped by the unit it belongs to. */
  readonly byUnit: ReadonlyMap<string, readonly UnitPlacementState[]>;
}

export const indexPlacements = (states: readonly UnitPlacementState[]): PlacementIndex => {
  const byUnit = new Map<string, UnitPlacementState[]>();

  for (const state of states) {
    const existing = byUnit.get(state.unitId);

    if (existing === undefined) byUnit.set(state.unitId, [state]);
    else existing.push(state);
  }
  return { byUnit };
};

/** The parent in force on a date, from an index built once for a whole traversal. */
export const parentOfOn = (index: PlacementIndex, unitId: string, asOf: Date): string | undefined =>
  parentOn(index.byUnit.get(unitId) ?? [], asOf)?.value.parentUnitId;

/**
 * The chain from a unit's parent up to its root, nearest first, as it stood on a date.
 *
 * Stops on a repeat rather than trusting the data, because this function is exactly what a
 * cycle would hang, and it runs on every move.
 */
export const ancestorsOf = (
  index: PlacementIndex,
  unitId: string,
  asOf: Date,
): readonly string[] => {
  const chain: string[] = [];
  const seen = new Set<string>([unitId]);
  let current = parentOfOn(index, unitId, asOf);

  while (current !== undefined && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = parentOfOn(index, current, asOf);
  }
  return chain;
};

/** Every unit beneath one, at any depth, as it stood on a date. */
export const descendantsOf = (
  index: PlacementIndex,
  unitId: string,
  asOf: Date,
): readonly string[] => {
  const children = childIndexAt(index, asOf);
  const found: string[] = [];
  const queue = [unitId];
  const seen = new Set<string>([unitId]);

  while (queue.length > 0) {
    const next = queue.shift();

    if (next === undefined) break;
    for (const child of children.get(next) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
};

/** Parent to children, for the structure in force on a date. */
export const childIndexAt = (
  index: PlacementIndex,
  asOf: Date,
): ReadonlyMap<string, readonly string[]> => {
  const children = new Map<string, string[]>();

  for (const [unitId, placements] of index.byUnit) {
    const parent = parentOn(placements, asOf)?.value.parentUnitId;

    if (parent === undefined) continue;
    const existing = children.get(parent);

    if (existing === undefined) children.set(parent, [unitId]);
    else existing.push(unitId);
  }
  return children;
};

/** The units with a placement but no parent on a date: the tops of the structure. */
export const rootsAt = (index: PlacementIndex, asOf: Date): readonly string[] => {
  const roots: string[] = [];

  for (const [unitId, placements] of index.byUnit) {
    const entry = parentOn(placements, asOf);

    if (entry !== undefined && entry.value.parentUnitId === undefined) roots.push(unitId);
  }
  return roots;
};

/** Loads every placement period in the tenant and indexes it. One read, then pure walking. */
export const loadPlacementIndex = async (
  placements: PlacementStore,
  transaction: Transaction,
): Promise<PlacementIndex> => indexPlacements(await placements.all(transaction));
