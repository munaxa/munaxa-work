import { beforeEach, describe, expect, it } from 'vitest';
import { assertSucceeded } from '@work/testing';

import type {
  OrganizationTree,
  OrganizationUnitView,
  UnitPlacementView,
} from '../contracts/views.js';

import {
  JANUARY,
  JUNE,
  MARCH,
  SEPTEMBER,
  TENANT_A,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './organization-test-harness.js';
import type { UnitAncestry } from './structure-queries.js';

/**
 * A reorganization, end to end through the real pipeline.
 *
 * This is the suite the phase turns on: *"what did this structure look like on this date"* must
 * have exactly one answer, for every date, forever. Two answers is a reorganization producing
 * two different cost allocations for the same month; no answer is a unit that vanishes from the
 * org chart for a week.
 */

const bilingual = (en: string, ar: string): Record<string, string> => ({ en, ar });

interface Created {
  readonly unitId: string;
}

interface TypeCreated {
  readonly unitTypeId: string;
}

const createUnit = async (
  harness: Harness,
  unitTypeId: string,
  code: string,
  effectiveFrom = JANUARY,
): Promise<string> =>
  assertSucceeded(
    await send<Created>(harness, {
      commandName: 'organization.create-unit',
      unitTypeId,
      code,
      name: bilingual(code, `${code} بالعربية`),
      effectiveFrom,
    }),
  ).unitId;

const place = (
  harness: Harness,
  unitId: string,
  parentUnitId: string | undefined,
  effectiveFrom: Date,
): ReturnType<typeof send> =>
  send(harness, {
    commandName: 'organization.place-unit',
    unitId,
    ...(parentUnitId === undefined ? {} : { parentUnitId }),
    effectiveFrom,
  });

const hierarchyAt = async (harness: Harness, asOf?: Date): Promise<OrganizationTree> =>
  assertSucceeded(
    await ask<OrganizationTree>(harness, {
      queryName: 'organization.hierarchy',
      ...(asOf === undefined ? {} : { asOf }),
    }),
  );

/** Flattens a tree to `code > code > code` paths, which is what a reader can actually check. */
const paths = (tree: OrganizationTree): readonly string[] => {
  const walk = (
    node: { unit: OrganizationUnitView; children: readonly unknown[] },
    prefix: string,
  ): string[] => {
    const here = prefix === '' ? node.unit.code : `${prefix} > ${node.unit.code}`;
    const children = node.children as {
      unit: OrganizationUnitView;
      children: readonly unknown[];
    }[];

    return children.length === 0 ? [here] : children.flatMap((child) => walk(child, here));
  };
  return tree.roots.flatMap((root) => walk(root, '')).sort();
};

describe('a reorganization', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it('keeps the old answer and gains a new one, rather than rewriting history', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const type = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'unit',
          name: bilingual('Unit', 'وحدة'),
          ordinal: 10,
        }),
      ).unitTypeId;

      const north = await createUnit(harness, type, 'NORTH');
      const south = await createUnit(harness, type, 'SOUTH');
      const payroll = await createUnit(harness, type, 'PAYROLL');

      assertSucceeded(await place(harness, north, undefined, JANUARY));
      assertSucceeded(await place(harness, south, undefined, JANUARY));
      assertSucceeded(await place(harness, payroll, north, JANUARY));

      // In June, payroll moves from north to south.
      assertSucceeded(await place(harness, payroll, south, JUNE));

      expect(paths(await hierarchyAt(harness, MARCH))).toEqual(['NORTH > PAYROLL', 'SOUTH']);
      expect(paths(await hierarchyAt(harness, SEPTEMBER))).toEqual(['NORTH', 'SOUTH > PAYROLL']);
    }));

  it('leaves exactly one answer at the instant of the move itself', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const { payroll, south } = await twoRegionsAndAMove(harness);
      const onTheDay = assertSucceeded(
        await ask<UnitAncestry>(harness, {
          queryName: 'organization.unit-ancestry',
          unitId: payroll,
          asOf: JUNE,
        }),
      );

      // Half-open periods: the move date belongs to the new period, not to both and not to
      // neither. This is the assertion that would fail if the periods were inclusive.
      expect(onTheDay.parentUnitId).toBe(south);
    }));

  it('records both periods, so the history itself is readable and not merely implied', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const { payroll, north, south } = await twoRegionsAndAMove(harness);
      const history = assertSucceeded(
        await ask<readonly UnitPlacementView[]>(harness, {
          queryName: 'organization.placement-history',
          unitId: payroll,
        }),
      );

      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ parentUnitId: north, effectiveTo: JUNE });
      expect(history[1]).toMatchObject({ parentUnitId: south, effectiveFrom: JUNE });
      expect(history[1]?.effectiveTo).toBeUndefined();
    }));

  it('supersedes the period in force at a back-dated move, not merely the open one', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const { payroll, north } = await twoRegionsAndAMove(harness);

      // A correction: payroll actually moved back to north in March, before the June move.
      assertSucceeded(await place(harness, payroll, north, MARCH));

      const history = assertSucceeded(
        await ask<readonly UnitPlacementView[]>(harness, {
          queryName: 'organization.placement-history',
          unitId: payroll,
        }),
      );

      // Three periods, and still exactly one in force on every date. Closing "the open one"
      // instead would have left two answers in the middle and none at the end.
      expect(history).toHaveLength(3);
      expect(history.map((period) => period.effectiveFrom)).toEqual([JANUARY, MARCH, JUNE]);
      expect(history[0]?.effectiveTo).toEqual(MARCH);
    }));

  it('is a no-op when a unit is placed exactly where it already is, so an import can be re-run', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const { payroll } = await twoRegionsAndAMove(harness);
      const before = assertSucceeded(
        await ask<readonly UnitPlacementView[]>(harness, {
          queryName: 'organization.placement-history',
          unitId: payroll,
        }),
      );

      assertSucceeded(await place(harness, payroll, before[1]?.parentUnitId, JUNE));

      const after = assertSucceeded(
        await ask<readonly UnitPlacementView[]>(harness, {
          queryName: 'organization.placement-history',
          unitId: payroll,
        }),
      );

      expect(after).toHaveLength(before.length);
    }));

  it('refuses a move that would put a unit beneath itself', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const type = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'unit',
          name: bilingual('Unit', 'وحدة'),
          ordinal: 10,
        }),
      ).unitTypeId;

      const company = await createUnit(harness, type, 'COMPANY');
      const division = await createUnit(harness, type, 'DIVISION');
      const department = await createUnit(harness, type, 'DEPARTMENT');

      assertSucceeded(await place(harness, company, undefined, JANUARY));
      assertSucceeded(await place(harness, division, company, JANUARY));
      assertSucceeded(await place(harness, department, division, JANUARY));

      const refused = await place(harness, division, department, JUNE);

      // Not bad data: a structure walk that never terminates. The org chart query is exactly
      // what would hang.
      expect(refused.ok).toBe(false);
      expect(refused.ok === false && refused.error).toMatchObject({
        kind: 'rejected',
        reason: 'organization.rejection.placement_would_create_cycle',
      });
    }));

  it('refuses a unit as its own parent before the handler even runs', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const type = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'unit',
          name: bilingual('Unit', 'وحدة'),
          ordinal: 10,
        }),
      ).unitTypeId;
      const unit = await createUnit(harness, type, 'ALONE');
      const refused = await place(harness, unit, unit, JANUARY);

      expect(refused.ok === false && refused.error.kind).toBe('validation');
    }));

  it("refuses a placement the tenant's own level rules forbid", async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const branch = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'branch',
          name: bilingual('Branch', 'فرع'),
          ordinal: 40,
        }),
      ).unitTypeId;
      const team = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'team',
          name: bilingual('Team', 'فريق'),
          ordinal: 80,
          allowedParentCodes: ['department'],
          allowedAtRoot: false,
        }),
      ).unitTypeId;

      const ruh = await createUnit(harness, branch, 'RUH');
      const squad = await createUnit(harness, team, 'SQUAD');

      assertSucceeded(await place(harness, ruh, undefined, JANUARY));
      const refused = await place(harness, squad, ruh, JANUARY);

      expect(refused.ok === false && refused.error).toMatchObject({
        kind: 'rejected',
        reason: 'organization.rejection.placement_not_permitted_by_type',
      });
    }));

  it('reports a unit that exists but sits nowhere, rather than dropping it from the chart', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const type = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'unit',
          name: bilingual('Unit', 'وحدة'),
          ordinal: 10,
        }),
      ).unitTypeId;

      const placed = await createUnit(harness, type, 'PLACED');
      const pending = await createUnit(harness, type, 'PENDING');

      assertSucceeded(await place(harness, placed, undefined, JANUARY));

      const tree = await hierarchyAt(harness, MARCH);

      // A branch approved before the group decides which region owns it. Real, and a chart that
      // silently omitted it is how one gets forgotten.
      expect(paths(tree)).toEqual(['PLACED']);
      expect(tree.unplacedUnitIds).toEqual([pending]);
    }));

  it('omits a unit that had not yet come into existence on the date asked about', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const type = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'unit',
          name: bilingual('Unit', 'وحدة'),
          ordinal: 10,
        }),
      ).unitTypeId;

      const later = await createUnit(harness, type, 'LATER', JUNE);

      assertSucceeded(await place(harness, later, undefined, JUNE));

      expect(paths(await hierarchyAt(harness, MARCH))).toEqual([]);
      expect(paths(await hierarchyAt(harness, SEPTEMBER))).toEqual(['LATER']);
    }));
});

/** Two regions with payroll under the northern one, moved south in June. */
const twoRegionsAndAMove = async (
  harness: Harness,
): Promise<{ north: string; south: string; payroll: string }> => {
  const type = assertSucceeded(
    await send<TypeCreated>(harness, {
      commandName: 'organization.define-unit-type',
      code: 'unit',
      name: bilingual('Unit', 'وحدة'),
      ordinal: 10,
    }),
  ).unitTypeId;

  const north = await createUnit(harness, type, 'NORTH');
  const south = await createUnit(harness, type, 'SOUTH');
  const payroll = await createUnit(harness, type, 'PAYROLL');

  assertSucceeded(await place(harness, north, undefined, JANUARY));
  assertSucceeded(await place(harness, south, undefined, JANUARY));
  assertSucceeded(await place(harness, payroll, north, JANUARY));
  assertSucceeded(await place(harness, payroll, south, JUNE));

  return { north, south, payroll };
};
