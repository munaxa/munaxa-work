import type { Transaction } from '@work/kernel';
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
import { aCode, aGroup, aGroupMember } from './workflow-states.js';

/**
 * The two reads a group is actually used through: paging the lists, and resolving several at once.
 *
 * Split from `workflow-group-repository.integration.test.ts` at the file-size budget, along a real
 * seam: next door is about what a single row does — round trips, refusals, isolation — and this is
 * about the two reads whose *cost* matters. Paging a tenant's lists must be bounded and total the
 * whole set; resolving the groups a version names must be one statement whatever their number,
 * because it runs every time an approval is raised.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's approval-group read suite");

suite('reading the lists', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_group_reads_role');
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

  describe('paging the lists', () => {
    const codes = ['group-a', 'group-b', 'group-c', 'group-d', 'group-e'];

    beforeEach(async () => {
      await inA(async (transaction) => {
        for (const code of codes) await fixture.stores.groups.insert(transaction, aGroup(code));
      });
    });

    it('pages deterministically, with no overlap and nothing skipped', async () => {
      const pageOf = (offset: number): Promise<readonly string[]> =>
        inA(async (transaction) =>
          (await fixture.stores.groups.search(transaction, { limit: 2, offset })).items.map(
            (group) => group.code,
          ),
        );

      expect(await pageOf(0)).toStrictEqual(['group-a', 'group-b']);
      expect(await pageOf(2)).toStrictEqual(['group-c', 'group-d']);
      expect(await pageOf(4)).toStrictEqual(['group-e']);
      // Past the end is an empty page rather than the last one repeated.
      expect(await pageOf(6)).toStrictEqual([]);
    });

    it('counts every row behind the page rather than the page’s length', async () => {
      const page = await inA((transaction) =>
        fixture.stores.groups.search(transaction, { limit: 2, offset: 0 }),
      );

      // A total that reported `items.length` would tell an administrator with forty lists they have
      // two — the same defect the queue's total exists to avoid.
      expect([page.items.length, page.total]).toStrictEqual([2, codes.length]);
    });

    it('counts only the asking tenant’s rows', async () => {
      await inB((transaction) => fixture.stores.groups.insert(transaction, aGroup(aCode('other'))));

      const mine = await inA((transaction) =>
        fixture.stores.groups.search(transaction, { limit: 50, offset: 0 }),
      );

      expect(mine.total).toBe(codes.length);
    });
  });

  describe('resolving many lists at once', () => {
    it('returns every member of every named group, and nothing from an unnamed one', async () => {
      const first = aGroup();
      const second = aGroup();
      const unnamed = aGroup();

      await inA(async (transaction) => {
        for (const group of [first, second, unnamed]) {
          await fixture.stores.groups.insert(transaction, group);
        }
        await fixture.stores.groups.insertMember(transaction, aGroupMember(first, APPROVER));
        await fixture.stores.groups.insertMember(transaction, aGroupMember(first, SECOND_APPROVER));
        await fixture.stores.groups.insertMember(transaction, aGroupMember(second, DEPUTY));
        await fixture.stores.groups.insertMember(transaction, aGroupMember(unnamed, APPROVER));
      });

      const members = await inA((transaction) =>
        fixture.stores.groups.membersOfAll(transaction, [
          first.approvalGroupId,
          second.approvalGroupId,
        ]),
      );

      expect(members).toHaveLength(3);
      expect(new Set(members.map((member) => member.approvalGroupId))).toStrictEqual(
        new Set([first.approvalGroupId, second.approvalGroupId]),
      );
    });

    it('asks the database once, whatever the number of groups', async () => {
      const groups = Array.from({ length: 6 }, () => aGroup());

      await inA(async (transaction) => {
        for (const group of groups) {
          await fixture.stores.groups.insert(transaction, group);
          await fixture.stores.groups.insertMember(transaction, aGroupMember(group, APPROVER));
        }
      });

      const statements: string[] = [];
      const counted = await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.groups.membersOfAll(
          recording(transaction, statements),
          groups.map((group) => group.approvalGroupId),
        ),
      );

      expect(counted).toHaveLength(groups.length);
      // **One statement for six groups.** This is the property the whole method exists for: an
      // instance start resolves every list a version names, and a per-group read would make raising
      // an approval cost a query per list.
      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain('any($1::uuid[])');
    });

    it('asks nothing at all when there is nothing to resolve', async () => {
      const statements: string[] = [];
      const none = await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.groups.membersOfAll(recording(transaction, statements), []),
      );

      // A version naming no group must not produce a query with an empty array in it.
      expect([none, statements]).toStrictEqual([[], []]);
    });
  });
});

/**
 * A transaction that remembers the SQL it was asked to run.
 *
 * The real transaction underneath, with one method wrapped: the statements are the ones PostgreSQL
 * actually received, rather than a copy of the SQL written beside the assertion. That is what makes
 * "one read for six groups" a property of the repository and not of the test.
 */
const recording = (transaction: Transaction, statements: string[]): Transaction => ({
  tenantId: transaction.tenantId,
  collect: (events) => {
    transaction.collect(events);
  },
  execute: <TRow>(sql: string, parameters?: readonly unknown[]): Promise<readonly TRow[]> => {
    statements.push(sql);
    return transaction.execute<TRow>(sql, parameters);
  },
});
