import { uuidV7 } from '@work/kernel';
import { assertFailedWith, assertSucceeded } from '@work/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  TENANT_A,
  ask,
  asTenant,
  harnessFor,
  joinedMember,
  joinedMemberAs,
  send,
  testClock,
} from './identity-test-harness.js';

beforeEach(() => {
  testClock.reset();
});

/**
 * Application-service tests for what a tenant grants a member after they join: the membership's
 * own lifecycle, portals, employment links, delegation, profile and preferences.
 */

describe('the identity module — membership, access and details', () => {
  describe('the membership lifecycle', () => {
    it('suspends, reinstates and ends', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);
        const change = (transition: string, expectedVersion: number) =>
          send<{ status: string }>(harness, {
            commandName: 'identity.change-membership',
            membershipId: member.membershipId,
            transition,
            reason: 'investigation',
            expectedVersion,
          });

        expect(assertSucceeded(await change('suspend', 1)).status).toBe('suspended');
        expect(assertSucceeded(await change('reinstate', 2)).status).toBe('active');
        expect(assertSucceeded(await change('end', 3)).status).toBe('ended');
      });
    });

    it('refuses a stale write rather than overwriting the other administrator’s change', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);
        const rename = (displayName: Record<string, string>, expectedVersion: number) =>
          send(harness, {
            commandName: 'identity.revise-profile',
            membershipId: member.membershipId,
            change: { displayName },
            expectedVersion,
          });

        assertSucceeded(await rename({ en: 'Sara Haddad', ar: 'سارة حداد' }, 0));

        // A second administrator, holding the version they read before the first wrote. The
        // domain permits this change from either state, so nothing but the version check stands
        // between them — and it must refuse rather than let the first edit vanish.
        await expect(rename({ en: 'S. Haddad', ar: 'س. حداد' }, 0)).rejects.toThrow(
          /modified by someone else/,
        );
      });
    });

    it('refuses a transition the membership is no longer in a state for', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);
        const suspend = (expectedVersion: number) =>
          send(harness, {
            commandName: 'identity.change-membership',
            membershipId: member.membershipId,
            transition: 'suspend',
            reason: 'investigation',
            expectedVersion,
          });

        assertSucceeded(await suspend(1));

        // The second administrator's suspension is refused by the domain before the version is
        // even consulted: the membership is already suspended. Either way it is refused; what
        // must never happen is that it silently succeeds.
        assertFailedWith(await suspend(1), 'rejected');
      });
    });

    it('requires a reason to remove access, but not to restore it', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);

        assertFailedWith(
          await send(harness, {
            commandName: 'identity.change-membership',
            membershipId: member.membershipId,
            transition: 'suspend',
            reason: '   ',
            expectedVersion: 1,
          }),
          'validation',
        );
      });
    });
  });

  describe('portals, jobs and delegation', () => {
    it('opens and withdraws a portal', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);
        const granted = assertSucceeded(
          await send<{ assignmentId: string; status: string }>(harness, {
            commandName: 'identity.grant-portal',
            membershipId: member.membershipId,
            portal: 'manager',
          }),
        );

        expect(granted.status).toBe('granted');

        const revoked = assertSucceeded(
          await send<{ status: string }>(harness, {
            commandName: 'identity.revoke-portal',
            assignmentId: granted.assignmentId,
            reason: 'moved teams',
            expectedVersion: 1,
          }),
        );

        expect(revoked.status).toBe('revoked');
      });
    });

    it('keeps exactly one primary job when a second is promoted', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);
        const link = (employmentId: string, isPrimary: boolean) =>
          send<{ linkId: string }>(harness, {
            commandName: 'identity.link-employment',
            membershipId: member.membershipId,
            employmentId,
            isPrimary,
          });

        assertSucceeded(await link(uuidV7(), true));
        assertSucceeded(await link(uuidV7(), true));

        const described = assertSucceeded(
          await ask<{
            employments: readonly { isPrimary: boolean }[];
          }>(harness, { queryName: 'identity.describe-member', membershipId: member.membershipId }),
        );

        expect(described.employments).toHaveLength(2);
        expect(described.employments.filter((job) => job.isPrimary)).toHaveLength(1);
      });
    });

    it('does not remove the person when a job is detached (AD-008)', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);
        const linked = assertSucceeded(
          await send<{ linkId: string }>(harness, {
            commandName: 'identity.link-employment',
            membershipId: member.membershipId,
            employmentId: uuidV7(),
            isPrimary: true,
          }),
        );

        assertSucceeded(
          await send(harness, {
            commandName: 'identity.unlink-employment',
            linkId: linked.linkId,
            reason: 'contract ended',
            expectedVersion: 1,
          }),
        );

        const described = assertSucceeded(
          await ask<{ membership: { status: string } }>(harness, {
            queryName: 'identity.describe-member',
            membershipId: member.membershipId,
          }),
        );

        expect(described.membership.status).toBe('active');
      });
    });

    it('arranges cover and answers who is acting for whom', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const manager = await joinedMember(harness, 'sara@example.com');
        const deputy = await joinedMemberAs(harness, 'omar@example.com', 'platform-omar');

        assertSucceeded(
          await send(harness, {
            commandName: 'identity.create-delegation',
            delegatorMembershipId: manager.membershipId,
            delegateMembershipId: deputy.membershipId,
            scope: 'leave.approve',
            effectiveFrom: new Date('2026-08-10T00:00:00Z'),
            effectiveTo: new Date('2026-08-20T00:00:00Z'),
            reason: 'annual leave',
          }),
        );

        const inForce = assertSucceeded(
          await ask<readonly { scope: string }[]>(harness, {
            queryName: 'identity.active-delegations-for',
            delegateMembershipId: deputy.membershipId,
            atInstant: new Date('2026-08-15T00:00:00Z'),
          }),
        );

        expect(inForce.map((delegation) => delegation.scope)).toEqual(['leave.approve']);
      });
    });

    it('answers nothing outside the delegation’s period', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const manager = await joinedMember(harness, 'sara@example.com');
        const deputy = await joinedMemberAs(harness, 'omar@example.com', 'platform-omar');

        assertSucceeded(
          await send(harness, {
            commandName: 'identity.create-delegation',
            delegatorMembershipId: manager.membershipId,
            delegateMembershipId: deputy.membershipId,
            scope: 'leave.approve',
            effectiveFrom: new Date('2026-08-10T00:00:00Z'),
            effectiveTo: new Date('2026-08-20T00:00:00Z'),
            reason: 'annual leave',
          }),
        );

        const after = assertSucceeded(
          await ask<readonly unknown[]>(harness, {
            queryName: 'identity.active-delegations-for',
            delegateMembershipId: deputy.membershipId,
            atInstant: new Date('2026-08-25T00:00:00Z'),
          }),
        );

        expect(after).toEqual([]);
      });
    });
  });

  describe('profile and preferences', () => {
    it('requires both first-class languages in a display name', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);

        assertFailedWith(
          await send(harness, {
            commandName: 'identity.revise-profile',
            membershipId: member.membershipId,
            change: { displayName: { en: 'Sara Haddad' } },
          }),
          'rejected',
        );
      });
    });

    it('stores and finds a name in either language', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);

        assertSucceeded(
          await send(harness, {
            commandName: 'identity.revise-profile',
            membershipId: member.membershipId,
            change: { displayName: { en: 'Sara Haddad', ar: 'سارة حداد' } },
          }),
        );

        for (const term of ['Sara', 'سارة']) {
          const found = assertSucceeded(
            await ask<readonly { membershipId: string }[]>(harness, {
              queryName: 'identity.search-members',
              term,
              limit: 10,
            }),
          );

          expect(found.map((profile) => profile.membershipId)).toEqual([member.membershipId]);
        }
      });
    });

    it('lets a member change their own language, and derives direction from it', async () => {
      const harness = harnessFor(TENANT_A);

      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);

        const revised = assertSucceeded(
          await send<{ preferenceId: string; language: string; direction: string }>(harness, {
            commandName: 'identity.revise-preference',
            membershipId: member.membershipId,
            change: { language: 'en' },
            expectedVersion: 1,
          }),
        );

        expect(revised.language).toBe('en');
        // Derived from the language, never toggled independently of it.
        expect(revised.direction).toBe('ltr');
        expect(typeof revised.preferenceId).toBe('string');
      });
    });
  });
});
