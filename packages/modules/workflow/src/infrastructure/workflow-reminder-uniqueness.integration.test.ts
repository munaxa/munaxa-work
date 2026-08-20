import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ExecutionProvenance } from '../domain/history.js';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type PoolLike,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedInstance } from './workflow-seed.js';
import { racingOn } from './workflow-race.fixture.js';

/**
 * One reminder per step, and one tenant's reminders, arbitrated by PostgreSQL.
 *
 * The sibling suite proves the event is accepted, the provenance round-trips and the constraints make
 * an impersonating row unrepresentable. This one proves the two properties that only a real database
 * with two real connections can establish: that the partial unique index — not a preceding read — is
 * what makes one reminder per step true, and that row-level security applies to an automatic entry
 * exactly as it does to a human one.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's automatic reminder suite");

const INDEX = 'workflow_history_reminder_idx';
const AT = new Date('2026-08-20T11:00:00.000Z');

const PROVENANCE: ExecutionProvenance = {
  executionIdentity: 'service:workflow-reminders',
  correlationId: '01930000-0000-7000-8000-00000000c001',
  jobId: 'job-0001',
  attempt: 1,
};

/** A reminder row, written exactly as the handler writes one. */
const insertReminder = (
  client: PoolLike,
  row: {
    readonly tenantId: string;
    readonly instanceId: string;
    readonly stepId: string;
    readonly ordinal?: number;
    readonly execution?: ExecutionProvenance;
    readonly actorMembershipId?: string;
    readonly event?: string;
  },
) =>
  probe(
    client,
    `insert into workflow_history
       (tenant_id, instance_id, event, occurred_at, step_id, ordinal, actor_membership_id,
        execution_identity, execution_correlation_id, execution_job_id, execution_attempt,
        metadata, ${AUDIT_COLUMNS})
     values ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11, '{}'::jsonb, ${AUDIT_VALUES})`,
    [
      row.tenantId,
      row.instanceId,
      row.event ?? 'step-reminded',
      AT.toISOString(),
      row.stepId,
      row.ordinal ?? 1,
      row.actorMembershipId ?? null,
      row.execution === undefined ? null : row.execution.executionIdentity,
      row.execution === undefined ? null : row.execution.correlationId,
      row.execution?.jobId ?? null,
      row.execution?.attempt ?? null,
    ],
  );

