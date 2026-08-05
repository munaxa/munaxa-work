import { beforeEach, describe, expect, it } from 'vitest';
import { assertSucceeded } from '@work/testing';

import type { OrganizationTree, OrganizationUnitView } from '../contracts/views.js';

import {
  JANUARY,
  MARCH,
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
 * Unlimited depth, end to end through the real pipeline (AD-003).
 *
 * The specification names nine levels, and the obvious reading is nine tables — which is nine
 * levels, and a claim of unlimited depth the schema would contradict. ADR-0034 takes the other
 * road, and this suite is what makes that decision checkable: a twelve-level structure of one
 * repeated level, and a tenant that uses three levels none of which the specification names.
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

describe('a structure of arbitrary depth', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it('nests as deep as the tenant needs, with no level count anywhere', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      // One type, used at every level. If the implementation assumed a fixed ladder this would
      // be the first thing to fail — and a tenant whose structure is genuinely twelve levels of
      // the same kind is ordinary in a franchise business.
      const type = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'unit',
          name: bilingual('Unit', 'وحدة'),
          ordinal: 10,
        }),
      ).unitTypeId;

      const depth = 12;
      const ids: string[] = [];

      for (let level = 0; level < depth; level += 1) {
        const id = await createUnit(harness, type, `L${String(level)}`);

        ids.push(id);
        assertSucceeded(
          await place(harness, id, level === 0 ? undefined : ids[level - 1], JANUARY),
        );
      }

      const tree = await hierarchyAt(harness, MARCH);
      const deepest = ids[depth - 1] ?? '';
      const ancestry = assertSucceeded(
        await ask<UnitAncestry>(harness, {
          queryName: 'organization.unit-ancestry',
          unitId: deepest,
          asOf: MARCH,
        }),
      );

      expect(paths(tree)).toEqual(['L0 > L1 > L2 > L3 > L4 > L5 > L6 > L7 > L8 > L9 > L10 > L11']);
      expect(ancestry.ancestors).toHaveLength(depth - 1);
      expect(ancestry.ancestors[0]?.code).toBe('L10');
    }));

  it('lets a tenant use only the levels it has, without inventing the ones it does not', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      // Company, region, store. No division, no section, no team — and nothing asks for them.
      const company = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'company',
          name: bilingual('Company', 'شركة'),
          ordinal: 10,
        }),
      ).unitTypeId;
      const region = assertSucceeded(
        await send<TypeCreated>(harness, {
          commandName: 'organization.define-unit-type',
          code: 'region',
          name: bilingual('Region', 'منطقة'),
          ordinal: 20,
          allowedParentCodes: ['company'],
          allowedAtRoot: false,
        }),
      ).unitTypeId;

      const group = await createUnit(harness, company, 'GROUP');
      const central = await createUnit(harness, region, 'CENTRAL');

      assertSucceeded(await place(harness, group, undefined, JANUARY));
      assertSucceeded(await place(harness, central, group, JANUARY));

      expect(paths(await hierarchyAt(harness, MARCH))).toEqual(['GROUP > CENTRAL']);
    }));
});
