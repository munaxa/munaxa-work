import { beforeEach, describe, expect, it } from 'vitest';
import { assertFailedWith, assertSucceeded } from '@work/testing';

import type { OrganizationTree, OrganizationUnitView } from '../contracts/views.js';
import type { PagedResult } from '@work/kernel';

import {
  ALL,
  JANUARY,
  JUNE,
  TENANT_A,
  TENANT_B,
  asTenant,
  ask,
  harnessFor,
  harnessWithStores,
  send,
  testClock,
  type Harness,
} from './organization-test-harness.js';
import { inMemoryOrganizationStores } from './in-memory-stores.js';
import {
  ALL_ORGANIZATION_PERMISSIONS,
  OrganizationPermissions,
} from './organization-permissions.js';
import { organizationModule } from './organization-module.js';

/**
 * Authorization, tenant isolation and concurrency — the three properties that are wrong
 * silently.
 *
 * A missing permission fails open exactly once, on the endpoint nobody checked. A tenant leak
 * shows another customer's structure and looks like working software. A lost update makes the
 * second administrator's change disappear with no error anywhere. None of the three produces a
 * stack trace, so each has to be asserted rather than observed.
 */

const bilingual = (en: string, ar: string): Record<string, string> => ({ en, ar });

const aUnitIn = async (harness: Harness, code: string): Promise<string> => {
  const type = assertSucceeded(
    await send<{ unitTypeId: string }>(harness, {
      commandName: 'organization.define-unit-type',
      code: 'unit',
      name: bilingual('Unit', 'وحدة'),
      ordinal: 10,
    }),
  ).unitTypeId;

  return assertSucceeded(
    await send<{ unitId: string }>(harness, {
      commandName: 'organization.create-unit',
      unitTypeId: type,
      code,
      name: bilingual(code, `${code} بالعربية`),
      effectiveFrom: JANUARY,
    }),
  ).unitId;
};

describe('the permissions this module registers', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it('are declared by the module, so the administration screen offers all of them', () => {
    const module = organizationModule(
      {
        unitOfWork: { execute: async (work) => work({} as never) },
        stores: inMemoryOrganizationStores(),
        filled: { filledFor: () => Promise.resolve(0) },
        clock: { now: () => new Date() },
      },
      { send: () => Promise.reject(new Error('unused')) },
    );

    // Every permission a handler declares must be in the published set. A permission that
    // existed in code but not in the administration screen would be invisible until a customer
    // found it.
    const declared = new Set([
      ...(module.commands ?? []).map((handler) => handler.permission),
      ...(module.queries ?? []).map((handler) => handler.permission),
    ]);

    for (const permission of declared) {
      expect(ALL_ORGANIZATION_PERMISSIONS).toContain(permission);
    }
    expect(module.permissions).toEqual(ALL_ORGANIZATION_PERMISSIONS);
  });

  it('separate seeing the org chart from reorganizing the company', async () =>
    asTenant(TENANT_A, async () => {
      const viewer = harnessFor(TENANT_A, [
        OrganizationPermissions.hierarchyRead,
        OrganizationPermissions.unitRead,
        OrganizationPermissions.unitManage,
        OrganizationPermissions.unitTypeManage,
      ]);
      const unit = await aUnitIn(viewer, 'RUH');

      // Reading the structure is held broadly — an org chart is not a secret inside a company.
      // Moving a unit is a reorganization, and it is held by very few.
      assertSucceeded(await ask(viewer, { queryName: 'organization.hierarchy' }));
      assertFailedWith(
        await send(viewer, {
          commandName: 'organization.place-unit',
          unitId: unit,
          effectiveFrom: JANUARY,
        }),
        'forbidden',
      );
    }));

  it('separate proposing a headcount budget from approving one', async () =>
    asTenant(TENANT_A, async () => {
      const proposer = harnessFor(TENANT_A, [
        ...ALL.filter((permission) => permission !== OrganizationPermissions.establishmentApprove),
      ]);
      const unit = await aUnitIn(proposer, 'RUH');
      const position = assertSucceeded(
        await send<{ positionId: string }>(proposer, {
          commandName: 'organization.define-position',
          code: 'HR-MGR',
          title: bilingual('HR Manager', 'مدير الموارد البشرية'),
          effectiveFrom: JANUARY,
        }),
      ).positionId;
      const line = assertSucceeded(
        await send<{ establishmentId: string }>(proposer, {
          commandName: 'organization.set-establishment',
          positionId: position,
          unitId: unit,
          budgetedHeadcount: 3,
          effectiveFrom: JANUARY,
        }),
      ).establishmentId;

      assertFailedWith(
        await send(proposer, {
          commandName: 'organization.approve-establishment',
          establishmentId: line,
          expectedVersion: 1,
        }),
        'forbidden',
      );
    }));

  it('separate cost centres from profit centres, and refuse the wrong one by identity', async () =>
    asTenant(TENANT_A, async () => {
      const costOnly = harnessFor(TENANT_A, [
        OrganizationPermissions.costCenterManage,
        OrganizationPermissions.profitCenterManage,
      ]);
      const profit = assertSucceeded(
        await send<{ centerId: string }>(costOnly, {
          commandName: 'organization.open-profit-center',
          code: 'PC-1',
          name: bilingual('North', 'الشمال'),
          effectiveFrom: JANUARY,
        }),
      ).centerId;

      // Reaching a profit centre through the cost-centre command must not work even for a caller
      // who happens to hold both permissions — the kind is part of what the command means.
      assertFailedWith(
        await send(costOnly, {
          commandName: 'organization.close-cost-center',
          centerId: profit,
          effectiveTo: JUNE,
          expectedVersion: 1,
        }),
        'not_found',
      );
    }));

  it('refuse every command and query to a caller holding nothing', async () =>
    asTenant(TENANT_A, async () => {
      const nobody = harnessFor(TENANT_A, []);

      assertFailedWith(await ask(nobody, { queryName: 'organization.hierarchy' }), 'forbidden');
      assertFailedWith(await ask(nobody, { queryName: 'organization.list-units' }), 'forbidden');
      assertFailedWith(
        await ask(nobody, { queryName: 'organization.export-structure' }),
        'forbidden',
      );
      assertFailedWith(
        await send(nobody, {
          commandName: 'organization.define-unit-type',
          code: 'x',
          name: bilingual('X', 'س'),
          ordinal: 1,
        }),
        'forbidden',
      );
    }));

  it('refuse before validating, so an unauthorized caller learns nothing about their payload', async () =>
    asTenant(TENANT_A, async () => {
      const nobody = harnessFor(TENANT_A, []);
      const refused = await send(nobody, {
        commandName: 'organization.define-unit-type',
        code: 'not a code',
        name: {},
        ordinal: -5,
      });

      // Every field here is invalid. The answer is still "forbidden", not "your ordinal is
      // negative": authorization runs before validation, in the pipeline and at the transport.
      expect(refused.ok === false && refused.error.kind).toBe('forbidden');
    }));
});

