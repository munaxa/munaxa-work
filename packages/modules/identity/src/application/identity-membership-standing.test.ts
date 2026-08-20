import { Dispatcher, type HandlerFailure, type Result } from '@work/kernel';
import { InMemoryUnitOfWork, assertFailedWith, assertSucceeded, permitting } from '@work/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { MembershipStandingView } from '../contracts/views.js';

import {
  ALL,
  TENANT_A,
  asTenant,
  ask,
  clock,
  harnessFor,
  joinedMember,
  send,
  type Harness,
} from './identity-test-harness.js';
import { identityModule } from './identity-module.js';
import { IdentityPermissions } from './identity-permissions.js';
import { inMemoryIdentityStores } from './in-memory-stores.js';
import { ConfiguredTenantSettingsForTest } from './test-settings.js';

/**
 * `identity.membership-standing` — one membership, one predicate, nothing else.
 *
 * **The payload assertions matter more than they look.** This query exists because
 * `identity.describe-member` answers a member's whole page and a consumer needing one fact would have
 * received all of it. A query that quietly grew a second field would put this module back where it
 * started, so the response shape is asserted by its **exact keys** rather than by reading the one
 * that should be there.
 *
 * **`false` and `not_found` are different answers and stay different.** A membership that exists and
 * may not act is a fact about somebody real; an identifier naming nobody is a fact about the request.
 * Collapsing them would tell a caller that a person cannot act when no person was named.
 */

const standing = (
  harness: Harness,
  membershipId: string,
): Promise<Result<MembershipStandingView, HandlerFailure>> =>
  ask<MembershipStandingView>(harness, {
    queryName: 'identity.membership-standing',
    membershipId,
  });

const transition = (
  harness: Harness,
  membershipId: string,
  to: 'suspend' | 'reinstate' | 'end',
  expectedVersion = 1,
) =>
  send(harness, {
    commandName: 'identity.change-membership',
    membershipId,
    transition: to,
    expectedVersion,
    reason: 'For the test',
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

describe('what the standing of a membership is', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor(TENANT_A);
  });

  it('answers true for a membership that may act', async () => {
    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);

      expect(assertSucceeded(await standing(harness, member.membershipId))).toStrictEqual({
        active: true,
      });
    });
  });

  /**
   * Suspended and ended are asserted **separately**, not as "not active".
   *
   * A handler comparing against one of them — `status !== 'ended'`, say — would pass a suite that
   * checked only one, and would then report a suspended member as able to act.
   */
  it.each(['suspend', 'end'] as const)(
    'answers false for a membership that was %sed',
    async (to) => {
      await asTenant(TENANT_A, async () => {
        const member = await joinedMember(harness);

        assertSucceeded(await transition(harness, member.membershipId, to));

        expect(assertSucceeded(await standing(harness, member.membershipId))).toStrictEqual({
          active: false,
        });
      });
    },
  );

  /** A membership that was suspended and reinstated may act again: the rule reads the state, not a history. */
  it('answers true again once a suspended membership is reinstated', async () => {
    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);

      assertSucceeded(await transition(harness, member.membershipId, 'suspend'));
      // Version two now: the suspension wrote a row, and the reinstatement must name what it read.
      assertSucceeded(await transition(harness, member.membershipId, 'reinstate', 2));

      expect(assertSucceeded(await standing(harness, member.membershipId))).toStrictEqual({
        active: true,
      });
    });
  });

  /**
   * An identifier naming nobody is `not_found`, **never `{ active: false }`**.
   *
   * The distinction is the contract: `false` says a real person may not act, and `not_found` says
   * nobody was named. A caller that saw `false` for a typo would go and ask an administrator why a
   * colleague had been suspended.
   */
  it('refuses an identifier that names no membership', async () => {
    await asTenant(TENANT_A, async () => {
      assertFailedWith(
        await standing(harness, '01930000-0000-7000-8000-0000000000ff'),
        'not_found',
      );
    });
  });

  /** The same state answers the same twice: no clock, no date, nothing that drifts. */
  it('is deterministic across repeated reads', async () => {
    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);
      const first = assertSucceeded(await standing(harness, member.membershipId));
      const second = assertSucceeded(await standing(harness, member.membershipId));

      expect(first).toStrictEqual(second);
    });
  });
});

