import { ConcurrencyException, type Transaction, type UnitOfWork } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  SECOND_APPROVER,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { aGroup, aGroupMember } from './workflow-states.js';
import { racingOn, type Racing } from './workflow-race.fixture.js';

/**
 * Two administrators editing the same list at the same instant.
 *
 * **Two real PostgreSQL connections, in two real transactions, overlapping in time.** The second is
 * opened while the first still holds its write, and PostgreSQL — not this file — decides the
 * outcome: it blocks on the index entry until the first commits and is then released, one way or the
 * other. A "race" run on a single pooled connection is one transaction, and proves only that a
 * program doing two things in order does them in order.
 *
 * **Every outcome is classified rather than caught.** A duplicate names the index that refused it, a
 * stale version is a `ConcurrencyException` by type, and the two are asserted apart — because the
 * caller's next move differs: one means somebody wrote this already, the other means somebody moved
 * it since you read it.
 *
 * A group is where this matters more than it looks. Whoever edits a list changes who approves, and
 * "the same person twice on one list" would mean a branch that asks somebody twice and counts them
 * twice — a denominator inflated by a race is an approval threshold nobody configured.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow approval-group race suite');

suite('two writers, one list', () => {
  let fixture: WorkflowFixture;
  let second: UnitOfWork;
  let racing: Racing;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_group_race_role');
    second = fixture.secondUnitOfWork();
    racing = racingOn(fixture, second);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  const race: Racing['race'] = (first, challenger) => racing.race(first, challenger);

  it('lets one group code through and refuses the other', async () => {
    const outcome = await race(
      (transaction) => fixture.stores.groups.insert(transaction, aGroup('finance-directors')),
      (transaction) => fixture.stores.groups.insert(transaction, aGroup('finance-directors')),
    );

    expect(outcome.first).toBe('committed');
    expect(outcome.second).toBe('duplicate:workflow_approval_group_code_idx');
  });

  it('lets one addition of a person through and refuses the simultaneous duplicate', async () => {
    const group = aGroup();

    await inA((transaction) => fixture.stores.groups.insert(transaction, group));

    const outcome = await race(
      (transaction) => fixture.stores.groups.insertMember(transaction, aGroupMember(group, DEPUTY)),
      (transaction) => fixture.stores.groups.insertMember(transaction, aGroupMember(group, DEPUTY)),
    );

    // Both administrators clicked "add"; one row exists. A read-then-write check would have let both
    // through, and the branch that list expands into would ask the same person twice.
    expect(outcome.first).toBe('committed');
    expect(outcome.second).toBe('duplicate:workflow_approval_group_member_idx');

    const members = await inA((transaction) =>
      fixture.stores.groups.membersOf(transaction, group.approvalGroupId),
    );

    expect(members).toHaveLength(1);
  });

  it('takes two different people onto one list at the same instant', async () => {
    const group = aGroup();

    await inA((transaction) => fixture.stores.groups.insert(transaction, group));

    const outcome = await race(
      (transaction) =>
        fixture.stores.groups.insertMember(transaction, aGroupMember(group, APPROVER)),
      (transaction) =>
        fixture.stores.groups.insertMember(transaction, aGroupMember(group, SECOND_APPROVER)),
    );

    // The ordinary case, and it must not be arbitrated: two people joining a list are not in
    // conflict, and an index that serialized them would make filling a group a queue.
    expect([outcome.first, outcome.second]).toStrictEqual(['committed', 'committed']);
  });

  it('takes the same person onto two different lists at the same instant', async () => {
    const first = aGroup();
    const other = aGroup();

    await inA(async (transaction) => {
      await fixture.stores.groups.insert(transaction, first);
      await fixture.stores.groups.insert(transaction, other);
    });

    const outcome = await race(
      (transaction) =>
        fixture.stores.groups.insertMember(transaction, aGroupMember(first, APPROVER)),
      (transaction) =>
        fixture.stores.groups.insertMember(transaction, aGroupMember(other, APPROVER)),
    );

    // Uniqueness is on the pair. A globally unique membership would refuse the second of these,
    // which is a directory's rule rather than a list's.
    expect([outcome.first, outcome.second]).toStrictEqual(['committed', 'committed']);
  });

  it('lets one removal of a person win and leaves the loser with nothing to remove', async () => {
    const group = aGroup();
    const member = aGroupMember(group, APPROVER);

    await inA(async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.groups.insertMember(transaction, member);
    });

    const outcome = await race(
      (transaction) =>
        fixture.stores.groups.removeMember(transaction, member.approvalGroupMemberId),
      (transaction) =>
        fixture.stores.groups.removeMember(transaction, member.approvalGroupMemberId),
    );

    // **Classified by type rather than by message.** A removal that lost is not a duplicate key: the
    // row moved since it was read, which is the optimistic conflict the version predicate produces,
    // and a repository that reported it as a unique violation would send a caller to the wrong fix.
    expect(outcome.first).toBe('committed');
    expect(outcome.second).toBe('stale-version');

    const left = await inA((transaction) =>
      fixture.stores.groups.membersOf(transaction, group.approvalGroupId),
    );

    expect(left).toStrictEqual([]);
  });

  it('raises a ConcurrencyException by type when the member is already gone', async () => {
    const group = aGroup();
    const member = aGroupMember(group, APPROVER);

    await inA(async (transaction) => {
      await fixture.stores.groups.insert(transaction, group);
      await fixture.stores.groups.insertMember(transaction, member);
    });
    await inA((transaction) =>
      fixture.stores.groups.removeMember(transaction, member.approvalGroupMemberId),
    );

    // Asserted as a type, not a string: every module since Phase 2 lets this travel to the edge,
    // where it becomes a 409 rather than a 500.
    await expect(
      inA((transaction) =>
        fixture.stores.groups.removeMember(transaction, member.approvalGroupMemberId),
      ),
    ).rejects.toBeInstanceOf(ConcurrencyException);
  });
});
