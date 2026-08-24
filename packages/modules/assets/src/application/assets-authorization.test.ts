import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  STOREKEEPER,
  attempt,
  givenAsset,
  givenAvailableAsset,
  givenCategory,
  givenCustody,
  harnessFor,
  tryAsk,
} from './assets-test-harness.js';
import { ALL_ASSETS_PERMISSIONS, AssetsPermissions } from './assets-permissions.js';
import type { UnitOfWork } from '@work/kernel';

import { assetsModule } from './assets-module.js';
import { inMemoryAssetsStores } from './in-memory-stores.js';

/**
 * Who may do what — and, more importantly, who may not.
 *
 * Every command and every query in this module declares a permission, and this suite proves that the
 * declaration is enforced rather than documented: a caller holding everything *except* the one grant
 * an operation needs is refused, and a caller holding another module's grant is refused too.
 */

const NEVER_EXECUTED: UnitOfWork = {
  // Typed rather than asserted: `UnitOfWork` has exactly one method, so a real implementation costs a
  // line and an `as never` would hide the day it grows a second.
  execute: () => Promise.reject(new Error('the module under test must not reach the database')),
};

const moduleUnderTest = () =>
  assetsModule({
    unitOfWork: NEVER_EXECUTED,
    stores: inMemoryAssetsStores(),
    employments: { exists: () => Promise.resolve(true) },
    clock: { now: () => new Date('2026-08-23T09:00:00Z') },
  });

const withoutPermission = (withheld: string): readonly string[] =>
  ALL_ASSETS_PERMISSIONS.filter((permission) => permission !== withheld);

describe('the permission set', () => {
  it('is exactly seven, per resource per capability', () => {
    expect([...ALL_ASSETS_PERMISSIONS].sort()).toEqual([
      'assets.asset.manage',
      'assets.asset.read',
      'assets.category.manage',
      'assets.category.read',
      'assets.custody.assign',
      'assets.custody.read',
      'assets.custody.return',
    ]);
  });

  /**
   * The permissions that do not exist, asserted by name.
   *
   * A permission naming an absent capability is a grant somebody can hold over nothing, and the day
   * it starts meaning something they hold it already (D-5.2-04). Custody, acknowledgement, incidents,
   * waivers and deductions are all later checkpoints, and none of them has a grant waiting.
   */
  it('contains no wildcard, no administrator grant and nothing for an unbuilt capability', () => {
    for (const absent of [
      'assets.admin',
      'assets.manage',
      'assets.write-all',
      'assets.*',
      '*',
      'assets.custody.manage',
      'assets.custody.admin',
      'assets.custody.read-own',
      'assets.custody.transfer',
      'assets.acknowledge',
      'assets.incident.record',
      'assets.incident.assess',
      'assets.waiver.approve',
      'assets.deduction.authorize',
      'assets.read-own',
    ]) {
      expect(ALL_ASSETS_PERMISSIONS).not.toContain(absent);
    }
  });

  it('declares every permission a handler enforces, and enforces every permission it declares', () => {
    const module = moduleUnderTest();
    const enforced = new Set([
      ...(module.commands ?? []).map((handler) => handler.permission),
      ...(module.queries ?? []).map((handler) => handler.permission),
    ]);

    expect([...enforced].sort()).toEqual([...ALL_ASSETS_PERMISSIONS].sort());
    expect(module.permissions).toEqual(ALL_ASSETS_PERMISSIONS);
  });

  it('gives every handler a permission — none is optional and none is absent', () => {
    const module = moduleUnderTest();

    for (const handler of [...(module.commands ?? []), ...(module.queries ?? [])]) {
      expect(handler.permission).toBeTruthy();
      expect(handler.permission.startsWith('assets.')).toBe(true);
    }
  });

  /**
   * The navigation entry rides on the inventory grant, not the catalogue one.
   *
   * The screen it points at is the inventory; somebody who may only maintain the list of categories
   * has no business finding a link to every item the company owns.
   */
  it('puts the navigation entry behind the inventory read', () => {
    const module = moduleUnderTest();

    expect(module.navigation?.[0]?.permission).toBe(AssetsPermissions.assetRead);
  });
});

