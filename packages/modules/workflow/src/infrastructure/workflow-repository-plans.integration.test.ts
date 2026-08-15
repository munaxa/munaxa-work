import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DomainEvent, Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openWorkflowFixture,
  requireDatabaseInCi,
  APPROVER,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { aStartedInstance } from './workflow-states.js';

/**
 * The plans of the queries the repositories actually issue.
 *
 * **The statements are captured rather than retyped.** A suite that pasted the SQL beside the
 * repository it came from would be explaining a copy, and would keep passing after the repository's
 * own query changed — which is precisely when a plan assertion is worth having. So a recording
 * `Transaction` sits between the repository and the real one, keeps the statement and its parameters,
 * and the plan is taken from what the repository sent.
 *
 * **`enable_seqscan` is turned off for the plan, and that is a statement about reachability rather
 * than about the planner.** Seven rows in a test table are cheaper to scan than to index, so a plan
 * taken at this size would show a sequential scan however the query and the indexes were written. The
 * question worth asking of a fixture-sized table is *"could this query use its index at all"* — a
 * predicate on the wrong column, a leading key omitted or a partial index whose condition the query
 * cannot satisfy makes the index unreachable at any size, and this is what catches that. It does not
 * claim to predict what the planner will choose against a tenant's real data.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow repository plan suite');

interface Captured {
  readonly statement: string;
  readonly parameters: readonly unknown[];
}

/** Delegates every statement, and keeps what went past. */
const recording = (inner: Transaction, captured: Captured[]): Transaction => ({
  tenantId: inner.tenantId,
  collect: (events: readonly DomainEvent[]): void => {
    inner.collect(events);
  },
  execute: async <TRow>(
    statement: string,
    parameters: readonly unknown[] = [],
  ): Promise<readonly TRow[]> => {
    captured.push({ statement, parameters });
    return inner.execute<TRow>(statement, parameters);
  },
});

