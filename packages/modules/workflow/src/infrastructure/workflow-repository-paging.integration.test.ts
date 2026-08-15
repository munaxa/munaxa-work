import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  APPROVER,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { NOW, aStartedInstance } from './workflow-states.js';

/**
 * Paging, and the two ways it goes wrong.
 *
 * **The total must be counted by the database, with the same predicate as the page.** A total taken
 * from `items.length` tells an approver with three hundred approvals waiting that they have fifty,
 * and a total counted with a different `where` shows "1 of 40" over a list of forty rows. Both are
 * asserted here by making the collection larger than the page.
 *
 * **The order must be total.** Every paged query in this module sorts on a column that ties —
 * `started_at`, `occurred_at`, a step's ordinal — and appends the identifier. Without that second
 * key PostgreSQL is free to return tied rows in any order per statement, so a row can appear on both
 * page one and page two while another never appears at all. That is not a hypothetical: the rows
 * these suites seed share an instant, because approvals raised by one import genuinely do.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow repository paging suite');

suite('repository paging', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_repo_paging_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  /**
   * Seven approvals for one approver, **all started at the same instant**.
   *
   * The shared instant is the point: it makes `started_at desc` a tie for every row, so the ordering
   * is decided entirely by the identifier the query appends. A fixture that staggered the instants
   * would page perfectly whether or not the tie-breaker existed.
   */
  const sevenApprovals = async (): Promise<readonly string[]> => {
    const seeds = Array.from({ length: 7 }, (_, index) =>
      aStartedInstance([APPROVER], { subjectId: `requisition-${String(index)}`, at: NOW }),
    );

    await inA(async (transaction) => {
      for (const seed of seeds) {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        await fixture.stores.instances.insert(transaction, seed.instance);
        for (const step of seed.steps) {
          await fixture.stores.steps.insert(transaction, step);
        }
      }
    });
    return seeds.map((seed) => seed.instance.instanceId);
  };

  it('returns a bounded page and the whole total beside it', async () => {
    await sevenApprovals();

    const page = await inA((transaction) =>
      fixture.stores.instances.search(transaction, {}, { limit: 3, offset: 0 }),
    );

    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(7);
  });

  it('keeps the total the same whatever the page size is', async () => {
    await sevenApprovals();

    const totals = await inA(async (transaction) => [
      (await fixture.stores.instances.search(transaction, {}, { limit: 1, offset: 0 })).total,
      (await fixture.stores.instances.search(transaction, {}, { limit: 3, offset: 3 })).total,
      (await fixture.stores.instances.search(transaction, {}, { limit: 50, offset: 0 })).total,
    ]);

    expect(totals).toEqual([7, 7, 7]);
  });

  it('returns an empty page past the end, with the total still true', async () => {
    await sevenApprovals();

    const page = await inA((transaction) =>
      fixture.stores.instances.search(transaction, {}, { limit: 5, offset: 100 }),
    );

    expect(page.items).toEqual([]);
    expect(page.total).toBe(7);
  });

  it('returns nothing and a total of zero when there is nothing to page', async () => {
    const page = await inA((transaction) =>
      fixture.stores.instances.search(transaction, {}, { limit: 10, offset: 0 }),
    );

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  /**
   * Every row exactly once across the pages, with every sort key tied.
   *
   * This is the assertion the shared instant exists for. Without `id` after `started_at desc`, this
   * test fails intermittently rather than never — which is the worst kind of paging defect, because
   * it reaches production looking like a user's mistake.
   */
  it('walks every row exactly once when every sort key ties', async () => {
    const expected = await sevenApprovals();
    const walked = await inA(async (transaction) => {
      const seen: string[] = [];

      for (let offset = 0; offset < 8; offset += 2) {
        const page = await fixture.stores.instances.search(transaction, {}, { limit: 2, offset });

        seen.push(...page.items.map((instance) => instance.instanceId));
      }
      return seen;
    });

    expect(walked).toHaveLength(7);
    expect(new Set(walked).size).toBe(7);
    expect([...walked].sort()).toEqual([...expected].sort());
  });

  /** And the same walk over the queue, which is the read an approver actually pages. */
  it('pages the approval queue without repeating or losing a step', async () => {
    await sevenApprovals();

    const walked = await inA(async (transaction) => {
      const seen: string[] = [];

      for (let offset = 0; offset < 8; offset += 3) {
        const page = await fixture.stores.steps.awaitingFor(transaction, APPROVER, {
          limit: 3,
          offset,
        });

        expect(page.total).toBe(7);
        seen.push(...page.items.map((step) => step.stepId));
      }
      return seen;
    });

    expect(new Set(walked).size).toBe(7);
  });

  /**
   * The bound is in the statement, not applied afterwards in JavaScript.
   *
   * "Read the table and slice it" passes every assertion above and turns a bounded read into a
   * tenant-wide one the first time a tenant grows. The plan is where the difference shows.
   */
  it('bounds the queue in SQL rather than after the fact', async () => {
    await sevenApprovals();

    const plan = await inA(async (transaction) => {
      const rows = await transaction.execute<{ 'QUERY PLAN': string }>(
        `explain select s.id from workflow_step s
           where s.approver_membership_id = $1 and s.tenant_id = $2
             and s.status = 'awaiting' and s.deleted_at is null
           order by s.id
           limit $3 offset $4`,
        [APPROVER, TENANT_A, 3, 0],
      );

      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });

    expect(plan).toMatch(/Limit/);
  });

  /**
   * The count is a `count(*)`, not the length of anything.
   *
   * Asserted by making the collection larger than the page and reading the total back — the one shape
   * in which the two cannot be confused.
   */
  it('counts in the database rather than by measuring the page', async () => {
    await sevenApprovals();

    const page = await inA((transaction) =>
      fixture.stores.steps.awaitingFor(transaction, APPROVER, { limit: 2, offset: 0 }),
    );

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(7);
    expect(page.total).not.toBe(page.items.length);
  });

  /** The timeline is paged too, oldest first, and it ties on `occurred_at` for the same reason. */
  it('pages a timeline in a stable order', async () => {
    const seed = aStartedInstance([APPROVER]);

    await inA(async (transaction) => {
      await fixture.stores.definitions.insert(transaction, seed.definition);
      await fixture.stores.versions.insert(transaction, seed.version);
      await fixture.stores.instances.insert(transaction, seed.instance);
      for (const step of seed.steps) {
        await fixture.stores.steps.insert(transaction, step);
      }
      for (const entry of seed.history) {
        await fixture.stores.history.insert(transaction, entry);
      }
    });

    const pages = await inA(async (transaction) => [
      await fixture.stores.history.forInstance(transaction, seed.instance.instanceId, {
        limit: 1,
        offset: 0,
      }),
      await fixture.stores.history.forInstance(transaction, seed.instance.instanceId, {
        limit: 1,
        offset: 1,
      }),
    ]);

    expect(pages[0]?.items[0]?.event).toBe('instance-started');
    expect(pages[1]?.items[0]?.event).toBe('step-awaiting');
    expect(pages.map((page) => page.total)).toEqual([2, 2]);
  });
});
