import { ConcurrencyException, runInContext, uuidV7 } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresMembershipDirectory } from './membership-directory.js';
import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openIdentityFixture,
  requireDatabaseInCi,
  type IdentityFixture,
} from './identity-database.fixture.js';

/**
 * Persistence against a real PostgreSQL: optimistic concurrency, the constraints the database
 * enforces rather than the application, the audit columns, and the directory query the tenant
 * guard runs on every request.
 *
 * Each of these is a property of the database rather than of our code, which is why none of them
 * is tested against a fake.
 */

requireDatabaseInCi('Workforce Identity persistence tests');

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('Workforce Identity persistence', () => {
  let fixture: IdentityFixture;

  beforeAll(async () => {
    fixture = await openIdentityFixture('work_persistence_test');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  describe('optimistic concurrency', () => {
    it('refuses a stale write and leaves the first writer’s value intact', async () => {
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );

      await fixture.asTenant(TENANT_A, async (transaction) => {
        const state = await fixture.stores.memberships.byId(transaction, membership);

        expect(state?.version).toBe(1);
        await fixture.stores.memberships.update(transaction, { ...state!, status: 'suspended' }, 1);
      });

      // A second administrator, holding the version they read before the first wrote.
      await expect(
        fixture.asTenant(TENANT_A, async (transaction) => {
          const stale = await fixture.stores.memberships.byId(transaction, membership);

          await fixture.stores.memberships.update(transaction, { ...stale!, status: 'ended' }, 1);
        }),
      ).rejects.toThrow(ConcurrencyException);

      const current = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.memberships.byId(transaction, membership),
      );

      expect(current?.status).toBe('suspended');
    });

    it('applies the same rule to the tenant-less user table', async () => {
      const user = await fixture.seedUser('platform-1');

      await fixture.seedMembership(TENANT_A, user);
      await fixture.asTenant(TENANT_A, async (transaction) => {
        const state = await fixture.stores.users.byId(transaction, user);

        await fixture.stores.users.update(transaction, { ...state!, status: 'suspended' }, 1);
      });

      await expect(
        fixture.asTenant(TENANT_A, async (transaction) => {
          const state = await fixture.stores.users.byId(transaction, user);

          await fixture.stores.users.update(transaction, { ...state!, status: 'deactivated' }, 1);
        }),
      ).rejects.toThrow(ConcurrencyException);
    });
  });

  describe('constraints the database enforces, not the application', () => {
    it('permits one membership per person per tenant, never two', async () => {
      const user = await fixture.seedUser('platform-1');

      await fixture.seedMembership(TENANT_A, user);

      // Two would mean two answers to "may this person act here", and the planner would decide.
      await expect(fixture.seedMembership(TENANT_A, user)).rejects.toThrow(/duplicate key|unique/);
    });

    it('permits at most one primary job per member', async () => {
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );
      const link = () => ({
        id: uuidV7(),
        tenantId: TENANT_A,
        membershipId: membership,
        employmentId: uuidV7(),
        isPrimary: true,
        status: 'linked' as const,
        linkedAt: new Date(),
        version: 0,
      });

      await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.employmentLinks.insert(transaction, link()),
      );

      // Two primaries would give payroll grouping and letter generation two answers, and the
      // second would only be noticed on a payslip.
      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.employmentLinks.insert(transaction, link()),
        ),
      ).rejects.toThrow(/duplicate key|unique/);
    });

    it('permits one open invitation per address per tenant, matched case-insensitively', async () => {
      const invitation = (email: string) => ({
        id: uuidV7(),
        tenantId: TENANT_A,
        email,
        portals: ['employee' as const],
        status: 'pending' as const,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 100_000),
        version: 0,
      });

      await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.invitations.insert(transaction, invitation('sara@example.com')),
      );

      // The index and the repository's lookup use the same expression, so they agree.
      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.invitations.insert(transaction, invitation('SARA@example.com')),
        ),
      ).rejects.toThrow(/duplicate key|unique/);
    });

    it('refuses a profile missing one of the first-class languages', async () => {
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.profiles.insert(transaction, {
            id: uuidV7(),
            tenantId: TENANT_A,
            membershipId: membership,
            displayName: { en: 'Sara Haddad' },
            version: 0,
          }),
        ),
      ).rejects.toThrow(/bilingual_name/);
    });

    it('refuses a delegation to oneself', async () => {
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.delegations.insert(transaction, {
            id: uuidV7(),
            tenantId: TENANT_A,
            delegatorMembershipId: membership,
            delegateMembershipId: membership,
            scope: 'leave.approve',
            effectiveFrom: new Date(),
            effectiveTo: new Date(Date.now() + 100_000),
            status: 'scheduled',
            reason: 'annual leave',
            version: 0,
          }),
        ),
      ).rejects.toThrow(/not_to_self/);
    });
  });

  describe('the membership directory — the query the tenant guard depends on', () => {
    it('returns the tenants an authenticated person is an active member of', async () => {
      const directory = new PostgresMembershipDirectory(fixture.application);
      const user = await fixture.seedUser('platform-1');

      await fixture.seedMembership(TENANT_A, user);
      await fixture.seedMembership(TENANT_B, user);

      const found = await directory.activeMembershipsOf('platform-1');

      expect(found.map((membership) => membership.tenantId).sort()).toEqual(
        [TENANT_A, TENANT_B].sort(),
      );
    });

    it('returns nothing for a platform user nobody has admitted', async () => {
      const directory = new PostgresMembershipDirectory(fixture.application);

      await fixture.seedUser('platform-stranger');

      expect(await directory.activeMembershipsOf('platform-stranger')).toEqual([]);
    });

    it('returns nothing for a platform user that does not exist', async () => {
      const directory = new PostgresMembershipDirectory(fixture.application);

      expect(await directory.activeMembershipsOf('platform-nobody')).toEqual([]);
    });

    it('excludes a suspended membership, so a suspended person resolves no tenant', async () => {
      const directory = new PostgresMembershipDirectory(fixture.application);
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );

      await fixture.admin.query(`update tenant_membership set status = 'suspended' where id = $1`, [
        membership,
      ]);

      expect(await directory.activeMembershipsOf('platform-1')).toEqual([]);
    });

    it('excludes every membership of a suspended account', async () => {
      const directory = new PostgresMembershipDirectory(fixture.application);
      const user = await fixture.seedUser('platform-1');

      await fixture.seedMembership(TENANT_A, user);
      await fixture.seedMembership(TENANT_B, user);
      await fixture.admin.query(`update workforce_user set status = 'suspended' where id = $1`, [
        user,
      ]);

      expect(await directory.activeMembershipsOf('platform-1')).toEqual([]);
    });

    it('returns identifiers only — nothing that would be a disclosure if it were wrong', async () => {
      const directory = new PostgresMembershipDirectory(fixture.application);
      const user = await fixture.seedUser('platform-1');

      await fixture.seedMembership(TENANT_A, user);

      const [membership] = await directory.activeMembershipsOf('platform-1');

      expect(Object.keys(membership ?? {}).sort()).toEqual([
        'membershipId',
        'platformUserId',
        'status',
        'tenantId',
        'workforceUserId',
      ]);
    });
  });

  describe('audit and soft delete', () => {
    it('writes the actor from the context, not from the caller', async () => {
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );

      await runInContext(
        { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:sara' },
        async () =>
          fixture.unitOfWork.execute(async (transaction) => {
            const state = await fixture.stores.memberships.byId(transaction, membership);

            await fixture.stores.memberships.update(
              transaction,
              { ...state!, status: 'suspended' },
              1,
            );
          }),
      );

      const row = await fixture.admin.query<{ updated_by: string }>(
        'select updated_by from tenant_membership where id = $1',
        [membership],
      );

      // The caller supplied no audit value and had no way to; infrastructure wrote it.
      expect(row.rows[0]?.updated_by).toBe('user:sara');
    });

    it('hides a soft-deleted row from reads', async () => {
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );

      await fixture.admin.query(
        `update tenant_membership set deleted_at = now(), deleted_by = 'test' where id = $1`,
        [membership],
      );

      expect(
        await fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.memberships.byId(transaction, membership),
        ),
      ).toBeUndefined();
    });
  });

  describe('identifiers', () => {
    it('mints UUIDv7 in the database too, so a row written by a script still orders by time', async () => {
      const generated = await fixture.admin.query<{ id: string }>(
        'select app_uuid_v7() as id from generate_series(1, 5)',
      );
      const ids = generated.rows.map((row) => row.id);

      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
      expect([...ids].sort()).toEqual(ids);
    });
  });
});
