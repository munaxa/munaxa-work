import { beforeEach, describe, expect, it } from 'vitest';
import { assertFailedWith, assertSucceeded } from '@work/testing';

import type { TenantSettingsView } from '../contracts/views.js';

import {
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
import { OrganizationPermissions } from './organization-permissions.js';

/**
 * Tenant settings — the Phase 2 debt, closed.
 *
 * The Phase 2 report recorded it plainly: *"Every tenant in a deployment shares one default
 * language, calendar, time zone and invitation validity."* The property that closes it is the
 * one asserted here first, and it is asserted across **two tenants sharing one store**, because
 * a suite with one tenant in it would pass just as happily for the deployment-wide
 * implementation this replaces.
 */

const riyadh = {
  language: 'ar',
  calendar: 'hijri',
  timeZone: 'Asia/Riyadh',
  numerals: 'arabic-indic',
  invitationValidityDays: 14,
  defaultPortals: ['employee'],
};

const amman = {
  language: 'en',
  calendar: 'gregorian',
  timeZone: 'Asia/Amman',
  numerals: 'western',
  invitationValidityDays: 30,
  defaultPortals: ['employee', 'manager'],
};

const configure = (harness: Harness, settings: Record<string, unknown>): ReturnType<typeof send> =>
  send(harness, { commandName: 'organization.configure-tenant-settings', ...settings });

const read = async (harness: Harness): Promise<TenantSettingsView | undefined> =>
  assertSucceeded(
    await ask<TenantSettingsView | undefined>(harness, {
      queryName: 'organization.tenant-settings',
    }),
  );

describe('a tenant configuring its own defaults', () => {
  beforeEach(() => {
    testClock.reset();
  });

  it('gives a second tenant its own, in the same deployment and the same store', async () => {
    // One store, shared, exactly as one database is. If settings were still deployment-wide,
    // the second read here would return the first tenant's.
    const stores = inMemoryOrganizationStores();

    await asTenant(TENANT_A, async () => {
      assertSucceeded(await configure(harnessWithStores(TENANT_A, stores), riyadh));
    });
    await asTenant(TENANT_B, async () => {
      assertSucceeded(await configure(harnessWithStores(TENANT_B, stores), amman));
    });

    const forA = await asTenant(TENANT_A, () => read(harnessWithStores(TENANT_A, stores)));
    const forB = await asTenant(TENANT_B, () => read(harnessWithStores(TENANT_B, stores)));

    expect(forA).toMatchObject({
      language: 'ar',
      calendar: 'hijri',
      timeZone: 'Asia/Riyadh',
      numerals: 'arabic-indic',
      invitationValidityDays: 14,
    });
    expect(forB).toMatchObject({
      language: 'en',
      calendar: 'gregorian',
      timeZone: 'Asia/Amman',
      numerals: 'western',
      invitationValidityDays: 30,
    });
    expect(forA?.defaultPortals).toEqual(['employee']);
    expect(forB?.defaultPortals).toEqual(['employee', 'manager']);
  });

  it('reads nothing at all for a tenant that has configured nothing', async () =>
    asTenant(TENANT_A, async () => {
      // Not the deployment defaults. A tenant that has never been configured must be
      // distinguishable from one configured identically by hand, or an administration screen
      // cannot tell the customer which they are looking at.
      expect(await read(harnessFor(TENANT_A))).toBeUndefined();
    }));

  it('replaces the whole set on a second submission, which is what a settings screen sends', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      assertSucceeded(await configure(harness, riyadh));
      const first = await read(harness);

      assertSucceeded(await configure(harness, { ...amman, expectedVersion: first?.version }));

      expect(await read(harness)).toMatchObject({ language: 'en', timeZone: 'Asia/Amman' });
    }));

  it('refuses a stale write rather than overwriting somebody else`s change', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      assertSucceeded(await configure(harness, riyadh));
      const read1 = await read(harness);

      assertSucceeded(await configure(harness, { ...amman, expectedVersion: read1?.version }));

      // Two administrators with the settings screen open. The second must not silently win.
      await expect(
        configure(harness, { ...riyadh, expectedVersion: read1?.version }),
      ).rejects.toThrow(/version/i);
    }));

  it('refuses a calendar, numeral system or time zone the product cannot render', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      assertFailedWith(await configure(harness, { ...riyadh, calendar: 'julian' }), 'rejected');
      assertFailedWith(await configure(harness, { ...riyadh, numerals: 'roman' }), 'rejected');
      assertFailedWith(
        await configure(harness, { ...riyadh, timeZone: 'Asia/Nowhere' }),
        'rejected',
      );
    }));

  it('accepts a language it has never heard of, because the list of languages is not ours', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      // Arabic and English are first-class in the *catalogues*. The tenant default is a BCP 47
      // tag, and refusing an unlisted one would make adding a third language a code change.
      assertSucceeded(await configure(harness, { ...riyadh, language: 'ur' }));
      expect((await read(harness))?.language).toBe('ur');
    }));

  it('refuses an invitation validity outside a period anybody would choose', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      assertFailedWith(
        await configure(harness, { ...riyadh, invitationValidityDays: 0 }),
        'rejected',
      );
      assertFailedWith(
        await configure(harness, { ...riyadh, invitationValidityDays: 5000 }),
        'rejected',
      );
    }));

  it('is guarded: reading and writing settings are different permissions', async () =>
    asTenant(TENANT_A, async () => {
      const readOnly = harnessFor(TENANT_A, [OrganizationPermissions.tenantSettingsRead]);

      assertFailedWith(await configure(readOnly, riyadh), 'forbidden');
      assertSucceeded(await ask(readOnly, { queryName: 'organization.tenant-settings' }));

      const noneAtAll = harnessFor(TENANT_A, []);

      assertFailedWith(
        await ask(noneAtAll, { queryName: 'organization.tenant-settings' }),
        'forbidden',
      );
    }));
});
