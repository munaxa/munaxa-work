import { ModuleRegistry, uuidV7 } from '@work/kernel';
import { InMemoryUnitOfWork, assertFailedWith, assertSucceeded } from '@work/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { identityModule } from './identity-module.js';
import { inMemoryIdentityStores } from './in-memory-stores.js';
import { ConfiguredTenantSettingsForTest } from './test-settings.js';
import {
  ALL,
  TENANT_A,
  TENANT_B,
  accept,
  ask,
  asTenant,
  clock,
  harnessFor,
  harnessWithStores,
  invite,
  joinedMember,
  testClock,
} from './identity-test-harness.js';

beforeEach(() => {
  testClock.reset();
});

/**
 * Application-service tests for the two use cases the phase exists to connect: a tenant asking
 * somebody to join, and an authenticated Platform user becoming a member.
 */

describe('the identity module — inviting and accepting', () => {
  describe('registration', () => {
    it('declares every permission it owns, so none is invisible in administration', () => {
      const registry = new ModuleRegistry();

      registry.register(
        identityModule({
          unitOfWork: new InMemoryUnitOfWork(TENANT_A),
          stores: inMemoryIdentityStores(),
          settings: new ConfiguredTenantSettingsForTest(),
          clock,
        }),
      );

      expect(registry.describe().permissions).toEqual([...ALL].sort());
    });

    it('offers navigation guarded by a permission it declares', () => {
      const registry = new ModuleRegistry();

      registry.register(
        identityModule({
          unitOfWork: new InMemoryUnitOfWork(TENANT_A),
          stores: inMemoryIdentityStores(),
          settings: new ConfiguredTenantSettingsForTest(),
          clock,
        }),
      );
      const described = registry.describe();

      for (const entry of described.navigation) {
        expect(described.permissions).toContain(entry.permission);
      }
    });
  });

  describe('inviting and accepting', () => {
    it('issues an invitation that lapses after the configured period', async () => {
      const harness = harnessFor(TENANT_A);

      const issued = await asTenant(TENANT_A, async () => assertSucceeded(await invite(harness)));

      // 14 days is configuration, not a constant in the module.
      expect(issued.expiresAt.getTime() - testClock.value.getTime()).toBe(14 * 86_400_000);
    });

    it('refuses a second open invitation to the same address', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        assertSucceeded(await invite(harness));
        assertFailedWith(await invite(harness, 'SARA@example.com'), 'rejected');
      });
    });

    it('creates the workforce user, the membership, the portals and the preferences at once', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);

        const described = assertSucceeded(
          await ask<{
            portals: readonly unknown[];
            preferences?: { language: string };
          }>(harness, { queryName: 'identity.describe-member', membershipId: member.membershipId }),
        );

        expect(described.portals).toHaveLength(1);
        expect(described.preferences?.language).toBe('ar');
      });
    });

    it('reuses the workforce user when the same person joins a second tenant (AD-005)', async () => {
      const first = harnessFor(TENANT_A);
      // A second tenant, sharing the store so the same person exists in both.
      const sharedSecond = harnessWithStores(TENANT_B, first.stores);

      const inA = await asTenant(TENANT_A, async () => joinedMember(first));
      const inB = await asTenant(TENANT_B, async () => joinedMember(sharedSecond));

      expect(inB.workforceUserId).toBe(inA.workforceUserId);
      // Two memberships, one person. Their delegations and audit history stay in one place.
      expect(inB.membershipId).not.toBe(inA.membershipId);
    });

    it('refuses an acceptance from an address the invitation was not sent to', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const issued = assertSucceeded(await invite(harness));

        assertFailedWith(
          await accept(harness, issued.invitationId, 'omar@example.com'),
          'rejected',
        );
      });
    });

    it('refuses an acceptance after the invitation has lapsed', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const issued = assertSucceeded(await invite(harness));

        testClock.value = new Date('2026-09-05T10:00:00Z');

        assertFailedWith(await accept(harness, issued.invitationId), 'rejected');
      });
    });

    it('answers not found for an invitation that does not exist', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        assertFailedWith(await accept(harness, uuidV7()), 'not_found');
      });
    });
  });
});
