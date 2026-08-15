import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  DEPUTY,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  TENANT_A,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedDecision, seedDefinition, seedInstance } from './workflow-seed.js';

/**
 * The invariants no read-then-write check can hold, and the races that prove it.
 *
 * Every unique index in this module exists because two callers can act at the same instant and a
 * pre-check would let both through. Each is asserted twice — the case it refuses, and the case it
 * must still permit — because an index that refused everything would pass a refusal-only suite.
 *
 * The races run on **two real connections**. Two transactions on one pooled connection are the same
 * transaction, so a race written against a single connection proves only that a program doing two
 * things in order does them in order.
 *
 * The three outcomes are kept apart on purpose: a **unique conflict** (two writers, one row), an
 * **optimistic version conflict** (two writers, one row already moved) and a **domain refusal** (a
 * check constraint saying the state is not legal). Collapsing them would make a caller unable to
 * tell "somebody beat you to it" from "what you asked for is not allowed".
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's concurrency suite");

suite('what the database arbitrates', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_concurrency_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /**
   * One statement batch on the chosen connection.
   *
   * A helper rather than `connection === 'first' ? fixture.asTenant : fixture.onSecondConnection`,
   * because detaching a method from its object loses its `this` — harmless for this fixture's
   * closures and a defect waiting for the day it is not.
   */
  const on = <TResult>(
    connection: 'first' | 'second',
    tenantId: string,
    work: (client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0]) => Promise<TResult>,
  ): Promise<TResult> =>
    connection === 'first'
      ? fixture.asTenant(tenantId, work)
      : fixture.onSecondConnection(tenantId, work);

  describe('one open approval per subject', () => {
    it('refuses a second running instance for the same subject', async () => {
      const refusal = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);

        return probe(
          client,
          `insert into workflow_instance
             (tenant_id, definition_id, workflow_version_id, subject_type, subject_id,
              requested_by_membership_id, status, started_at, correlation_id, ${AUDIT_COLUMNS})
           values ($1, $2, $3, $4, 'requisition-1', $5, 'running', now(), gen_random_uuid(),
                   ${AUDIT_VALUES})`,
          [TENANT_A, seeded.definitionId, seeded.workflowVersionId, SUBJECT_TYPE, REQUESTER],
        );
      });

      expect(refusal).toContain('workflow_instance_open_subject_idx');
    });

    it('permits a second approval once the first has ended', async () => {
      // The index is partial on `running`, so asking again after a rejection is an ordinary act
      // rather than a conflict — which is what makes "a new instance" the correction mechanism.
      const outcome = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);

        await client.query(
          `update workflow_instance set status = 'rejected', completed_at = now() where id = $1`,
          [seeded.instanceId],
        );
        return probe(
          client,
          `insert into workflow_instance
             (tenant_id, definition_id, workflow_version_id, subject_type, subject_id,
              requested_by_membership_id, status, started_at, correlation_id, ${AUDIT_COLUMNS})
           values ($1, $2, $3, $4, 'requisition-1', $5, 'running', now(), gen_random_uuid(),
                   ${AUDIT_VALUES})`,
          [TENANT_A, seeded.definitionId, seeded.workflowVersionId, SUBJECT_TYPE, REQUESTER],
        );
      });

      expect(outcome).toBe('accepted');
    });

    it('lets exactly one of two simultaneous submissions win', async () => {
      const seeded = await fixture.asTenant(TENANT_A, (client) => seedDefinition(client, TENANT_A));
      const submit = (subjectId: string, connection: 'first' | 'second'): Promise<string> =>
        on(connection, TENANT_A, (client) =>
          probe(
            client,
            `insert into workflow_instance
               (tenant_id, definition_id, workflow_version_id, subject_type, subject_id,
                requested_by_membership_id, status, started_at, correlation_id, ${AUDIT_COLUMNS})
             values ($1, $2, $3, $4, $5, $6, 'running', now(), gen_random_uuid(),
                     ${AUDIT_VALUES})`,
            [
              TENANT_A,
              seeded.definitionId,
              seeded.workflowVersionId,
              SUBJECT_TYPE,
              subjectId,
              REQUESTER,
            ],
          ),
        );
      const outcomes = await Promise.all([
        submit('requisition-race', 'first'),
        submit('requisition-race', 'second'),
      ]);
      const accepted = outcomes.filter((outcome) => outcome === 'accepted');

      expect(accepted).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome !== 'accepted')).toContain(
        'workflow_instance_open_subject_idx',
      );
    });
  });

  describe('a branch awaits a decision, and a branch may be several steps', () => {
    /**
     * **The invariant this block asserted was replaced in Phase 16B, not dropped.**
     *
     * 16A held "at most one step of an instance is awaiting" in a partial unique index, and that was
     * exactly right while a branch could only hold one step. A branch is now the set of steps sharing
     * an ordinal, and every one of them is asked at once — so the old index refused the ordinary case
     * of parallel approval.
     *
     * What replaces it is asserted here as a **positive** property, and the reason the replacement is
     * not another unique index is worth stating where somebody will look for it: "at most one
     * *ordinal* among an instance's awaiting steps" is a condition on a set, and no unique index can
     * express one. A trigger could read the other rows, but a read-then-write check inside the
     * database is still a read-then-write check — under read-committed two transactions each see the
     * other's pre-image and both commit. So the branch invariant lives in `chooseBranch`, and what
     * the database still arbitrates is the thing it can: one decision per step.
     */
    it('permits every step of one branch to await a decision at once', async () => {
      const outcome = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER]);

        await client.query(`update workflow_step set ordinal = 1 where id = $1`, [
          seeded.stepIds[1],
        ]);
        return probe(client, `update workflow_step set status = 'awaiting' where id = $1`, [
          seeded.stepIds[1],
        ]);
      });

      expect(outcome).toBe('accepted');
    });

    it('permits advancing when the decided step leaves awaiting first', async () => {
      // The sequential chain, unchanged: a version whose ordinals are all distinct produces branches
      // of one and behaves exactly as it did before, which is why every process configured under 16A
      // keeps running the same way.
      const outcome = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER]);

        await client.query(`update workflow_step set status = 'approved' where id = $1`, [
          seeded.stepIds[0],
        ]);
        return probe(client, `update workflow_step set status = 'awaiting' where id = $1`, [
          seeded.stepIds[1],
        ]);
      });

      expect(outcome).toBe('accepted');
    });

    it('permits two instances each having their own awaiting step', async () => {
      const outcome = await fixture.asTenant(TENANT_A, async (client) => {
        await seedInstance(client, TENANT_A, [APPROVER], 'requisition-1');
        await seedInstance(client, TENANT_A, [APPROVER], 'requisition-2');

        const { rows } = await client.query<{ total: string }>(
          `select count(*)::text as total from workflow_step where status = 'awaiting'`,
        );

        return rows[0]?.total;
      });

      expect(outcome).toBe('2');
    });
  });

  describe('one decision per step', () => {
    it('refuses a second decision on the same step', async () => {
      const refusal = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);

        await seedDecision(client, TENANT_A, seeded);
        return probe(
          client,
          `insert into workflow_decision
             (tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority,
              decided_at, ${AUDIT_COLUMNS})
           values ($1, $2, $3, 'rejected', $4, 'assigned', now(), ${AUDIT_VALUES})`,
          [TENANT_A, seeded.instanceId, seeded.stepIds[0], DEPUTY],
        );
      });

      expect(refusal).toContain('workflow_decision_step_idx');
    });

    it('permits a decision on each step of the same instance', async () => {
      const total = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER]);

        await seedDecision(client, TENANT_A, seeded);
        await seedDecision(
          client,
          TENANT_A,
          { ...seeded, stepIds: [seeded.stepIds[1] ?? ''] },
          SECOND_APPROVER,
        );

        const { rows } = await client.query<{ total: string }>(
          `select count(*)::text as total from workflow_decision`,
        );

        return rows[0]?.total;
      });

      expect(total).toBe('2');
    });

    it('lets exactly one of two simultaneous decisions on one step win', async () => {
      const seeded = await fixture.asTenant(TENANT_A, (client) => seedInstance(client, TENANT_A));
      const decide = (who: string, connection: 'first' | 'second'): Promise<string> =>
        on(connection, TENANT_A, (client) =>
          probe(
            client,
            `insert into workflow_decision
               (tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority,
                decided_at, ${AUDIT_COLUMNS})
             values ($1, $2, $3, 'approved', $4, 'assigned', now(), ${AUDIT_VALUES})`,
            [TENANT_A, seeded.instanceId, seeded.stepIds[0], who],
          ),
        );
      const outcomes = await Promise.all([decide(APPROVER, 'first'), decide(DEPUTY, 'second')]);

      expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome !== 'accepted')).toContain(
        'workflow_decision_step_idx',
      );
    });
  });
});