describe('tenant isolation, in the application layer', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it("hides another tenant's structure entirely, not merely filters it from a list", async () => {
    const stores = inMemoryOrganizationStores();
    const unitInA = await asTenant(TENANT_A, () =>
      aUnitIn(harnessWithStores(TENANT_A, stores), 'A-UNIT'),
    );

    await asTenant(TENANT_B, async () => {
      const harness = harnessWithStores(TENANT_B, stores);

      // The strongest form: a caller who already knows the primary key still gets nothing.
      assertFailedWith(
        await ask(harness, { queryName: 'organization.unit-ancestry', unitId: unitInA }),
        'not_found',
      );
      assertFailedWith(
        await ask(harness, {
          queryName: 'organization.governing-legal-entity',
          unitId: unitInA,
        }),
        'not_found',
      );
      assertFailedWith(
        await send(harness, {
          commandName: 'organization.rename-unit',
          unitId: unitInA,
          name: bilingual('Stolen', 'مسروق'),
          expectedVersion: 1,
        }),
        'not_found',
      );

      const listed = assertSucceeded(
        await ask<PagedResult<OrganizationUnitView>>(harness, {
          queryName: 'organization.list-units',
        }),
      );
      const tree = assertSucceeded(
        await ask<OrganizationTree>(harness, { queryName: 'organization.hierarchy' }),
      );

      expect(listed.items).toEqual([]);
      expect(tree.roots).toEqual([]);
      expect(tree.unplacedUnitIds).toEqual([]);
    });
  });

  it('lets each tenant use the same code for a different unit', async () => {
    const stores = inMemoryOrganizationStores();

    await asTenant(TENANT_A, () => aUnitIn(harnessWithStores(TENANT_A, stores), 'HR'));
    const inB = await asTenant(TENANT_B, () => aUnitIn(harnessWithStores(TENANT_B, stores), 'HR'));

    // Codes are the customer's own vocabulary. `HR` in one company has nothing to do with `HR`
    // in another, and a product that made them collide would be one nobody can onboard onto.
    expect(inB).toBeTruthy();
  });
});

describe('optimistic concurrency', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it('refuses the second of two conflicting renames rather than losing one silently', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const unit = await aUnitIn(harness, 'RUH');

      assertSucceeded(
        await send(harness, {
          commandName: 'organization.rename-unit',
          unitId: unit,
          name: bilingual('First', 'الأول'),
          expectedVersion: 1,
        }),
      );

      // The second administrator read version 1 too, and their write must fail rather than
      // erase the first one with nobody noticing.
      await expect(
        send(harness, {
          commandName: 'organization.rename-unit',
          unitId: unit,
          name: bilingual('Second', 'الثاني'),
          expectedVersion: 1,
        }),
      ).rejects.toThrow(/version/i);
    }));
});