suite('repository query plans', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_repo_plans_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();

    const seeds = Array.from({ length: 5 }, (_, index) =>
      aStartedInstance([APPROVER], { subjectId: `requisition-${String(index)}` }),
    );

    await fixture.inTenant(TENANT_A, async (transaction) => {
      for (const seed of seeds) {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        await fixture.stores.instances.insert(transaction, seed.instance);
        for (const step of seed.steps) {
          await fixture.stores.steps.insert(transaction, step);
        }
        for (const entry of seed.history) {
          await fixture.stores.history.insert(transaction, entry);
        }
      }
    });
  });

  /**
   * Runs a repository read, captures its statements, and explains the first one — the page itself
   * rather than the count that follows it.
   */
  const planOf = async (
    read: (transaction: Transaction) => Promise<unknown>,
  ): Promise<{ readonly plan: string; readonly statement: string }> =>
    fixture.inTenant(TENANT_A, async (transaction) => {
      const captured: Captured[] = [];

      await read(recording(transaction, captured));

      const [first] = captured;

      if (first === undefined) throw new Error('The repository issued no statement.');

      await transaction.execute('set local enable_seqscan = off');

      const rows = await transaction.execute<{ 'QUERY PLAN': string }>(
        `explain (costs off) ${first.statement}`,
        first.parameters,
      );

      return { plan: rows.map((row) => row['QUERY PLAN']).join('\n'), statement: first.statement };
    });

  it('reaches the queue index for the approval queue', async () => {
    const explained = await planOf((transaction) =>
      fixture.stores.steps.awaitingFor(transaction, APPROVER, { limit: 20, offset: 0 }),
    );

    expect(explained.plan).toMatch(/workflow_step_queue_idx/);
    expect(explained.plan).not.toMatch(/Seq Scan/);
    // The bound is in the statement, not applied to a fetched list afterwards.
    expect(explained.plan).toMatch(/Limit/);
    expect(explained.statement).toMatch(/limit \$3 offset \$4/);
  });

  it('reaches the status index when instances are searched by status', async () => {
    const explained = await planOf((transaction) =>
      fixture.stores.instances.search(transaction, { status: 'running' }, { limit: 20, offset: 0 }),
    );

    expect(explained.plan).toMatch(/workflow_instance_status_idx/);
    expect(explained.plan).not.toMatch(/Seq Scan/);
  });

  it('reaches the subject index for the duplicate-convergence read', async () => {
    const explained = await planOf((transaction) =>
      fixture.stores.instances.openForSubject(
        transaction,
        'recruitment.requisition',
        'requisition-1',
      ),
    );

    expect(explained.plan).toMatch(/workflow_instance_(subject|open_subject)_idx/);
    expect(explained.plan).not.toMatch(/Seq Scan/);
  });

  /**
   * A lookup by code goes through an index and never through the table.
   *
   * **The index is not named in the assertion, and that is deliberate rather than a weakening.**
   * Two indexes lead with `tenant_id` here — the unique one on `(tenant_id, code)` and the one on
   * `(tenant_id, subject_type, status)` — and at five rows the planner picks the second and filters
   * on `code`, which is a perfectly good plan and not a defect. Pinning the name would be asserting
   * the planner's cost model at fixture size, which this suite says in its own header it will not do.
   * What matters is that the read is confined to the tenant and reaches the table through an index.
   */
  it('reaches an index, within the tenant, when a definition is looked up by code', async () => {
    const explained = await planOf((transaction) =>
      fixture.stores.definitions.byCode(transaction, 'approval-1'),
    );

    expect(explained.plan).toMatch(/Index Scan using workflow_definition_/);
    expect(explained.plan).not.toMatch(/Seq Scan/);
    expect(explained.plan).toMatch(/tenant_id/);
    expect(explained.plan).toMatch(/code/);
  });

  /** One row out of an index, rather than a sort of every version a definition ever had. */
  it('reaches the published index for the current published version, with no sort', async () => {
    const seed = aStartedInstance([APPROVER], { subjectId: 'requisition-plan' });

    await fixture.inTenant(TENANT_A, async (transaction) => {
      await fixture.stores.definitions.insert(transaction, seed.definition);
      await fixture.stores.versions.insert(transaction, seed.version);
    });

    const explained = await planOf((transaction) =>
      fixture.stores.versions.currentPublished(transaction, seed.definition.definitionId),
    );

    expect(explained.plan).toMatch(/workflow_version_published_idx/);
    expect(explained.plan).not.toMatch(/Seq Scan/);
    expect(explained.plan).toMatch(/Limit/);
  });

  it('reaches the timeline index in the order the timeline is read', async () => {
    const [instanceId] = await fixture.inTenant(TENANT_A, async (transaction) => {
      const page = await fixture.stores.instances.search(transaction, {}, { limit: 1, offset: 0 });

      return page.items.map((instance) => instance.instanceId);
    });
    const explained = await planOf((transaction) =>
      fixture.stores.history.forInstance(transaction, instanceId ?? '', { limit: 20, offset: 0 }),
    );

    expect(explained.plan).toMatch(/workflow_history_instance_idx/);
    expect(explained.plan).not.toMatch(/Seq Scan/);
  });

  it('reaches the decider index for what one membership decided', async () => {
    const explained = await planOf((transaction) =>
      fixture.stores.decisions.decidedBy(transaction, APPROVER, { limit: 20, offset: 0 }),
    );

    expect(explained.plan).toMatch(/workflow_decision_decider_idx/);
    expect(explained.plan).not.toMatch(/Seq Scan/);
  });

  /**
   * The row-level policy is in the plan, on every one of them.
   *
   * `app_current_tenant()` is `stable` and inlines, so the policy appears as a `One-Time Filter`
   * evaluated once per statement rather than per row. Its presence is the visible proof that the
   * table is protected — a table whose policy had been forgotten would produce a plan without it
   * while every row assertion elsewhere still passed.
   */
  it('shows the tenant policy in the plan of every read', async () => {
    const plans = await Promise.all([
      planOf((transaction) =>
        fixture.stores.steps.awaitingFor(transaction, APPROVER, { limit: 20, offset: 0 }),
      ),
      planOf((transaction) =>
        fixture.stores.instances.search(transaction, {}, { limit: 20, offset: 0 }),
      ),
      planOf((transaction) => fixture.stores.definitions.byCode(transaction, 'approval-1')),
    ]);

    for (const explained of plans) {
      expect(explained.plan).toMatch(/One-Time Filter|app_current_tenant/);
    }
  });
});
