import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  TENANT_A,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedDefinition, seedInstance } from './workflow-seed.js';

/**
 * The other half of what PostgreSQL arbitrates: a tenant's **configuration**, and the version
 * predicate that decides between two writers of one row.
 *
 * Split from `workflow-concurrency.integration.test.ts` at the file-size budget, along a real seam.
 * Next door asserts the invariants of a *running approval* — one open request per subject, one step
 * awaiting a decision, one decision per step. Here are the rules about what a tenant configured, and
 * the mechanism that is not an index at all: an `update ... where version = $n` that matches no row.
 *
 * The three outcomes stay distinguishable, which is the point of the last test. A **unique
 * conflict** says somebody wrote this already; an **optimistic conflict** says somebody moved it
 * since you read it; a **check refusal** says what you asked for is not a legal state. A repository
 * that mapped all three to one exception would leave a caller unable to tell which happened.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's uniqueness and versioning suite");

suite('what the database arbitrates about configuration and versions', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_uniqueness_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** One statement batch on the chosen connection, bound rather than detached from the fixture. */
  const on = <TResult>(
    connection: 'first' | 'second',
    tenantId: string,
    work: (client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0]) => Promise<TResult>,
  ): Promise<TResult> =>
    connection === 'first'
      ? fixture.asTenant(tenantId, work)
      : fixture.onSecondConnection(tenantId, work);

  describe('configuration uniqueness', () => {
    it('refuses a duplicate definition code and permits a different one', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        await seedDefinition(client, TENANT_A, [APPROVER], 'shared-code');

        return {
          duplicate: await probe(
            client,
            `insert into workflow_definition (tenant_id, code, name, subject_type, status,
               ${AUDIT_COLUMNS})
             values ($1, 'shared-code', '{"en":"x","ar":"x"}'::jsonb, $2, 'active',
                     ${AUDIT_VALUES})`,
            [TENANT_A, SUBJECT_TYPE],
          ),
          distinct: await probe(
            client,
            `insert into workflow_definition (tenant_id, code, name, subject_type, status,
               ${AUDIT_COLUMNS})
             values ($1, 'other-code', '{"en":"x","ar":"x"}'::jsonb, $2, 'active',
                     ${AUDIT_VALUES})`,
            [TENANT_A, SUBJECT_TYPE],
          ),
        };
      });

      expect(outcomes.duplicate).toContain('workflow_definition_code_idx');
      expect(outcomes.distinct).toBe('accepted');
    });

    it('refuses two steps at the same ordinal in one version, and permits the next ordinal', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const add = (ordinal: number): Promise<string> =>
          probe(
            client,
            `insert into workflow_step_template
               (tenant_id, workflow_version_id, ordinal, name, approver_kind,
                approver_membership_id, ${AUDIT_COLUMNS})
             values ($1, $2, $3, '{"en":"x","ar":"x"}'::jsonb, 'membership', $4, ${AUDIT_VALUES})`,
            [TENANT_A, seeded.workflowVersionId, ordinal, SECOND_APPROVER],
          );

        return { duplicate: await add(1), next: await add(2) };
      });

      expect(outcomes.duplicate).toContain('workflow_step_template_ordinal_idx');
      expect(outcomes.next).toBe('accepted');
    });

    it('refuses a duplicate version number and permits the next', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const add = (number: number): Promise<string> =>
          probe(
            client,
            `insert into workflow_version
               (tenant_id, definition_id, version_number, status, ${AUDIT_COLUMNS})
             values ($1, $2, $3, 'draft', ${AUDIT_VALUES})`,
            [TENANT_A, seeded.definitionId, number],
          );

        return { duplicate: await add(1), next: await add(2) };
      });

      expect(outcomes.duplicate).toContain('workflow_version_number_idx');
      expect(outcomes.next).toBe('accepted');
    });
  });

  describe('optimistic concurrency, kept distinct from the others', () => {
    it('lets the first writer win and leaves the stale writer changing nothing', async () => {
      const seeded = await fixture.asTenant(TENANT_A, (client) =>
        seedInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER]),
      );
      // Both read version 1 and both write against it. The predicate is what decides, not the order.
      const move = (status: string, connection: 'first' | 'second'): Promise<number> =>
        on(connection, TENANT_A, async (client) => {
          const { rowCount } = await client.query(
            `update workflow_step set status = $1, version = version + 1
              where id = $2 and version = 1`,
            [status, seeded.stepIds[0]],
          );

          return rowCount ?? 0;
        });
      const [first, second] = await Promise.all([
        move('approved', 'first'),
        move('rejected', 'second'),
      ]);

      // One row updated, one row not. A stale writer is not an error at the database — it is zero
      // rows, and turning that into a named `ConcurrencyException` is the repository's job.
      expect([first, second].sort()).toStrictEqual([0, 1]);

      const after = await fixture.asTenant(TENANT_A, (client) =>
        client.query<{ version: number }>(`select version from workflow_step where id = $1`, [
          seeded.stepIds[0],
        ]),
      );

      // Incremented exactly once, whichever writer won.
      expect(after.rows[0]?.version).toBe(2);
    });

    it('is a different outcome from a unique conflict and from a check refusal', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);
        const stale = await client.query(
          `update workflow_step set version = version + 1 where id = $1 and version = 99`,
          [seeded.stepIds[0]],
        );

        return {
          stale: stale.rowCount ?? 0,
          unique: await probe(
            client,
            `insert into workflow_instance
               (tenant_id, definition_id, workflow_version_id, subject_type, subject_id,
                requested_by_membership_id, status, started_at, correlation_id, ${AUDIT_COLUMNS})
             values ($1, $2, $3, $4, 'requisition-1', $5, 'running', now(), gen_random_uuid(),
                     ${AUDIT_VALUES})`,
            [TENANT_A, seeded.definitionId, seeded.workflowVersionId, SUBJECT_TYPE, REQUESTER],
          ),
          check: await probe(client, `update workflow_step set status = 'invented' where id = $1`, [
            seeded.stepIds[0],
          ]),
        };
      });

      // Three distinct signals: no rows, an index name, a constraint name.
      expect(outcomes.stale).toBe(0);
      expect(outcomes.unique).toContain('workflow_instance_open_subject_idx');
      expect(outcomes.check).toContain('workflow_step_status_check');
    });
  });

  it('lets two genuinely non-conflicting writes both succeed', async () => {
    const seeded = await fixture.asTenant(TENANT_A, (client) =>
      seedInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER]),
    );
    const [first, second] = await Promise.all([
      fixture.asTenant(TENANT_A, (client) =>
        probe(client, `update workflow_step set metadata = '{"a":1}'::jsonb where id = $1`, [
          seeded.stepIds[0],
        ]),
      ),
      fixture.onSecondConnection(TENANT_A, (client) =>
        probe(client, `update workflow_step set metadata = '{"b":1}'::jsonb where id = $1`, [
          seeded.stepIds[1],
        ]),
      ),
    ]);

    expect([first, second]).toStrictEqual(['accepted', 'accepted']);
  });
});