suite('one reminder per step, arbitrated by PostgreSQL', () => {
  let fixture: WorkflowFixture;
  let instanceId: string;
  let stepIds: readonly string[];

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_reminder_uniqueness_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);

    instanceId = seeded.instanceId;
    stepIds = seeded.stepIds;
  });

  const remind = (client: PoolLike, step: string, tenantId = TENANT_A, instance = instanceId) =>
    insertReminder(client, { tenantId, instanceId: instance, stepId: step, execution: PROVENANCE });

  it('accepts one reminder and refuses a second by the index that forbids it', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await remind(client, stepIds[0] ?? '')).toBe('accepted');

      const refused = await remind(client, stepIds[0] ?? '');

      expect(refused).toContain(INDEX);
      expect(refused).toContain('duplicate key');
    });
  });

  /**
   * The partial half, proved from the side that would break if it were missing.
   *
   * Several `step-awaiting` entries legitimately share one step, and a non-partial index would refuse
   * the second — a new rule about ordinary history as a side effect of a phase about reminders.
   */
  it('still allows the other events to repeat on one step', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      const shape = {
        tenantId: TENANT_A,
        instanceId,
        stepId: stepIds[0] ?? '',
        event: 'step-awaiting',
      };

      expect(await insertReminder(client, shape)).toBe('accepted');
      expect(await insertReminder(client, shape)).toBe('accepted');
    });
  });

  it('allows a different step of the same approval its own reminder', async () => {
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER], 'requisition-2');

    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await remind(client, stepIds[0] ?? '')).toBe('accepted');
      expect(await remind(client, seeded.stepIds[0] ?? '', TENANT_A, seeded.instanceId)).toBe(
        'accepted',
      );
    });
  });

  /**
   * The tenant leads the key, and this is what that buys: without it, one tenant's reminder would
   * suppress another's for a step identifier neither can read.
   */
  it('allows the same step identifier in a different tenant', async () => {
    const theirs = await seedInstance(fixture.admin, TENANT_B, [APPROVER]);

    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await remind(client, stepIds[0] ?? '')).toBe('accepted');
    });
    await fixture.asTenant(TENANT_B, async (client) => {
      expect(await remind(client, theirs.stepIds[0] ?? '', TENANT_B, theirs.instanceId)).toBe(
        'accepted',
      );
    });
  });

  /**
   * **Two real connections, overlapping in time.** No sleeps, and no helper that runs one after the
   * other and calls it a race: the second transaction is opened while the first still holds its
   * write, and PostgreSQL decides the outcome.
   *
   * Exactly one commits. The loser takes a unique violation, which aborts its whole transaction — so
   * there is no partial effect to compensate and no second notification intent, because the intent is
   * emitted only after the claim has committed.
   */
  it('lets exactly one of two concurrent workers claim the reminder', async () => {
    const racing = racingOn(fixture, fixture.secondUnitOfWork());
    const step = stepIds[0] ?? '';

    const outcomes = await racing.race(
      async (transaction) => {
        await transaction.execute(
          `insert into workflow_history
             (tenant_id, instance_id, event, occurred_at, step_id, ordinal, execution_identity,
              execution_correlation_id, metadata, ${AUDIT_COLUMNS})
           values ($1, $2, 'step-reminded', now(), $3, 1, 'service:first', 'c-1', '{}'::jsonb,
                   ${AUDIT_VALUES})`,
          [TENANT_A, instanceId, step],
        );
      },
      async (transaction) => {
        await transaction.execute(
          `insert into workflow_history
             (tenant_id, instance_id, event, occurred_at, step_id, ordinal, execution_identity,
              execution_correlation_id, metadata, ${AUDIT_COLUMNS})
           values ($1, $2, 'step-reminded', now(), $3, 1, 'service:second', 'c-2', '{}'::jsonb,
                   ${AUDIT_VALUES})`,
          [TENANT_A, instanceId, step],
        );
      },
    );

    expect(outcomes.first).toBe('committed');
    expect(outcomes.second).toBe(`duplicate:${INDEX}`);

    // One row, and it is the winner's — so the loser wrote nothing at all.
    const rows = await fixture.admin.query<{ count: string; who: string }>(
      `select count(*)::text as count, min(execution_identity) as who
         from workflow_history where event = 'step-reminded' and tenant_id = $1`,
      [TENANT_A],
    );

    expect(rows.rows[0]?.count).toBe('1');
    expect(rows.rows[0]?.who).toBe('service:first');
  });
});

suite('row-level security over an automatic entry', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_reminder_rls_role');
  }, 30_000);

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /**
   * An automatic entry is a tenant's row like any other. A machine execution is not a reason to see
   * across a tenant boundary, and the policy does not know or care that a machine wrote it.
   */
  it('is visible in its own tenant and invisible in another', async () => {
    const ours = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);
    const theirs = await seedInstance(fixture.admin, TENANT_B, [APPROVER]);

    await fixture.asTenant(TENANT_A, async (client) => {
      await insertReminder(client, {
        tenantId: TENANT_A,
        instanceId: ours.instanceId,
        stepId: ours.stepIds[0] ?? '',
        execution: PROVENANCE,
      });
    });
    await fixture.asTenant(TENANT_B, async (client) => {
      await insertReminder(client, {
        tenantId: TENANT_B,
        instanceId: theirs.instanceId,
        stepId: theirs.stepIds[0] ?? '',
        execution: PROVENANCE,
      });
    });

    const seenByA = await fixture.asTenant(TENANT_A, (client) =>
      client.query<{ count: string }>(
        `select count(*)::text as count from workflow_history where event = 'step-reminded'`,
        [],
      ),
    );

    expect(seenByA.rows[0]?.count).toBe('1');

    // And both exist, so the "1" above is a policy filtering rather than a row never written.
    const all = await fixture.admin.query<{ count: string }>(
      `select count(*)::text as count from workflow_history where event = 'step-reminded'`,
      [],
    );

    expect(all.rows[0]?.count).toBe('2');
  });

  /** A tenant cannot write an automatic entry into another tenant's rows either. */
  it('refuses an automatic entry written for another tenant', async () => {
    const theirs = await seedInstance(fixture.admin, TENANT_B, [APPROVER]);

    await fixture.asTenant(TENANT_A, async (client) => {
      const refused = await insertReminder(client, {
        tenantId: TENANT_B,
        instanceId: theirs.instanceId,
        stepId: theirs.stepIds[0] ?? '',
        execution: PROVENANCE,
      });

      expect(refused).not.toBe('accepted');
    });
  });
});