describe('a caller without the grant an operation needs', () => {
  it('cannot define or amend a category with only the catalogue read', async () => {
    const harness = harnessFor({
      permissions: withoutPermission(AssetsPermissions.categoryManage),
    });
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'assets.define-category',
        code: 'laptop',
        name: { en: 'Laptop', ar: 'حاسوب' },
        sequence: 10,
      }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({
      kind: 'forbidden',
      permission: AssetsPermissions.categoryManage,
    });
  });

  it('cannot list the catalogue without the catalogue read', async () => {
    const harness = harnessFor({ permissions: withoutPermission(AssetsPermissions.categoryRead) });
    const refused = await harness.as(STOREKEEPER, () =>
      tryAsk(harness, { queryName: 'assets.categories' }),
    );

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatchObject({ kind: 'forbidden' });
  });

  it('cannot register, amend or move an item without the inventory manage grant', async () => {
    const full = harnessFor();
    const assetCategoryId = await givenCategory(full);
    const assetId = await givenAsset(full, { assetCategoryId });
    const harness = harnessFor({ permissions: withoutPermission(AssetsPermissions.assetManage) });

    for (const command of [
      { commandName: 'assets.register-asset', assetCategoryId, assetTag: 'IT-9' },
      { commandName: 'assets.amend-asset', assetId, expectedVersion: 1, description: 'x' },
      {
        commandName: 'assets.change-asset-status',
        assetId,
        expectedVersion: 1,
        status: 'available',
      },
    ]) {
      const refused = await harness.as(STOREKEEPER, () => attempt(harness, command));

      expect(refused.ok).toBe(false);
      if (refused.ok) continue;
      expect(refused.error).toMatchObject({
        kind: 'forbidden',
        permission: AssetsPermissions.assetManage,
      });
    }
  });

  /**
   * **Issuing and returning are different authorities, and neither implies the other.**
   *
   * A false return is the more dangerous direction: it makes an outstanding asset disappear from the
   * register offboarding clearance will read. This is the assertion that keeps that separation real
   * rather than decorative.
   */
  it('does not let the assign grant record a return, or the reverse', async () => {
    const full = harnessFor();
    const { assetId, assetCustodyId } = await givenCustody(full);
    const assignOnly = harnessFor({
      permissions: withoutPermission(AssetsPermissions.custodyReturn),
    });
    const returnOnly = harnessFor({
      permissions: withoutPermission(AssetsPermissions.custodyAssign),
    });

    const returning = await assignOnly.as(STOREKEEPER, () =>
      attempt(assignOnly, {
        commandName: 'assets.return-custody',
        assetCustodyId,
        expectedVersion: 1,
        returnedOn: '2026-08-22',
      }),
    );
    const issuing = await returnOnly.as(STOREKEEPER, () =>
      attempt(returnOnly, {
        commandName: 'assets.issue-custody',
        assetId,
        employmentId: '01940000-0000-7000-8000-0000000000aa',
        issuedOn: '2026-08-22',
      }),
    );

    expect(returning.ok).toBe(false);
    expect(issuing.ok).toBe(false);
    if (returning.ok || issuing.ok) return;
    expect(returning.error).toMatchObject({
      kind: 'forbidden',
      permission: AssetsPermissions.custodyReturn,
    });
    expect(issuing.error).toMatchObject({
      kind: 'forbidden',
      permission: AssetsPermissions.custodyAssign,
    });
  });

  /**
   * Managing the inventory does not reach custody, in either direction.
   *
   * This is why `assets.asset.manage` was not reused: maintaining a register of things and creating an
   * obligation for a named person are different authorities.
   */
  it('does not let an inventory grant issue custody, or a custody grant amend an asset', async () => {
    const full = harnessFor();
    const assetId = await givenAvailableAsset(full);
    const inventoryOnly = harnessFor({
      permissions: [AssetsPermissions.assetRead, AssetsPermissions.assetManage],
    });
    const custodyOnly = harnessFor({
      permissions: [
        AssetsPermissions.custodyRead,
        AssetsPermissions.custodyAssign,
        AssetsPermissions.custodyReturn,
      ],
    });

    const issuing = await inventoryOnly.as(STOREKEEPER, () =>
      attempt(inventoryOnly, {
        commandName: 'assets.issue-custody',
        assetId,
        employmentId: '01940000-0000-7000-8000-0000000000aa',
        issuedOn: '2026-08-22',
      }),
    );
    const amending = await custodyOnly.as(STOREKEEPER, () =>
      attempt(custodyOnly, {
        commandName: 'assets.amend-asset',
        assetId,
        expectedVersion: 1,
        description: 'x',
      }),
    );

    expect(issuing.ok).toBe(false);
    expect(amending.ok).toBe(false);
  });

  /**
   * Reading the inventory does not imply reading who holds what.
   *
   * A custody row names an employment; an asset row does not. Separating the grants is what keeps an
   * asset register from being a directory of who has what.
   */
  it('does not let the inventory read reach custody', async () => {
    const harness = harnessFor({ permissions: withoutPermission(AssetsPermissions.custodyRead) });

    for (const query of [
      { queryName: 'assets.asset-custody', assetId: '01940000-0000-7000-8000-0000000000ff' },
      {
        queryName: 'assets.employment-custody',
        employmentId: '01940000-0000-7000-8000-0000000000aa',
      },
    ]) {
      const refused = await harness.as(STOREKEEPER, () => tryAsk(harness, query));

      expect(refused.ok).toBe(false);
      if (refused.ok) continue;
      expect(refused.error).toMatchObject({
        kind: 'forbidden',
        permission: AssetsPermissions.custodyRead,
      });
    }
  });

  it('cannot read or search the inventory without the inventory read grant', async () => {
    const harness = harnessFor({ permissions: withoutPermission(AssetsPermissions.assetRead) });

    for (const query of [
      { queryName: 'assets.read-asset', assetId: '01940000-0000-7000-8000-0000000000ff' },
      { queryName: 'assets.search-assets' },
    ]) {
      const refused = await harness.as(STOREKEEPER, () => tryAsk(harness, query));

      expect(refused.ok).toBe(false);
      if (refused.ok) continue;
      expect(refused.error).toMatchObject({
        kind: 'forbidden',
        permission: AssetsPermissions.assetRead,
      });
    }
  });

  /**
   * Managing the catalogue does not imply managing the inventory, in either direction.
   *
   * That is the whole reason there are four permissions instead of one: a person who maintains the
   * list of asset types is not necessarily a person who may register or retire company property.
   */
  it('does not let a catalogue grant reach the inventory, or the reverse', async () => {
    const full = harnessFor();
    const assetCategoryId = await givenCategory(full);
    const catalogueOnly = harnessFor({
      permissions: [AssetsPermissions.categoryRead, AssetsPermissions.categoryManage],
    });
    const inventoryOnly = harnessFor({
      permissions: [AssetsPermissions.assetRead, AssetsPermissions.assetManage],
    });

    const reachingInventory = await catalogueOnly.as(ADMINISTRATOR, () =>
      attempt(catalogueOnly, {
        commandName: 'assets.register-asset',
        assetCategoryId,
        assetTag: 'IT-9',
      }),
    );
    const reachingCatalogue = await inventoryOnly.as(STOREKEEPER, () =>
      tryAsk(inventoryOnly, { queryName: 'assets.categories' }),
    );

    expect(reachingInventory.ok).toBe(false);
    expect(reachingCatalogue.ok).toBe(false);
  });

  /**
   * Another module's grant opens nothing here.
   *
   * Seeing an employment, reading a document or approving a payroll run must not imply an inventory
   * of everything the company owns and where it is kept.
   */
  it('is not admitted by any other module’s permission', async () => {
    const harness = harnessFor({
      permissions: [
        'employment.read',
        'document.read',
        'payroll.approve',
        'relations.violation.read',
        'workflow.approval.read-own',
        'identity.membership.read',
      ],
    });

    for (const query of [
      { queryName: 'assets.categories' },
      { queryName: 'assets.search-assets' },
    ]) {
      const refused = await harness.as(STOREKEEPER, () => tryAsk(harness, query));

      expect(refused.ok).toBe(false);
    }
  });

  /**
   * A caller holding nothing meets `forbidden`, and a caller holding everything meets `not_found`
   * for an identifier that is not theirs.
   *
   * Those two are different answers on purpose: the first is about the caller, the second about the
   * data, and the second is what stops an identifier being used as a probe.
   */
  it('separates “you may not” from “there is no such thing”', async () => {
    const unauthorized = harnessFor({ permissions: [] });
    const authorized = harnessFor();
    const missing = '01940000-0000-7000-8000-0000000000ff';

    const first = await unauthorized.as(STOREKEEPER, () =>
      tryAsk(unauthorized, { queryName: 'assets.read-asset', assetId: missing }),
    );
    const second = await authorized.as(STOREKEEPER, () =>
      tryAsk(authorized, { queryName: 'assets.read-asset', assetId: missing }),
    );

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    if (first.ok || second.ok) return;
    expect(first.error.kind).toBe('forbidden');
    expect(second.error.kind).toBe('not_found');
  });
});
