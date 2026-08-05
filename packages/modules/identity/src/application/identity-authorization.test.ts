import { Dispatcher, type PagedResult } from '@work/kernel';
import { InMemoryUnitOfWork, assertFailedWith, assertSucceeded, denyAll } from '@work/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TenantMembershipView } from '../contracts/views.js';

import { identityModule } from './identity-module.js';
import { IdentityPermissions } from './identity-permissions.js';
import { inMemoryIdentityStores } from './in-memory-stores.js';
import { ConfiguredTenantSettingsForTest } from './test-settings.js';
import {
  TENANT_A,
  TENANT_B,
  ask,
  asTenant,
  clock,
  harnessFor,
  harnessWithStores,
  invite,
  joinedMember,
  joinedMemberAs,
  send,
  testClock,
  type Harness,
} from './identity-test-harness.js';

beforeEach(() => {
  testClock.reset();
});

/**
 * Permission and tenancy tests: every command refused without its permission, and every read
 * scoped to the tenant that asked.
 */

describe('the identity module — authorization and tenancy', () => {
  describe('authorization', () => {
    it('refuses every command to a caller holding nothing', async () => {
      const stores = inMemoryIdentityStores();
      const dispatcher = new Dispatcher(denyAll);
      const module = identityModule({
        unitOfWork: new InMemoryUnitOfWork(TENANT_A),
        stores,
        settings: new ConfiguredTenantSettingsForTest(),
        clock,
      });

      for (const handler of module.commands ?? []) {
        dispatcher.registerCommand(handler);
      }

      await asTenant(TENANT_A, async () => {
        for (const handler of module.commands ?? []) {
          const outcome = await dispatcher.send({ commandName: handler.commandName });

          assertFailedWith(outcome, 'forbidden');
        }
      });
    });

    it('refuses before validating, so an unauthorized caller learns nothing about the payload', async () => {
      const harness = harnessFor(TENANT_A, []);

      await asTenant(TENANT_A, async () => {
        // A payload that would certainly fail validation, from a caller holding nothing.
        const outcome = await send(harness, {
          commandName: 'identity.invite-member',
          email: 'definitely not an address',
        });

        assertFailedWith(outcome, 'forbidden');
      });
    });

    it('grants each command only to the permission it declares', async () => {
      const harness = harnessFor(TENANT_A, [IdentityPermissions.invitationManage]);

      await asTenant(TENANT_A, async () => {
        assertSucceeded(await invite(harness));

        // Same caller, a command guarded by a different permission.
        assertFailedWith(
          await send(harness, {
            commandName: 'identity.admit-member',
            platformUserId: 'platform-omar',
          }),
          'forbidden',
        );
      });
    });
  });

  describe('tenancy', () => {
    it('refuses any operation that runs without a tenant context', async () => {
      const harness = harnessFor(TENANT_A);

      await expect(invite(harness)).rejects.toThrow(/without a tenant context/);
    });

    it('shows a tenant only its own memberships', async () => {
      const shared = inMemoryIdentityStores();
      const inA = harnessWithStores(TENANT_A, shared);
      const inB = harnessWithStores(TENANT_B, shared);

      await asTenant(TENANT_A, async () => joinedMember(inA, 'sara@example.com'));
      await asTenant(TENANT_B, async () =>
        joinedMemberAs(inB, 'omar@example.com', 'platform-omar'),
      );

      const listFor = async (
        tenantId: string,
        harness: Harness,
      ): Promise<PagedResult<TenantMembershipView>> =>
        asTenant(tenantId, async () =>
          assertSucceeded(
            await ask<PagedResult<TenantMembershipView>>(harness, {
              queryName: 'identity.list-memberships',
              page: 1,
              pageSize: 50,
            }),
          ),
        );

      expect((await listFor(TENANT_A, inA)).total).toBe(1);
      expect((await listFor(TENANT_B, inB)).total).toBe(1);
      expect((await listFor(TENANT_A, inA)).items[0]?.tenantId).toBe(TENANT_A);
    });

    it('cannot reach another tenant’s membership by its exact identifier', async () => {
      const shared = inMemoryIdentityStores();
      const inA = harnessWithStores(TENANT_A, shared);
      const inB = harnessWithStores(TENANT_B, shared);

      const member = await asTenant(TENANT_A, async () => joinedMember(inA));

      const outcome = await asTenant(TENANT_B, async () =>
        ask(inB, {
          queryName: 'identity.describe-member',
          membershipId: member.membershipId,
        }),
      );

      assertFailedWith(outcome, 'not_found');
    });
  });
});
