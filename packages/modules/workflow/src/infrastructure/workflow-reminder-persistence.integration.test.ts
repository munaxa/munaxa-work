import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { reminderHistory, type ExecutionProvenance } from '../domain/history.js';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  TENANT_A,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type PoolLike,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedInstance } from './workflow-seed.js';
import { historyState, historyValues } from './workflow-record-rows.js';

/**
 * The automatic reminder, in PostgreSQL.
 *
 * Four things are proved here and none of them can be proved anywhere else: that the tenth event is
 * accepted and the provenance round-trips; that the database — not a preceding read — is what makes
 * one reminder per step true under two real connections; that the constraints make an impersonating
 * row unrepresentable rather than merely discouraged; and that row-level security applies to an
 * automatic entry exactly as it does to a human one.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's automatic reminder suite");

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

suite('the reminder history event in PostgreSQL', () => {
  let fixture: WorkflowFixture;
  let instanceId: string;
  let stepIds: readonly string[];

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_reminder_role');
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

  const stepId = (): string => {
    const [first] = stepIds;

    if (first === undefined) throw new Error('the seed produced no step');
    return first;
  };

  it('accepts the tenth event, which the constraint refused before this migration', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(
        await insertReminder(client, {
          tenantId: TENANT_A,
          instanceId,
          stepId: stepId(),
          execution: PROVENANCE,
        }),
      ).toBe('accepted');
    });
  });

  /** And the vocabulary is still closed: an eleventh value is refused by name. */
  it('still refuses an event nobody approved', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      const refused = await insertReminder(client, {
        tenantId: TENANT_A,
        instanceId,
        stepId: stepId(),
        execution: PROVENANCE,
        event: 'sla-breached',
      });

      expect(refused).toContain('workflow_history_event_check');
    });
  });

  /**
   * The provenance survives the round trip, which is the assertion a column count cannot make.
   *
   * Three Phase 16C columns were once invisible to the application for a checkpoint and a half
   * because everything inserted, everything selected, and the values simply never arrived. This is
   * the shape of assertion that caught it then.
   */
  it('round-trips the execution provenance through the mapper', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      await insertReminder(client, {
        tenantId: TENANT_A,
        instanceId,
        stepId: stepId(),
        execution: PROVENANCE,
      });

      const rows = await client.query<Record<string, unknown>>(
        `select h.id, h.instance_id, h.event, h.occurred_at, h.step_id, h.ordinal,
                h.actor_membership_id, h.on_behalf_of_membership_id, h.execution_identity,
                h.execution_correlation_id, h.execution_job_id, h.execution_attempt, h.version
           from workflow_history h where h.event = 'step-reminded'`,
        [],
      );
      const [row] = rows.rows;
      const state = historyState(row as never);

      expect(state.execution).toStrictEqual(PROVENANCE);
      expect(state.event).toBe('step-reminded');
    });
  });

  /** An execution with no job — nothing scheduled it — keeps its identity and drops the two. */
  it('round-trips an execution that no job scheduled', async () => {
    const unscheduled: ExecutionProvenance = {
      executionIdentity: PROVENANCE.executionIdentity,
      correlationId: PROVENANCE.correlationId,
    };

    await fixture.asTenant(TENANT_A, async (client) => {
      await insertReminder(client, {
        tenantId: TENANT_A,
        instanceId,
        stepId: stepId(),
        execution: unscheduled,
      });

      const rows = await client.query<Record<string, unknown>>(
        `select h.id, h.instance_id, h.event, h.occurred_at, h.step_id, h.ordinal,
                h.actor_membership_id, h.on_behalf_of_membership_id, h.execution_identity,
                h.execution_correlation_id, h.execution_job_id, h.execution_attempt, h.version
           from workflow_history h where h.event = 'step-reminded'`,
        [],
      );
      const state = historyState(rows.rows[0] as never);

      expect(state.execution).toStrictEqual(unscheduled);
      expect(state.execution?.jobId).toBeUndefined();
    });
  });

  /** The mapper writes what the migration expects, in both directions, with no column left behind. */
  it('writes every provenance column the mapper claims to write', () => {
    const written = historyValues(
      reminderHistory(
        { stepId: 'step', instanceId: 'instance', ordinal: 1, approverMembershipId: APPROVER },
        AT,
        'history',
        PROVENANCE,
      ),
      TENANT_A,
    );

    expect(written['execution_identity']).toBe(PROVENANCE.executionIdentity);
    expect(written['execution_correlation_id']).toBe(PROVENANCE.correlationId);
    expect(written['execution_job_id']).toBe(PROVENANCE.jobId);
    expect(written['execution_attempt']).toBe(PROVENANCE.attempt);
    // And the actor columns are empty, in the values the database will actually receive.
    expect(written['actor_membership_id']).toBeNull();
    expect(written['on_behalf_of_membership_id']).toBeNull();
  });
});

suite('what the constraints make unrepresentable', () => {
  let fixture: WorkflowFixture;
  let instanceId: string;
  let stepIds: readonly string[];

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_reminder_constraint_role');
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

  const stepId = (): string => stepIds[0] ?? '';

  /**
   * **The impersonation guard.** A row naming both an approver and an execution would leave a reader
   * unable to tell whether the person acted or the system acted as them. Refused outright.
   */
  it('refuses a row that names both a human actor and an execution', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      const refused = await insertReminder(client, {
        tenantId: TENANT_A,
        instanceId,
        stepId: stepId(),
        execution: PROVENANCE,
        actorMembershipId: APPROVER,
      });

      expect(refused).toContain('workflow_history_execution_not_human_check');
    });
  });

  /** A human event still records its actor, so the guard above forbids the pair and not the actor. */
  it('still accepts a human entry naming its actor', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      expect(
        await insertReminder(client, {
          tenantId: TENANT_A,
          instanceId,
          stepId: stepId(),
          event: 'step-escalated',
          actorMembershipId: APPROVER,
        }),
      ).toBe('accepted');
    });
  });

  it('refuses an execution identity with no correlation', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      const refused = await probe(
        client,
        `insert into workflow_history
           (tenant_id, instance_id, event, occurred_at, step_id, ordinal, execution_identity,
            metadata, ${AUDIT_COLUMNS})
         values ($1, $2, 'step-reminded', now(), $3, 1, 'service:x', '{}'::jsonb, ${AUDIT_VALUES})`,
        [TENANT_A, instanceId, stepId()],
      );

      expect(refused).toContain('workflow_history_execution_check');
    });
  });

  it('refuses an attempt with no job behind it', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      const refused = await insertReminder(client, {
        tenantId: TENANT_A,
        instanceId,
        stepId: stepId(),
        execution: {
          executionIdentity: 'service:x',
          correlationId: 'correlation',
          attempt: 1,
        },
      });

      expect(refused).toContain('workflow_history_execution_check');
    });
  });

  /** History stays immutable: the claim cannot be released by updating or deleting the row. */
  it('cannot be updated or deleted to release the reminder claim', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      await insertReminder(client, {
        tenantId: TENANT_A,
        instanceId,
        stepId: stepId(),
        execution: PROVENANCE,
      });

      const updated = await probe(
        client,
        `update workflow_history set deleted_at = now() where event = 'step-reminded'`,
        [],
      );
      const deleted = await probe(
        client,
        `delete from workflow_history where event = 'step-reminded'`,
        [],
      );

      expect(updated).toContain('workflow_history_immutable');
      expect(deleted).toContain('workflow_history_immutable');
    });
  });
});
