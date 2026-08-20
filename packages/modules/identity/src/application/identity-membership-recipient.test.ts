import { Dispatcher, type HandlerFailure, type Result } from '@work/kernel';
import { InMemoryUnitOfWork, assertFailedWith, assertSucceeded, permitting } from '@work/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { MembershipRecipientView } from '../contracts/views.js';

import {
  ALL,
  TENANT_A,
  TENANT_B,
  asTenant,
  ask,
  clock,
  harnessFor,
  harnessWithStores,
  joinedMember,
  send,
  type Harness,
} from './identity-test-harness.js';
import { identityModule } from './identity-module.js';
import { IdentityPermissions } from './identity-permissions.js';
import { ConfiguredTenantSettingsForTest } from './test-settings.js';

/**
 * `identity.membership-recipient` — one membership, one workforce user, nothing else.
 *
 * **The payload assertions are the point.** This query exists because three published queries already
 * return `workforceUserId` and not one could be used: two are lists and the third answers a member's
 * whole page. A query that quietly grew a second field would put the module back where it started, so
 * the reply is asserted by its **exact keys** rather than by reading the one that should be there.
 *
 * **It answers who, never whether.** Eligibility is `identity.membership-standing`; folding the two
 * would make a caller that wanted an address take a position on whether somebody may act.
 */

const recipient = (
  harness: Harness,
  membershipId: string,
): Promise<Result<MembershipRecipientView, HandlerFailure>> =>
  ask<MembershipRecipientView>(harness, {
    queryName: 'identity.membership-recipient',
    membershipId,
  });

/** A dispatcher over an existing store, holding only the permissions named. */
const restrictedOver = (harness: Harness, granted: readonly string[]): Harness => {
  const work = new InMemoryUnitOfWork(TENANT_A);
  const dispatcher = new Dispatcher(permitting(...granted));
  const module = identityModule({
    unitOfWork: work,
    stores: harness.stores,
    settings: new ConfiguredTenantSettingsForTest(),
    clock,
  });

  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return { stores: harness.stores, work, dispatcher };
};

const ABSENT = '01930000-0000-7000-8000-0000000000ff';

/**
 * A second, genuinely different member.
 *
 * The shared `joinedMember` helper hardcodes one `platformUserId`, so calling it twice resolves to
 * one workforce user and the second accept is refused as a rejoin. A test about *which* membership
 * was asked for needs two distinct people, so this spells the pair out.
 */
const anotherMember = async (
  harness: Harness,
  email: string,
  platformUserId: string,
): Promise<{ membershipId: string; workforceUserId: string }> => {
  const invitation = assertSucceeded(
    await send<{ invitationId: string }>(harness, {
      commandName: 'identity.invite-member',
      email,
    }),
  );

  return assertSucceeded(
    await send<{ membershipId: string; workforceUserId: string }>(harness, {
      commandName: 'identity.accept-invitation',
      invitationId: invitation.invitationId,
      platformUserId,
      principalEmail: email,
    }),
  );
};

describe('which workforce user a membership belongs to', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor(TENANT_A);
  });

  it('answers the workforce user the membership was created for', async () => {
    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);

      expect(assertSucceeded(await recipient(harness, member.membershipId))).toStrictEqual({
        workforceUserId: member.workforceUserId,
      });
    });
  });

  /**
   * The answer is about *this* membership, which a single-member test cannot show.
   *
   * With two members in one tenant, a handler that returned the first row it found — or the caller's
   * own — would pass a one-member suite and fail here.
   */
  it('answers about the membership asked for, not some other member', async () => {
    await asTenant(TENANT_A, async () => {
      const sara = await joinedMember(harness);
      const omar = await anotherMember(harness, 'omar@example.com', 'platform-omar');

      expect(sara.workforceUserId).not.toBe(omar.workforceUserId);
      expect(assertSucceeded(await recipient(harness, omar.membershipId))).toStrictEqual({
        workforceUserId: omar.workforceUserId,
      });
      expect(assertSucceeded(await recipient(harness, sara.membershipId))).toStrictEqual({
        workforceUserId: sara.workforceUserId,
      });
    });
  });

  /**
   * A recipient is still a recipient when they may no longer act.
   *
   * Deliberate, and the opposite of what a reader might assume: this query answers *who*, and
   * `identity.membership-standing` answers *whether*. A handler that refused a suspended member here
   * would be deciding eligibility in the addressing query, which is the coupling the two-query split
   * exists to prevent.
   */
  it('still answers for a membership that may no longer act', async () => {
    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);

      assertSucceeded(
        await harness.dispatcher.send({
          commandName: 'identity.change-membership',
          membershipId: member.membershipId,
          transition: 'suspend',
          expectedVersion: 1,
          reason: 'For the test',
        }),
      );

      expect(assertSucceeded(await recipient(harness, member.membershipId))).toStrictEqual({
        workforceUserId: member.workforceUserId,
      });
    });
  });

  /** An identifier naming nobody is `not_found` — never an empty string and never a guess. */
  it('refuses an identifier that names no membership', async () => {
    await asTenant(TENANT_A, async () => {
      assertFailedWith(await recipient(harness, ABSENT), 'not_found');
    });
  });

  /** The same state answers the same twice: no clock, no ordering, nothing that drifts. */
  it('is deterministic across repeated reads', async () => {
    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);

      expect(assertSucceeded(await recipient(harness, member.membershipId))).toStrictEqual(
        assertSucceeded(await recipient(harness, member.membershipId)),
      );
    });
  });
});

