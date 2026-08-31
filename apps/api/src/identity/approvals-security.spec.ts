import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  B_MEMBER,
  CONNECTION,
  DUAL_IN_A,
  DUAL_IN_B,
  FOREIGN_KID,
  MEMBER,
  OTHER_MEMBER,
  PREVIOUS_KID,
  TENANT_A,
  TENANT_B,
  http,
  openSecurityBoundary,
  requireDatabaseInCi,
  roleIsUnprivileged,
  seedPendingApproval,
  tokenFor,
  type SecurityFixture,
} from './security.fixture.js';

/**
 * The existing Approvals product behind the real security boundary — the first end-to-end proof.
 *
 * Nothing about the screen or the queue changed for this suite. What changed is everything under
 * it: the request now carries a cryptographically verified token, the tenant now comes from a
 * membership row, and the permission is now decided by the platform's resolver over the tenant's
 * own assignments. The seven cases below are the whole contract, and the two that matter most are
 * the ones people conflate — **401 is not 403**, and **an authorized empty queue is not a
 * refusal**.
 */

const PENDING = '/api/v1/workflow/approvals/pending';

/** The queue's shape, so a body assertion reads as a claim about the product and not about `any`. */
interface Queue {
  readonly items: readonly unknown[];
  readonly total: number;
}

const queue = (response: { readonly body: unknown }): Queue => response.body as Queue;
const READ_OWN = 'workflow:approval:read-own';
const SOME_OTHER_GRANT = 'workflow:instance:read';

requireDatabaseInCi('The Approvals security proof');

