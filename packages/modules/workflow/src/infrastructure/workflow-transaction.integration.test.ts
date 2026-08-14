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
  WORKFLOW_TABLES,
  openWorkflowFixture,
  requireDatabaseInCi,
  type PoolLike,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedDefinition } from './workflow-seed.js';

/**
 * Transaction semantics, proved at the schema before any repository depends on them.
 *
 * Starting an approval is not one write. It is an instance, a step per template and two history
 * entries, and **either all of them exist or none does** — an instance with no steps can never
 * complete, and a step with no instance is a queue entry for an approval nobody raised. The
 * repositories that arrive at Checkpoint 5 will not open transactions of their own;
 * `PostgresUnitOfWork` opens one and the use case owns it. What this suite establishes is that
 * PostgreSQL will hold up its end.
 *
 * The deliberate failure is a **real constraint violation** rather than a thrown JavaScript error,
 * because that is the failure mode that actually happens: the fourth statement in a multi-write
 * command hits an index, and everything before it has to disappear.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's transaction suite");

const startInstance = async (
  client: PoolLike,
  seeded: { readonly definitionId: string; readonly workflowVersionId: string },
  subjectId: string,
): Promise<string> => {
  const { rows } = await client.query<{ id: string }>(
    `insert into workflow_instance
       (tenant_id, definition_id, workflow_version_id, subject_type, subject_id,
        requested_by_membership_id, status, started_at, correlation_id, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4, $5, $6, 'running', now(), gen_random_uuid(), ${AUDIT_VALUES})
     returning id`,
    [TENANT_A, seeded.definitionId, seeded.workflowVersionId, SUBJECT_TYPE, subjectId, REQUESTER],
  );
  const [row] = rows;

  if (row === undefined) throw new Error('No instance was written.');
  return row.id;
};

const addStep = (
  client: PoolLike,
  instanceId: string,
  ordinal: number,
  status: string,
  approver: string,
): Promise<unknown> =>
  client.query(
    `insert into workflow_step
       (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
        ${AUDIT_COLUMNS})
     values ($1, $2, $3, 'membership', $4, $5, ${AUDIT_VALUES})`,
    [TENANT_A, instanceId, ordinal, approver, status],
  );

const countEverything = async (fixture: WorkflowFixture): Promise<Record<string, number>> => {
  const counted: Record<string, number> = {};

  for (const table of WORKFLOW_TABLES) {
    counted[table] = await fixture.asTenant(TENANT_A, async (client) => {
      const { rows } = await client.query<{ total: string }>(
        `select count(*)::text as total from ${table}`,
      );

      return Number(rows[0]?.total ?? '-1');
    });
  }
  return counted;
};

suite('Workflow transaction semantics', () => {
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

  it('commits every write of a successful multi-statement start', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedDefinition(client, TENANT_A, [APPROVER, SECOND_APPROVER]);
      const instanceId = await startInstance(client, seeded, 'requisition-committed');

      await addStep(client, instanceId, 1, 'awaiting', APPROVER);
      await addStep(client, instanceId, 2, 'pending', SECOND_APPROVER);
      await client.query(
        `insert into workflow_history (tenant_id, instance_id, event, occurred_at,
           actor_membership_id, ${AUDIT_COLUMNS})
         values ($1, $2, 'instance-started', now(), $3, ${AUDIT_VALUES})`,
        [TENANT_A, instanceId, REQUESTER],
      );
    });

    const counted = await countEverything(fixture);

    expect([
      counted['workflow_instance'],
      counted['workflow_step'],
      counted['workflow_history'],
    ]).toStrictEqual([1, 2, 1]);
  });

  it('leaves nothing behind when a later write is refused', async () => {
    const failure = await fixture
      .asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A, [APPROVER, SECOND_APPROVER]);
        const instanceId = await startInstance(client, seeded, 'requisition-rolled-back');

        await addStep(client, instanceId, 1, 'awaiting', APPROVER);
        // The failure a real command hits: a second step written as `awaiting` before the first
        // left it. `workflow_step_awaiting_idx` refuses, and everything above must disappear.
        await addStep(client, instanceId, 2, 'awaiting', SECOND_APPROVER);
        return 'accepted';
      })
      .catch((error: unknown) => (error instanceof Error ? error.message : 'unknown'));

    expect(failure).toContain('workflow_step_awaiting_idx');

    // Not "the instance is gone" — *nothing* is. The definition and version written first are as
    // absent as the step that failed, which is what atomic means and what a partial rollback would
    // quietly not do.
    const counted = await countEverything(fixture);

    expect(Object.values(counted)).toStrictEqual(WORKFLOW_TABLES.map(() => 0));
  });

  it('rolls back an append-only write alongside the rest', async () => {
    // A history entry cannot be deleted afterwards, so if a failing transaction left one behind
    // there would be no way to remove it — the timeline of an approval that never started.
    const failure = await fixture
      .asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const instanceId = await startInstance(client, seeded, 'requisition-history');

        await client.query(
          `insert into workflow_history (tenant_id, instance_id, event, occurred_at,
             ${AUDIT_COLUMNS})
           values ($1, $2, 'instance-started', now(), ${AUDIT_VALUES})`,
          [TENANT_A, instanceId],
        );
        await client.query(
          `insert into workflow_history (tenant_id, instance_id, event, occurred_at, ordinal,
             ${AUDIT_COLUMNS})
           values ($1, $2, 'step-approved', now(), 1, ${AUDIT_VALUES})`,
          [TENANT_A, instanceId],
        );
        return 'accepted';
      })
      .catch((error: unknown) => (error instanceof Error ? error.message : 'unknown'));

    expect(failure).toContain('workflow_history_step_check');

    const counted = await countEverything(fixture);

    expect([counted['workflow_history'], counted['workflow_instance']]).toStrictEqual([0, 0]);
  });

  it('holds the tenant setting transaction-locally, so a pooled connection carries nothing over', async () => {
    // The property every isolation assertion rests on. `set_config(..., true)` is transaction-local,
    // and a fixture or a repository that set it session-wide would leak one tenant's context into
    // the next caller's work on the same pooled connection.
    await fixture.asTenant(TENANT_A, (client) => seedDefinition(client, TENANT_A));

    const leaked = await fixture.withoutTenant(async (client) => {
      const { rows } = await client.query<{ tenant: string | null }>(
        `select app_current_tenant()::text as tenant`,
      );

      return rows[0]?.tenant;
    });

    expect(leaked).toBeNull();
  });
});