describe('across tenants', () => {
  /**
   * Another tenant's membership is `not_found`, identical to one that does not exist.
   *
   * The two harnesses share one store deliberately: with separate stores the identifier would be
   * absent for a trivial reason and the test would prove nothing about isolation.
   */
  it('cannot resolve a membership belonging to another tenant', async () => {
    const inA = harnessFor(TENANT_A);
    const member = await asTenant(TENANT_A, () => joinedMember(inA));
    const inB = harnessWithStores(TENANT_B, inA.stores);

    await asTenant(TENANT_B, async () => {
      assertFailedWith(await recipient(inB, member.membershipId), 'not_found');
    });
    // And the same identifier still resolves in its own tenant, so the refusal above is isolation
    // rather than a member who was never created.
    await asTenant(TENANT_A, async () => {
      expect(assertSucceeded(await recipient(inA, member.membershipId))).toStrictEqual({
        workforceUserId: member.workforceUserId,
      });
    });
  });
});

describe('what the answer does not carry', () => {
  it('answers with one field and nothing else', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);
      const view = assertSucceeded(await recipient(harness, member.membershipId));

      expect(Object.keys(view)).toStrictEqual(['workforceUserId']);
      expect(typeof view.workforceUserId).toBe('string');
    });
  });

  /**
   * None of the member's page reaches it, under any spelling.
   *
   * `status` and `active` are on the list on purpose: this query must not become a second answer to
   * the eligibility question, and a handler that helpfully added one would be caught here.
   */
  it('leaks no status, profile, employment, delegation, portal, tenant or email', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);
      const body = JSON.stringify(assertSucceeded(await recipient(harness, member.membershipId)));

      for (const leaked of [
        'status',
        'active',
        'suspended',
        'ended',
        'profile',
        'displayName',
        'email',
        'locale',
        'preference',
        'channel',
        'portal',
        'employment',
        'delegation',
        'reporting',
        'manager',
        'role',
        'organization',
        'tenant',
        'platformUserId',
        'membershipId',
        'invit',
      ]) {
        expect([leaked, body.includes(leaked)]).toStrictEqual([leaked, false]);
      }
    });
  });
});

describe('who may ask', () => {
  it('answers a caller holding identity.membership.read', async () => {
    const admitting = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(admitting);
      const restricted = restrictedOver(admitting, [IdentityPermissions.membershipRead]);

      expect(assertSucceeded(await recipient(restricted, member.membershipId))).toStrictEqual({
        workforceUserId: member.workforceUserId,
      });
    });
  });

  /**
   * Every other Identity permission, one at a time, and none of them opens it.
   *
   * Driven off `ALL` so a permission added later is covered the day it exists.
   */
  it.each(ALL.filter((permission) => permission !== IdentityPermissions.membershipRead))(
    'is not opened by %s alone',
    async (permission) => {
      const harness = harnessFor(TENANT_A, [permission]);

      await asTenant(TENANT_A, async () => {
        // `forbidden` rather than `not_found`: the caller is refused before the identifier is looked
        // at, so an unauthorized caller learns nothing about whether it names anybody.
        assertFailedWith(await recipient(harness, ABSENT), 'forbidden');
      });
    },
  );

  it.each(['*', 'identity.*', 'identity.membership.*', 'identity.membership'])(
    'is not opened by %s',
    async (pretender) => {
      const harness = harnessFor(TENANT_A, [pretender]);

      await asTenant(TENANT_A, async () => {
        assertFailedWith(await recipient(harness, ABSENT), 'forbidden');
      });
    },
  );

  /** And the query added no permission: the vocabulary is the same length it was. */
  it('registers no new permission', () => {
    expect(ALL).toHaveLength(17);
    expect(ALL).toContain('identity.membership.read');
    expect(ALL.filter((permission) => permission.includes('recipient'))).toStrictEqual([]);
    expect(ALL.filter((permission) => permission.includes('notification'))).toStrictEqual([]);
  });
});
