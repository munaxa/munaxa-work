import { assertSucceeded } from '@work/testing';
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
 * What happens *because* somebody left, rather than as part of leaving.
 *
 * Portals and delegations are separate aggregates, so ending a membership does not reach across
 * to mutate them — it raises an event and this module reacts to it after commit. That makes the
 * reaction's two properties worth testing on their own: it happens at all, and a redelivery does
 * not repeat it.
 */
describe('the identity module — a departure', () => {
  it('closes the portals and withdraws the cover, in reaction to the event', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const manager = await joinedMember(harness, 'sara@example.com');
      const deputy = await joinedMemberAs(harness, 'omar@example.com', 'platform-omar');

      assertSucceeded(
        await send(harness, {
          commandName: 'identity.grant-portal',
          membershipId: manager.membershipId,
          portal: 'manager',
        }),
      );
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

      assertSucceeded(
        await send(harness, {
          commandName: 'identity.change-membership',
          membershipId: manager.membershipId,
          transition: 'end',
          reason: 'resigned',
          expectedVersion: 1,
        }),
      );

      const described = assertSucceeded(
        await ask<{
          portals: readonly { status: string }[];
          delegations: readonly { status: string }[];
        }>(harness, {
          queryName: 'identity.describe-member',
          membershipId: manager.membershipId,
        }),
      );

      // Separate aggregates, so this happens in reaction to `tenant-membership.ended` rather
      // than inside `end()` — reaching across a consistency boundary is how a departure at
      // month-end deadlocks against payroll.
      expect(described.portals.every((portal) => portal.status === 'revoked')).toBe(true);
      expect(described.delegations.every((cover) => cover.status === 'revoked')).toBe(true);
    });
  });

  it('is idempotent: a redelivered event revokes nothing a second time', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);

      assertSucceeded(
        await send(harness, {
          commandName: 'identity.change-membership',
          membershipId: member.membershipId,
          transition: 'end',
          reason: 'resigned',
          expectedVersion: 1,
        }),
      );
      const afterFirst = harness.work.events.publishedNames().length;

      // The same event again, as a retry after a transient failure would deliver it.
      const ended = harness.work.events.published.find(
        (event) => event.eventName === 'identity.tenant-membership.ended',
      );

      await harness.work.events.dispatch([ended!]);

      // The redelivery raised no further revocations: each aggregate refused, having already
      // been revoked. An event handler that is not idempotent is one a retry corrupts.
      const revocations = harness.work.events
        .publishedNames()
        .filter((name) => name.endsWith('.revoked'));

      expect(harness.work.events.publishedNames().length).toBe(afterFirst + 1);
      expect(revocations).toEqual(['identity.portal-assignment.revoked']);
    });
  });
});