describe('what the answer does not carry', () => {
  /**
   * Exactly one key, asserted as the whole object.
   *
   * `toStrictEqual` on the response rather than a check that `active` is present: the failure this
   * guards against is a *widening*, and a test that read one field would not notice five more
   * arriving beside it.
   */
  it('answers with one field and nothing else', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);
      const view = assertSucceeded(await standing(harness, member.membershipId));

      expect(Object.keys(view)).toStrictEqual(['active']);
      expect(typeof view.active).toBe('boolean');
    });
  });

  /** And none of the member's page reaches it, under any spelling. */
  it('leaks no status, profile, employment, delegation, portal or tenant', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(harness);
      const body = JSON.stringify(assertSucceeded(await standing(harness, member.membershipId)));

      for (const leaked of [
        'status',
        'suspended',
        'ended',
        'profile',
        'displayName',
        'preference',
        'portal',
        'employment',
        'delegation',
        'role',
        'organization',
        'tenant',
        'workforceUserId',
        'platformUserId',
        'membershipId',
      ]) {
        expect([leaked, body.includes(leaked)]).toStrictEqual([leaked, false]);
      }
    });
  });
});

describe('who may ask', () => {
  /** The permission the query declares, and it is one that already existed. */
  it('answers a caller holding identity.membership.read', async () => {
    const admitting = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const member = await joinedMember(admitting);
      // The same store, a caller holding only the one permission the query declares.
      const restricted = restrictedOver(admitting, [IdentityPermissions.membershipRead]);

      expect(assertSucceeded(await standing(restricted, member.membershipId))).toStrictEqual({
        active: true,
      });
    });
  });

  /**
   * Every other Identity permission, one at a time, and none of them opens it.
   *
   * Driven off `ALL` rather than a hand-written list, so a permission added later is covered the day
   * it exists rather than the day somebody remembers this file.
   */
  it.each(ALL.filter((permission) => permission !== IdentityPermissions.membershipRead))(
    'is not opened by %s alone',
    async (permission) => {
      const harness = harnessFor(TENANT_A, [permission]);

      await asTenant(TENANT_A, async () => {
        const outcome = await standing(harness, '01930000-0000-7000-8000-0000000000ff');

        // `forbidden` rather than `not_found`: the caller is refused before the identifier is looked
        // at, so an unauthorized caller learns nothing about whether it names anybody.
        assertFailedWith(outcome, 'forbidden');
      });
    },
  );

  it.each(['*', 'identity.*', 'identity.membership.*', 'identity.membership'])(
    'is not opened by %s',
    async (pretender) => {
      const harness = harnessFor(TENANT_A, [pretender]);

      await asTenant(TENANT_A, async () => {
        assertFailedWith(
          await standing(harness, '01930000-0000-7000-8000-0000000000ff'),
          'forbidden',
        );
      });
    },
  );

  /** And the query added no permission: the vocabulary is the same length it was. */
  it('registers no new permission', () => {
    expect(ALL).toHaveLength(17);
    expect(ALL).toContain('identity.membership.read');
    expect(ALL.filter((permission) => permission.includes('standing'))).toStrictEqual([]);
    expect(ALL.filter((permission) => permission.includes('active'))).toStrictEqual([]);
  });
});

describe('when the store cannot answer', () => {
  /**
   * **Infrastructure failure raises. It is not `not_found` and it is not `{ active: false }`.**
   *
   * This is the one behaviour that must fail closed: a consumer treating an unreachable database as
   * "not active" would refuse everybody during an outage, and one treating it as "active" would
   * admit everybody. Neither is a business answer, so the query gives none.
   */
  it('raises rather than answering', async () => {
    const stores = inMemoryIdentityStores();
    const broken = {
      ...stores,
      memberships: {
        ...stores.memberships,
        byId: () => Promise.reject(new Error('connection terminated')),
      },
    };
    const dispatcher = new Dispatcher(permitting(...ALL));
    const module = identityModule({
      unitOfWork: new InMemoryUnitOfWork(TENANT_A),
      stores: broken,
      settings: new ConfiguredTenantSettingsForTest(),
      clock,
    });

    for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

    await asTenant(TENANT_A, async () => {
      await expect(
        dispatcher.ask({
          queryName: 'identity.membership-standing',
          membershipId: '01930000-0000-7000-8000-0000000000ff',
        }),
      ).rejects.toThrow('connection terminated');
    });
  });
});
