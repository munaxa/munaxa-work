import { uuidV7 } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openIdentityFixture,
  requireDatabaseInCi,
  type IdentityFixture,
} from './identity-database.fixture.js';

/**
 * Tenant isolation, per entity, against a real PostgreSQL (ADR-0030).
 *
 * The strongest form of the property, not the weakest: not "a list comes back filtered", but
 * "a caller who already knows the primary key still cannot read the row". That is the shape the
 * failure would take — a bug that leaks an identifier, followed by a fetch — and it is the one
 * row-level security has to survive.
 */

requireDatabaseInCi('Workforce Identity isolation tests');

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('Workforce Identity tenant isolation', () => {
  let fixture: IdentityFixture;

  beforeAll(async () => {
    fixture = await openIdentityFixture('work_isolation_test');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  describe('every entity this phase adds', () => {
    it('hides another tenant’s membership, by its exact identifier', async () => {
      const user = await fixture.seedUser('platform-1');
      const membership = await fixture.seedMembership(TENANT_A, user);

      const found = await fixture.asTenant(TENANT_B, (transaction) =>
        fixture.stores.memberships.byId(transaction, membership),
      );

      expect(found).toBeUndefined();
    });

    it('hides every dependent entity from another tenant, by exact identifier', async () => {
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );
      const other = await fixture.seedMembership(TENANT_A, await fixture.seedUser('platform-2'));
      const now = new Date();
      const ids = {
        portal: uuidV7(),
        link: uuidV7(),
        delegation: uuidV7(),
        profile: uuidV7(),
        preference: uuidV7(),
        invitation: uuidV7(),
      };

      await fixture.asTenant(TENANT_A, async (transaction) => {
        await fixture.stores.portals.insert(transaction, {
          id: ids.portal,
          tenantId: TENANT_A,
          membershipId: membership,
          portal: 'employee',
          status: 'granted',
          grantedAt: now,
          version: 0,
        });
        await fixture.stores.employmentLinks.insert(transaction, {
          id: ids.link,
          tenantId: TENANT_A,
          membershipId: membership,
          employmentId: uuidV7(),
          isPrimary: true,
          status: 'linked',
          linkedAt: now,
          version: 0,
        });
        await fixture.stores.delegations.insert(transaction, {
          id: ids.delegation,
          tenantId: TENANT_A,
          delegatorMembershipId: membership,
          delegateMembershipId: other,
          scope: 'leave.approve',
          effectiveFrom: new Date(now.getTime() + 1000),
          effectiveTo: new Date(now.getTime() + 100_000),
          status: 'scheduled',
          reason: 'annual leave',
          version: 0,
        });
        await fixture.stores.profiles.insert(transaction, {
          id: ids.profile,
          tenantId: TENANT_A,
          membershipId: membership,
          displayName: { en: 'Sara Haddad', ar: 'سارة حداد' },
          version: 0,
        });
        await fixture.stores.preferences.insert(transaction, {
          id: ids.preference,
          tenantId: TENANT_A,
          membershipId: membership,
          language: 'ar',
          calendar: 'hijri',
          timeZone: 'Asia/Riyadh',
          numerals: 'arabic-indic',
          version: 0,
        });
        await fixture.stores.invitations.insert(transaction, {
          id: ids.invitation,
          tenantId: TENANT_A,
          email: 'omar@example.com',
          portals: ['employee'],
          status: 'pending',
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 100_000),
          version: 0,
        });
      });

      await fixture.asTenant(TENANT_B, async (transaction) => {
        expect(await fixture.stores.portals.byId(transaction, ids.portal)).toBeUndefined();
        expect(await fixture.stores.employmentLinks.byId(transaction, ids.link)).toBeUndefined();
        expect(await fixture.stores.delegations.byId(transaction, ids.delegation)).toBeUndefined();
        expect(await fixture.stores.invitations.byId(transaction, ids.invitation)).toBeUndefined();
        expect(
          await fixture.stores.profiles.forMembership(transaction, membership),
        ).toBeUndefined();
        expect(
          await fixture.stores.preferences.forMembership(transaction, membership),
        ).toBeUndefined();
      });
    });

    it('counts only its own rows in a list', async () => {
      await fixture.seedMembership(TENANT_A, await fixture.seedUser('platform-1'));
      await fixture.seedMembership(TENANT_B, await fixture.seedUser('platform-2'));

      const counted = await fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute<{ count: number }>(
          'select count(*)::int as count from tenant_membership',
        ),
      );

      expect(Number(counted[0]?.count)).toBe(1);
    });
  });

  describe('writing across the boundary', () => {
    it('refuses to insert a row belonging to another tenant', async () => {
      const membership = await fixture.seedMembership(
        TENANT_A,
        await fixture.seedUser('platform-1'),
      );

      // A bug that got the tenant wrong: `with check` refuses the insert outright, rather than
      // writing a row the writer could never read back.
      await expect(
        fixture.asTenant(TENANT_B, (transaction) =>
          fixture.stores.portals.insert(transaction, {
            id: uuidV7(),
            tenantId: TENANT_A,
            membershipId: membership,
            portal: 'employee',
            status: 'granted',
            grantedAt: new Date(),
            version: 0,
          }),
        ),
      ).rejects.toThrow(/row-level security|violates/);
    });

    it('returns nothing when no tenant is set — it fails closed, never open', async () => {
      await fixture.seedMembership(TENANT_A, await fixture.seedUser('platform-1'));

      const result = await fixture.application.query<{ count: number }>(
        'select count(*)::int as count from tenant_membership',
      );

      expect(Number(result.rows[0]?.count)).toBe(0);
    });
  });

  /**
   * `workforce_user` has no `tenant_id` (ADR-0033), so the standard policy cannot apply to it.
   * It is protected by reachability instead — and that has to be tested rather than asserted,
   * because it is the one place in the schema where the usual guarantee is achieved differently.
   */
  describe('the tenant-less workforce_user table', () => {
    it('is visible to a tenant that has admitted the person', async () => {
      const user = await fixture.seedUser('platform-1');

      await fixture.seedMembership(TENANT_A, user);

      const found = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.users.byId(transaction, user),
      );

      expect(found?.platformUserId).toBe('platform-1');
    });

    it('is invisible to a tenant that has not', async () => {
      const user = await fixture.seedUser('platform-1');

      await fixture.seedMembership(TENANT_A, user);

      expect(
        await fixture.asTenant(TENANT_B, (transaction) =>
          fixture.stores.users.byId(transaction, user),
        ),
      ).toBeUndefined();
    });

    it('is invisible to every tenant when nobody has admitted the person', async () => {
      const user = await fixture.seedUser('platform-stranger');

      for (const tenant of [TENANT_A, TENANT_B]) {
        expect(
          await fixture.asTenant(tenant, (transaction) =>
            fixture.stores.users.byId(transaction, user),
          ),
        ).toBeUndefined();
      }
    });

    it('is the same single row for both tenants once both admit the person (AD-005)', async () => {
      const user = await fixture.seedUser('platform-1');

      await fixture.seedMembership(TENANT_A, user);
      await fixture.seedMembership(TENANT_B, user);

      for (const tenant of [TENANT_A, TENANT_B]) {
        const found = await fixture.asTenant(tenant, (transaction) =>
          fixture.stores.users.byId(transaction, user),
        );

        // One person, one row, two tenants — the whole reason this table has no tenant.
        expect(found?.id).toBe(user);
      }
    });

    it('is not reachable through a membership that was soft deleted', async () => {
      const user = await fixture.seedUser('platform-1');
      const membership = await fixture.seedMembership(TENANT_A, user);

      await fixture.admin.query(
        `update tenant_membership set deleted_at = now(), deleted_by = 'test' where id = $1`,
        [membership],
      );

      expect(
        await fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.users.byId(transaction, user),
        ),
      ).toBeUndefined();
    });
  });
});