describe.skipIf(CONNECTION === undefined)('Approvals behind the security boundary', () => {
  let fixture: SecurityFixture;

  beforeAll(async () => {
    fixture = await openSecurityBoundary();
  }, 60_000);

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.reset();
  });

  it('runs as a role a policy can actually refuse', async () => {
    expect(await roleIsUnprivileged(fixture.pool)).toEqual({
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  describe('Case A — no authentication', () => {
    it('answers 401 and no protected data', async () => {
      const response = await http(fixture.application).get(PENDING);

      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('items');
    });

    it('answers 401 to a token the issuer did not sign', async () => {
      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER, { kid: FOREIGN_KID })}`);

      expect(response.status).toBe(401);
    });

    it('answers 401 to an expired token', async () => {
      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER, { ttl: -120_000 })}`);

      expect(response.status).toBe(401);
    });
  });

  describe('Case B — authenticated, no approval grant', () => {
    it('answers 403, and distinguishably from the unauthenticated 401', async () => {
      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      expect(response.status).toBe(403);
      expect(response.body).not.toHaveProperty('items');
    });

    it('answers 403 to a caller holding a different Workflow grant', async () => {
      await fixture.grant(TENANT_A, MEMBER, [SOME_OTHER_GRANT]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      // Holding one permission in a module is not holding another. `instance:read` is the
      // administrator's view of every approval; `approval:read-own` is the approver's own queue.
      expect(response.status).toBe(403);
    });
  });

  describe('Case C — authenticated and authorized', () => {
    it('answers 200 and the caller’s own queue', async () => {
      await seedPendingApproval(fixture, TENANT_A, OTHER_MEMBER, MEMBER);
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      expect(response.status).toBe(200);
      expect(queue(response).items).toHaveLength(1);
      expect(queue(response).total).toBe(1);
    });

    it('answers 200 through a token signed with the previous key during rotation', async () => {
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER, { kid: PREVIOUS_KID })}`);

      expect(response.status).toBe(200);
    });

    it('shows one approver’s queue to that approver and not to another', async () => {
      await seedPendingApproval(fixture, TENANT_A, OTHER_MEMBER, MEMBER);
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN], 'reader-a');
      await fixture.grant(TENANT_A, OTHER_MEMBER, [READ_OWN], 'reader-b');

      const mine = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);
      const theirs = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(OTHER_MEMBER)}`);

      // The same permission, the same tenant, two memberships, two answers. A queue resolved from
      // anything the caller supplied would return the same list to both.
      expect(queue(mine).items).toHaveLength(1);
      expect(queue(theirs).items).toHaveLength(0);
      expect(theirs.status).toBe(200);
    });
  });

  describe('Case D — authorized with nothing waiting', () => {
    it('answers 200 and an empty queue, which is not a refusal', async () => {
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      expect(response.status).toBe(200);
      expect(queue(response).items).toEqual([]);
      expect(queue(response).total).toBe(0);
    });
  });

  describe('Case E — the grant is withdrawn', () => {
    it('stops working on the next request, with no window in between', async () => {
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);

      const before = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      expect(before.status).toBe(200);

      await fixture.revoke(TENANT_A, MEMBER);

      const after = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      // The same token, still perfectly valid. Authorization is resolved from the store on every
      // request, so revocation needs no expiry to take effect and the token needs no reissue.
      expect(after.status).toBe(403);
    });

    it('stops working when the role itself stops conferring the permission', async () => {
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);
      await fixture.grant(TENANT_A, MEMBER, [SOME_OTHER_GRANT]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      // The role was redefined rather than unassigned. Without `invalidateTenant` the memoised
      // role graph would keep conferring the permission for the life of the process.
      expect(response.status).toBe(403);
    });
  });

  describe('Case F — the token disagrees with the membership', () => {
    it('refuses when the token asserts another tenant, and switches to neither', async () => {
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER, { tenantId: TENANT_B })}`);

      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('items');
    });

    it('accepts a token that asserts the tenant the membership resolves', async () => {
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER, { tenantId: TENANT_A })}`);

      expect(response.status).toBe(200);
    });
  });

  describe('Case G — reaching for another membership', () => {
    it('refuses a tenant the caller is not a member of', async () => {
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);
      await fixture.grant(TENANT_B, B_MEMBER, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`)
        .set('x-munaxa-tenant', TENANT_B);

      // The header selects among the tenants this person is already a member of. It cannot add one.
      expect(response.status).toBe(401);
    });

    it('does not lend one membership’s grant to another in the same tenant', async () => {
      await fixture.grant(TENANT_A, OTHER_MEMBER, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      expect(response.status).toBe(403);
    });

    it('does not lend one person’s grant in one tenant to their membership in another', async () => {
      await fixture.grant(TENANT_B, DUAL_IN_B, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(DUAL_IN_A)}`)
        .set('x-munaxa-tenant', TENANT_A);

      // One account, two memberships, two grant sets, no union. The same person holds the
      // permission in tenant B and does not hold it here.
      expect(response.status).toBe(403);
    });

    it('honours the grant in the tenant the same person selected', async () => {
      await fixture.grant(TENANT_B, DUAL_IN_B, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(DUAL_IN_B)}`)
        .set('x-munaxa-tenant', TENANT_B);

      expect(response.status).toBe(200);
    });

    it('refuses to guess when a person belongs to more than one tenant', async () => {
      await fixture.grant(TENANT_A, DUAL_IN_A, [READ_OWN]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(DUAL_IN_A)}`);

      // No tenant named and two to choose from. Picking the first would put one customer's work
      // into another's tenant the one time it mattered, so there is no default.
      expect(response.status).toBe(401);
    });

    it('refuses a principal no membership matches', async () => {
      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER, { subject: 'platform:nobody' })}`);

      expect(response.status).toBe(401);
    });

    it('refuses a membership that is no longer active', async () => {
      await fixture.grant(TENANT_A, MEMBER, [READ_OWN]);
      await fixture.owner.query(`update tenant_membership set status = 'suspended' where id = $1`, [
        MEMBER,
      ]);

      const response = await http(fixture.application)
        .get(PENDING)
        .set('authorization', `Bearer ${tokenFor(MEMBER)}`);

      // Suspension is enforced upstream of authorization: the directory stops returning the
      // membership, no tenant context is established, and there is nothing to be forbidden from.
      expect(response.status).toBe(401);
    });
  });
});
