import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConcurrencyException, TenantIsolationException } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  APPROVER,
  SECOND_APPROVER,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { LATER, aStartedInstance } from './workflow-states.js';

/**
 * Tenant isolation, **through the repositories**.
 *
 * Checkpoint 3's isolation suite asserted that the policies refuse raw SQL. This one asserts the
 * other half: that the queries the application actually issues cannot reach another tenant's rows —
 * not by exact identifier, not through a page, not through a total, and not through an update.
 *
 * Both halves are needed and neither substitutes for the other. A repository could carry a correct
 * `tenant_id` predicate over a table with no policy at all and pass every assertion here, which is
 * why the raw probes exist; and a policy could be correct while a repository forgot its predicate on
 * one query, which is why these do. The role these run as owns nothing and holds no `BYPASSRLS`, so
 * the policy is genuinely in force — a suite run as a superuser would report isolation it never
 * checked.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow repository isolation suite');

suite('repository tenant isolation', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_repo_isolation_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const write = async (
    tenantId: string,
    seed: ReturnType<typeof aStartedInstance>,
  ): Promise<void> => {
    await fixture.inTenant(tenantId, async (transaction) => {
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
    });
  };

  /** One approval in each tenant, on the same subject and the same approver. */
  const inBothTenants = async (): Promise<{
    a: ReturnType<typeof aStartedInstance>;
    b: ReturnType<typeof aStartedInstance>;
  }> => {
    const a = aStartedInstance([APPROVER, SECOND_APPROVER]);
    const b = aStartedInstance([APPROVER, SECOND_APPROVER]);

    await write(TENANT_A, a);
    await write(TENANT_B, b);
    return { a, b };
  };

  describe('reads', () => {
    it('refuses an exact identifier belonging to the other tenant, in both directions', async () => {
      const seeded = await inBothTenants();
      const fromA = await fixture.inTenant(TENANT_A, async (transaction) => ({
        own: await fixture.stores.instances.byId(transaction, seeded.a.instance.instanceId),
        other: await fixture.stores.instances.byId(transaction, seeded.b.instance.instanceId),
      }));
      const fromB = await fixture.inTenant(TENANT_B, async (transaction) => ({
        own: await fixture.stores.instances.byId(transaction, seeded.b.instance.instanceId),
        other: await fixture.stores.instances.byId(transaction, seeded.a.instance.instanceId),
      }));

      expect(fromA.own?.instanceId).toBe(seeded.a.instance.instanceId);
      expect(fromA.other).toBeUndefined();
      expect(fromB.own?.instanceId).toBe(seeded.b.instance.instanceId);
      expect(fromB.other).toBeUndefined();
    });

    /** Every by-identifier read on every store, so no repository is isolated only by accident. */
    it('refuses the other tenant’s rows on every by-identifier read', async () => {
      const seeded = await inBothTenants();
      const [otherStep] = seeded.b.steps;
      const crossed = await fixture.inTenant(TENANT_A, async (transaction) => ({
        definition: await fixture.stores.definitions.byId(
          transaction,
          seeded.b.definition.definitionId,
        ),
        byCode: await fixture.stores.definitions.byCode(transaction, seeded.b.definition.code),
        version: await fixture.stores.versions.byId(
          transaction,
          seeded.b.version.workflowVersionId,
        ),
        templates: await fixture.stores.versions.templatesFor(
          transaction,
          seeded.b.version.workflowVersionId,
        ),
        published: await fixture.stores.versions.currentPublished(
          transaction,
          seeded.b.definition.definitionId,
        ),
        step: await fixture.stores.steps.byId(transaction, otherStep?.stepId ?? ''),
        steps: await fixture.stores.steps.forInstance(transaction, seeded.b.instance.instanceId),
        decisions: await fixture.stores.decisions.forInstance(
          transaction,
          seeded.b.instance.instanceId,
        ),
      }));

      expect(crossed.definition).toBeUndefined();
      expect(crossed.byCode).toBeUndefined();
      expect(crossed.version).toBeUndefined();
      expect(crossed.published).toBeUndefined();
      expect(crossed.step).toBeUndefined();
      expect(crossed.templates).toEqual([]);
      expect(crossed.steps).toEqual([]);
      expect(crossed.decisions).toEqual([]);
    });

    /**
     * **A total is as much a disclosure as a row.**
     *
     * "You have 40 approvals waiting" computed over two tenants tells one tenant how busy another is,
     * and it is the failure a page-level predicate with a tenant-free count would produce. The count
     * runs the same `where` as the page, and this is what proves it.
     */
    it('counts only the acting tenant’s rows in every page total', async () => {
      await inBothTenants();
      const totals = await fixture.inTenant(TENANT_A, async (transaction) => ({
        definitions: (
          await fixture.stores.definitions.search(transaction, {}, { limit: 50, offset: 0 })
        ).total,
        instances: (
          await fixture.stores.instances.search(transaction, {}, { limit: 50, offset: 0 })
        ).total,
        queue: (
          await fixture.stores.steps.awaitingFor(transaction, APPROVER, { limit: 50, offset: 0 })
        ).total,
      }));

      expect(totals).toEqual({ definitions: 1, instances: 1, queue: 1 });
    });

    /** The queue is the busiest read in the module, and the one an approver's name spans tenants on. */
    it('serves an approver only the steps of the tenant they are acting in', async () => {
      const seeded = await inBothTenants();
      const queue = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.steps.awaitingFor(transaction, APPROVER, { limit: 50, offset: 0 }),
      );

      expect(queue.total).toBe(1);
      expect(queue.items[0]?.instanceId).toBe(seeded.b.instance.instanceId);
    });

    /** And the same for the timeline, which is paged and would otherwise leak through its total. */
    it('returns an empty timeline for another tenant’s instance', async () => {
      const seeded = await inBothTenants();
      const page = await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.history.forInstance(transaction, seeded.b.instance.instanceId, {
          limit: 50,
          offset: 0,
        }),
      );

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });
  });

  describe('writes', () => {
    /**
     * An update aimed at another tenant's row changes nothing, and says so.
     *
     * `Repository.updateRow` puts the identifier, the tenant and the version in the `where` clause,
     * and raises `ConcurrencyException` when no row matched. The policy refuses the row as well —
     * which is the point: the predicate and the policy each refuse it on their own.
     */
    it('cannot update another tenant’s instance', async () => {
      const seeded = await inBothTenants();

      await expect(
        fixture.inTenant(TENANT_A, (transaction) =>
          fixture.stores.instances.update(
            transaction,
            { ...seeded.b.instance, status: 'cancelled', completedAt: LATER },
            seeded.b.instance.version,
          ),
        ),
      ).rejects.toThrow(ConcurrencyException);

      const untouched = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.instances.byId(transaction, seeded.b.instance.instanceId),
      );

      expect(untouched?.status).toBe('running');
      expect(untouched?.version).toBe(1);
    });

    /**
     * **A row cannot be written into another tenant.**
     *
     * Not because a repository declines to, but because it has no way to express it: every `*Values`
     * mapper takes `transaction.tenantId`, and the transaction's tenant comes from the ambient
     * context rather than from anything a caller supplies. There is no parameter on any store through
     * which a tenant identifier could be passed.
     */
    it('writes into the acting tenant and nowhere else', async () => {
      const seed = aStartedInstance([APPROVER]);

      await write(TENANT_A, seed);

      const elsewhere = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.definitions.byId(transaction, seed.definition.definitionId),
      );

      expect(elsewhere).toBeUndefined();
    });

    /**
     * A tenant cannot be moved, because no update statement carries the column.
     *
     * `mutable()` removes `id` and `tenant_id` from every update, so re-tenanting a row is not a
     * refusal at run time but an absence at compile time. The policy's `with check` refuses it as
     * well, which Checkpoint 3's suite asserts against raw SQL.
     */
    it('never includes the tenant column in an update', async () => {
      const seed = aStartedInstance([APPROVER]);

      await write(TENANT_A, seed);
      await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.instances.update(
          transaction,
          {
            ...seed.instance,
            status: 'cancelled',
            completedAt: LATER,
            cancelledBy: 'user:x',
            cancellationReason: 'withdrawn',
          },
          seed.instance.version,
        ),
      );

      const stillThere = await fixture.inTenant(TENANT_A, (transaction) =>
        fixture.stores.instances.byId(transaction, seed.instance.instanceId),
      );

      expect(stillThere?.status).toBe('cancelled');
      expect(stillThere?.version).toBe(2);
    });
  });

  /**
   * With no tenant context at all, nothing runs.
   *
   * The unit of work resolves the tenant from the ambient context and refuses to open a transaction
   * without one, so a repository is never reached. That refusal is what makes "every read is
   * tenant-scoped" true of code that forgot rather than only of code that remembered.
   */
  it('refuses to open a transaction with no tenant context', async () => {
    await expect(
      fixture.unitOfWork.execute((transaction) =>
        fixture.stores.definitions.search(transaction, {}, { limit: 1, offset: 0 }),
      ),
    ).rejects.toThrow(TenantIsolationException);
  });

  /**
   * And the policy, not the predicate, is what stops a query that omits the tenant.
   *
   * Issued as raw SQL through the unprivileged role because no repository would write it — which is
   * exactly why it has to be asserted separately. A table whose policy had been forgotten would
   * return both tenants' rows here while every assertion above still passed.
   */
  it('returns only the acting tenant’s rows to a query with no tenant predicate', async () => {
    await inBothTenants();

    const seen = await fixture.asTenant(TENANT_A, async (client) => {
      const { rows } = await client.query<{ tenant_id: string }>(
        `select distinct tenant_id from workflow_instance`,
      );

      return rows.map((row) => row.tenant_id);
    });

    expect(seen).toEqual([TENANT_A]);
  });
});
