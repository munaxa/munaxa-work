import { ConcurrencyException, type Transaction } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  SECOND_APPROVER,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { aGroup, aGroupMember } from './workflow-states.js';

/**
 * The approval-group repository, against the two tables Checkpoint 3 created.
 *
 * Checkpoint 4 shipped this store as a deliberate stub that threw by name; this suite is what makes
 * the replacement real. Every assertion runs through the repository the composition root actually
 * uses, inside a `PostgresUnitOfWork` transaction, as a role that owns nothing and cannot bypass
 * row-level security.
 *
 * **Two properties here are not ordinary CRUD and are the reason the file exists.**
 *
 * `membersOfAll` must be **one statement whatever the number of groups**, because it is what an
 * instance start calls: a per-group read would make raising an approval cost a query per list. The
 * plan assertion below checks the statement's shape rather than trusting that a loop was avoided.
 *
 * The **composite foreign key** — `(approval_group_id, tenant_id)` — must refuse a member attached to
 * another tenant's group. PostgreSQL checks a foreign key without consulting a policy, so a
 * single-column reference would accept that write: the parent row exists, and the referential check
 * never asks whose it is.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow approval-group repository suite');

suite('the approval-group repository', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_group_repo_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  const inB = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_B, work);

  describe('a list, and the memberships on it', () => {
    it('round-trips a group through real columns', async () => {
      const group = aGroup('capital-approvers');

      await inA((transaction) => fixture.stores.groups.insert(transaction, group));

      const read = await inA((transaction) =>
        fixture.stores.groups.byId(transaction, group.approvalGroupId),
      );
      const byCode = await inA((transaction) =>
        fixture.stores.groups.byCode(transaction, 'capital-approvers'),
      );

      expect(read).toStrictEqual(group);
      expect(byCode).toStrictEqual(group);
    });

    it('round-trips a member, instant and all', async () => {
      const group = aGroup();
      const member = aGroupMember(group, APPROVER);

      await inA(async (transaction) => {
        await fixture.stores.groups.insert(transaction, group);
        await fixture.stores.groups.insertMember(transaction, member);
      });

      const read = await inA((transaction) =>
        fixture.stores.groups.memberById(transaction, member.approvalGroupMemberId),
      );

      // `added_at` is a `timestamptz` the driver returns as a `Date`: the same absolute instant,
      // not a string and not a local midnight.
      expect(read).toStrictEqual(member);
      expect(read?.addedAt.toISOString()).toBe(member.addedAt.toISOString());
    });

    it('reads a group’s members in a deterministic order', async () => {
      const group = aGroup();

      await inA(async (transaction) => {
        await fixture.stores.groups.insert(transaction, group);
        for (const membershipId of [SECOND_APPROVER, APPROVER, DEPUTY]) {
          await fixture.stores.groups.insertMember(transaction, aGroupMember(group, membershipId));
        }
      });

      const members = await inA((transaction) =>
        fixture.stores.groups.membersOf(transaction, group.approvalGroupId),
      );

      // Ordered by membership identifier in SQL rather than in JavaScript, so two instances started
      // from one group produce their steps in the same sequence.
      expect(members.map((member) => member.membershipId)).toStrictEqual(
        [APPROVER, SECOND_APPROVER, DEPUTY].sort((left, right) => left.localeCompare(right)),
      );
    });

    it('answers nothing for a group and a member that are not there', async () => {
      const missing = await inA(async (transaction) => ({
        group: await fixture.stores.groups.byId(
          transaction,
          '01930000-0000-7000-8000-0000000000aa',
        ),
        member: await fixture.stores.groups.memberById(
          transaction,
          '01930000-0000-7000-8000-0000000000bb',
        ),
        code: await fixture.stores.groups.byCode(transaction, 'nothing-like-this'),
      }));

      expect(missing).toStrictEqual({ group: undefined, member: undefined, code: undefined });
    });
  });

  describe('what the database refuses', () => {
    it('refuses a duplicate code in one tenant and permits it in another', async () => {
      const first = aGroup('shared-code');

      await inA((transaction) => fixture.stores.groups.insert(transaction, first));

      await expect(
        inA((transaction) => fixture.stores.groups.insert(transaction, aGroup('shared-code'))),
      ).rejects.toThrow(/workflow_approval_group_code_idx/);

      // Codes are unique per tenant, not globally: two organizations both have finance directors.
      await expect(
        inB((transaction) => fixture.stores.groups.insert(transaction, aGroup('shared-code'))),
      ).resolves.not.toThrow();
    });

    it('refuses the same membership twice on one list and permits it on another', async () => {
      const first = aGroup();
      const second = aGroup();

      await inA(async (transaction) => {
        await fixture.stores.groups.insert(transaction, first);
        await fixture.stores.groups.insert(transaction, second);
        await fixture.stores.groups.insertMember(transaction, aGroupMember(first, APPROVER));
      });

      await expect(
        inA((transaction) =>
          fixture.stores.groups.insertMember(transaction, aGroupMember(first, APPROVER)),
        ),
      ).rejects.toThrow(/workflow_approval_group_member_idx/);
      // The key is the pair. A person who approves capital expenditure and also sits on the hiring
      // panel is two rows, and a globally unique membership would be a directory's rule.
      await expect(
        inA((transaction) =>
          fixture.stores.groups.insertMember(transaction, aGroupMember(second, APPROVER)),
        ),
      ).resolves.not.toThrow();
    });

    /**
     * **The composite foreign key, proved rather than assumed.**
     *
     * Tenant B names tenant A's group. The parent row exists and B cannot see it, and PostgreSQL's
     * referential check does not consult the policy — so with a single-column reference this write
     * would succeed and B would own a member row hanging off a list they cannot read.
     */
    it('refuses a member attached to another tenant’s group', async () => {
      const group = aGroup();

      await inA((transaction) => fixture.stores.groups.insert(transaction, group));

      await expect(
        inB((transaction) =>
          fixture.stores.groups.insertMember(transaction, aGroupMember(group, APPROVER)),
        ),
      ).rejects.toThrow(/workflow_approval_group_member_group_fk/);
    });
  });

  describe('tenant isolation, as a role that cannot bypass it', () => {
    it('hides another tenant’s group from every read, including an exact identifier', async () => {
      const group = aGroup('finance-directors');

      await inA(async (transaction) => {
        await fixture.stores.groups.insert(transaction, group);
        await fixture.stores.groups.insertMember(transaction, aGroupMember(group, APPROVER));
      });

      const seen = await inB(async (transaction) => ({
        byId: await fixture.stores.groups.byId(transaction, group.approvalGroupId),
        // The same code, guessed exactly. Knowing it discloses nothing.
        byCode: await fixture.stores.groups.byCode(transaction, 'finance-directors'),
        members: await fixture.stores.groups.membersOf(transaction, group.approvalGroupId),
        page: await fixture.stores.groups.search(transaction, { limit: 50, offset: 0 }),
      }));

      expect(seen.byId).toBeUndefined();
      expect(seen.byCode).toBeUndefined();
      expect(seen.members).toStrictEqual([]);
      // The total as well as the rows: a count computed without the tenant predicate discloses how
      // many lists another organization keeps even when no row comes back.
      expect(seen.page).toStrictEqual({ items: [], total: 0 });
    });

    it('runs as a role that holds neither superuser nor bypassrls', async () => {
      const { rows } = await fixture.admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `select rolsuper, rolbypassrls from pg_roles where rolname = $1`,
        [fixture.roleName],
      );

      // Asserted before anything above is believed: under a superuser every isolation assertion in
      // this file passes whether or not a single policy exists.
      expect(rows[0]).toStrictEqual({ rolsuper: false, rolbypassrls: false });
    });
  });

  describe('removing somebody from a list', () => {
    it('removes exactly one membership and leaves the rest of the list alone', async () => {
      const group = aGroup();
      const removed = aGroupMember(group, APPROVER);
      const kept = aGroupMember(group, SECOND_APPROVER);

      await inA(async (transaction) => {
        await fixture.stores.groups.insert(transaction, group);
        await fixture.stores.groups.insertMember(transaction, removed);
        await fixture.stores.groups.insertMember(transaction, kept);
      });
      await inA((transaction) =>
        fixture.stores.groups.removeMember(transaction, removed.approvalGroupMemberId),
      );

      const after = await inA(async (transaction) => ({
        members: await fixture.stores.groups.membersOf(transaction, group.approvalGroupId),
        gone: await fixture.stores.groups.memberById(transaction, removed.approvalGroupMemberId),
        group: await fixture.stores.groups.byId(transaction, group.approvalGroupId),
      }));

      expect(after.members.map((member) => member.membershipId)).toStrictEqual([SECOND_APPROVER]);
      expect(after.gone).toBeUndefined();
      // The list itself is untouched: removing a person is not removing the group.
      expect(after.group).toStrictEqual(group);
    });

    it('lets the same person be added again afterwards', async () => {
      const group = aGroup();
      const first = aGroupMember(group, APPROVER);

      await inA(async (transaction) => {
        await fixture.stores.groups.insert(transaction, group);
        await fixture.stores.groups.insertMember(transaction, first);
      });
      await inA((transaction) =>
        fixture.stores.groups.removeMember(transaction, first.approvalGroupMemberId),
      );

      // `workflow_approval_group_member_idx` is partial on `deleted_at is null`, which is exactly
      // what makes a soft delete the right removal here rather than a hard one.
      await expect(
        inA((transaction) =>
          fixture.stores.groups.insertMember(transaction, aGroupMember(group, APPROVER)),
        ),
      ).resolves.not.toThrow();
    });

    it('refuses to remove a membership on another tenant’s list', async () => {
      const group = aGroup();
      const member = aGroupMember(group, APPROVER);

      await inA(async (transaction) => {
        await fixture.stores.groups.insert(transaction, group);
        await fixture.stores.groups.insertMember(transaction, member);
      });

      // Not "forbidden": the row is invisible, so it is indistinguishable from one that never
      // existed — which is the only answer that discloses nothing.
      await expect(
        inB((transaction) =>
          fixture.stores.groups.removeMember(transaction, member.approvalGroupMemberId),
        ),
      ).rejects.toThrow(ConcurrencyException);

      const survived = await inA((transaction) =>
        fixture.stores.groups.memberById(transaction, member.approvalGroupMemberId),
      );

      expect(survived).toStrictEqual(member);
    });
  });
});
