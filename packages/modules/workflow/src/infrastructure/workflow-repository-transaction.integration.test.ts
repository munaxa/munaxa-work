import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7, type Transaction } from '@work/kernel';

import { decisionHistory } from '../domain/history.js';

import {
  CONNECTION,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  APPROVER,
  SECOND_APPROVER,
  type PoolLike,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { aGroup, aGroupMember, aStartedInstance, anApproval } from './workflow-states.js';

/**
 * Who owns the transaction.
 *
 * **No repository in this module opens one.** Each takes the `Transaction` the application's unit of
 * work established, which is what makes "start an approval" — an instance, a step per template and
 * two history entries, across four tables — one act rather than four that happen to be adjacent.
 *
 * A suite can assert that by construction only weakly: two writes that both survive prove nothing,
 * because a repository committing independently would leave them both there too. So the assertions
 * that carry the weight are the other two — that a failure after a write leaves **nothing**, and that
 * a second connection cannot see an intermediate state while the transaction is still open. A
 * repository with a `begin` of its own fails both.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow transaction-ownership suite');

suite('the transaction belongs to the application', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_transaction_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  const started = (): ReturnType<typeof aStartedInstance> =>
    aStartedInstance([APPROVER, SECOND_APPROVER]);

  /** The whole of a start, across four tables, through five repositories. */
  const writeStart = async (
    transaction: Transaction,
    seed: ReturnType<typeof aStartedInstance>,
  ): Promise<void> => {
    await fixture.stores.definitions.insert(transaction, seed.definition);
    await fixture.stores.versions.insert(transaction, seed.version);
    for (const template of seed.templates) {
      await fixture.stores.versions.insertTemplate(transaction, template);
    }
    await fixture.stores.instances.insert(transaction, seed.instance);
    for (const step of seed.steps) {
      await fixture.stores.steps.insert(transaction, step);
    }
    for (const entry of seed.history) {
      await fixture.stores.history.insert(transaction, entry);
    }
  };

  const countIn = async (client: PoolLike, table: string): Promise<number> => {
    const { rows } = await client.query<{ total: string }>(
      `select count(*)::text as total from ${table}`,
    );

    return Number(rows[0]?.total ?? '0');
  };

  /**
   * The same guarantee for the two tables Phase 16B added.
   *
   * A group and the people on it are written by one command — three inserts across two tables — and
   * a list that committed without its members would be an approval group that silently asks nobody.
   * The failure is provoked *after* the members, so a repository committing on its own would leave
   * exactly that.
   */
  it('commits a list and its members together, and rolls both back together', async () => {
    const group = aGroup();
    const members = [APPROVER, SECOND_APPROVER].map((membershipId) =>
      aGroupMember(group, membershipId),
    );
    const write = async (transaction: Transaction): Promise<void> => {
      await fixture.stores.groups.insert(transaction, group);
      for (const member of members) {
        await fixture.stores.groups.insertMember(transaction, member);
      }
    };

    await expect(
      inA(async (transaction) => {
        await write(transaction);
        throw new Error('the handler refused after writing');
      }),
    ).rejects.toThrow('the handler refused after writing');

    const gone = await fixture.asTenant(TENANT_A, async (client) => ({
      groups: await countIn(client, 'workflow_approval_group'),
      members: await countIn(client, 'workflow_approval_group_member'),
    }));

    expect(gone).toEqual({ groups: 0, members: 0 });

    await inA(write);

    const committed = await inA((transaction) =>
      fixture.stores.groups.membersOf(transaction, group.approvalGroupId),
    );

    expect(committed).toHaveLength(2);
  });

  it('commits writes across four tables together', async () => {
    const seed = started();

    await inA((transaction) => writeStart(transaction, seed));

    const after = await inA(async (transaction) => ({
      instance: await fixture.stores.instances.byId(transaction, seed.instance.instanceId),
      steps: await fixture.stores.steps.forInstance(transaction, seed.instance.instanceId),
      history: await fixture.stores.history.forInstance(transaction, seed.instance.instanceId, {
        limit: 10,
        offset: 0,
      }),
    }));

    expect(after.instance?.status).toBe('running');
    expect(after.steps).toHaveLength(2);
    expect(after.history.total).toBe(2);
  });

  /**
   * **A rollback leaves nothing behind, including the writes that already succeeded.**
   *
   * This is the assertion that catches a repository quietly opening and committing a transaction of
   * its own. If `definitions.insert` had run in one, the definition would survive the failure of the
   * statement after it and the tenant would be left with a process whose version never existed.
   */
  it('leaves nothing behind when the handler fails after writing', async () => {
    const seed = started();

    await expect(
      inA(async (transaction) => {
        await writeStart(transaction, seed);
        throw new Error('the handler refused after writing');
      }),
    ).rejects.toThrow('the handler refused after writing');

    const remaining = await fixture.asTenant(TENANT_A, async (client) => ({
      definitions: await countIn(client, 'workflow_definition'),
      versions: await countIn(client, 'workflow_version'),
      instances: await countIn(client, 'workflow_instance'),
      steps: await countIn(client, 'workflow_step'),
      history: await countIn(client, 'workflow_history'),
    }));

    expect(remaining).toEqual({
      definitions: 0,
      versions: 0,
      instances: 0,
      steps: 0,
      history: 0,
    });
  });

  /** And the same when the failure is PostgreSQL's own, part-way through a multi-write command. */
  it('rolls back the earlier writes when the database refuses a later statement', async () => {
    const seed = started();

    await expect(
      inA(async (transaction) => {
        await writeStart(transaction, seed);
        // The same instance identifier a second time: the primary key refuses it.
        await fixture.stores.instances.insert(transaction, seed.instance);
      }),
    ).rejects.toThrow();

    const remaining = await fixture.asTenant(TENANT_A, (client) =>
      countIn(client, 'workflow_definition'),
    );

    expect(remaining).toBe(0);
  });

  /**
   * **An append-only row is not exempt from the rollback.**
   *
   * A history entry and a decision are the two rows nothing may amend afterwards, which makes it
   * tempting to write them the moment they are known. If either were written outside the surrounding
   * transaction, a failed approval would leave a permanent, uneditable record that an approver
   * decided something the database then refused — evidence of an act that did not happen, in the one
   * table whose whole purpose is to be trustworthy.
   */
  it('does not let a decision or a history entry survive a failed transaction', async () => {
    const seed = started();

    await inA((transaction) => writeStart(transaction, seed));

    const decided = anApproval(seed);
    const entries = decisionHistory(decided, [uuidV7(), uuidV7()]);

    await expect(
      inA(async (transaction) => {
        await fixture.stores.decisions.insert(transaction, decided.decision);
        for (const entry of entries) {
          await fixture.stores.history.insert(transaction, entry);
        }
        throw new Error('the decision was refused after the records were written');
      }),
    ).rejects.toThrow('the decision was refused after the records were written');

    const after = await inA(async (transaction) => ({
      decisions: await fixture.stores.decisions.forInstance(transaction, seed.instance.instanceId),
      history: await fixture.stores.history.forInstance(transaction, seed.instance.instanceId, {
        limit: 10,
        offset: 0,
      }),
    }));

    expect(after.decisions).toEqual([]);
    // The two entries the start wrote, and neither of the two this transaction attempted.
    expect(after.history.total).toBe(2);
  });

  /**
   * No repository commits an intermediate state.
   *
   * Asserted from **another connection**, part-way through the transaction: a second session sees
   * nothing until the commit. A repository that opened and committed its own transaction would make
   * its row visible here, which is the difference between "both writes are present at the end" — true
   * either way — and "the writes became visible together".
   */
  it('makes nothing visible to another session until the commit', async () => {
    const seed = started();
    const midway = await inA(async (transaction) => {
      await fixture.stores.definitions.insert(transaction, seed.definition);
      await fixture.stores.versions.insert(transaction, seed.version);

      return fixture.onSecondConnection(TENANT_A, (client) =>
        countIn(client, 'workflow_definition'),
      );
    });
    const afterCommit = await fixture.onSecondConnection(TENANT_A, (client) =>
      countIn(client, 'workflow_definition'),
    );

    expect(midway).toBe(0);
    expect(afterCommit).toBe(1);
  });
});
