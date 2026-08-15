import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  DEPUTY,
  SECOND_APPROVER,
  TENANT_A,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedBranchInstance, seedDefinition, seedInstance } from './workflow-seed.js';

/**
 * The parallel branch, against the two indexes that used to make it impossible.
 *
 * Phase 16A held two invariants here, and both were correct for what 16A was: one step per ordinal
 * per instance, and at most one step of an instance awaiting a decision. Phase 16B redefines a
 * **branch** as the set of steps sharing an ordinal, all asked at the same moment — so both of those
 * indexes now refuse the ordinary case of the feature rather than an illegal state.
 *
 * They were widened rather than removed, and this suite is the difference between those two things.
 * Every assertion below is a **positive** one about what the schema must now permit, beside the one
 * invariant that did not move and must not: **one decision per step**. A suite that had simply
 * deleted the old assertions would report the same green whether the indexes were relaxed or the
 * whole table had been dropped.
 *
 * The races run on **two real connections**. Two transactions on one pooled connection are the same
 * transaction, so a race written against a single connection proves only that a program doing two
 * things in order does them in order.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's parallel branch suite");

suite('a branch is several steps, and the schema now says so', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_parallel_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const decide = (
    client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0],
    seeded: { readonly instanceId: string },
    stepId: string,
    by: string,
  ): Promise<string> =>
    probe(
      client,
      `insert into workflow_decision
         (tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority,
          decided_at, ${AUDIT_COLUMNS})
       values ($1, $2, $3, 'approved', $4, 'assigned', now(), ${AUDIT_VALUES})`,
      [TENANT_A, seeded.instanceId, stepId, by],
    );

  describe('several steps at one ordinal', () => {
    it('permits two steps of one instance sharing an ordinal', async () => {
      const seeded = await fixture.asTenant(TENANT_A, (client) =>
        seedBranchInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER, DEPUTY]),
      );

      expect(seeded.stepIds).toHaveLength(3);

      const { rows } = await fixture.asTenant(TENANT_A, (client) =>
        client.query<{ ordinals: string }>(
          `select count(distinct ordinal)::text as ordinals from workflow_step
            where instance_id = $1`,
          [seeded.instanceId],
        ),
      );

      // Three steps, one ordinal. Under 16A's unique index the seed itself would have failed.
      expect(rows[0]?.ordinals).toBe('1');
    });

    it('permits two templates of one version sharing an ordinal', async () => {
      const outcome = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);

        return probe(
          client,
          `insert into workflow_step_template
             (tenant_id, workflow_version_id, ordinal, name, approver_kind,
              approver_membership_id, ${AUDIT_COLUMNS})
           values ($1, $2, 1, '{"en":"x","ar":"x"}'::jsonb, 'membership', $3, ${AUDIT_VALUES})`,
          [TENANT_A, seeded.workflowVersionId, SECOND_APPROVER],
        );
      });

      // This is how an administrator configures a branch in the first place: a second approver at
      // the ordinal the first one already occupies.
      expect(outcome).toBe('accepted');
    });

    it('lets two writers add to one branch at the same instant, and takes both', async () => {
      const seeded = await fixture.asTenant(TENANT_A, (client) =>
        seedInstance(client, TENANT_A, [APPROVER]),
      );
      const add = (approver: string, connection: 'first' | 'second'): Promise<string> => {
        const work = (
          client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0],
        ): Promise<string> =>
          probe(
            client,
            `insert into workflow_step
               (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
                ${AUDIT_COLUMNS})
             values ($1, $2, 1, 'membership', $3, 'awaiting', ${AUDIT_VALUES})`,
            [TENANT_A, seeded.instanceId, approver],
          );

        return connection === 'first'
          ? fixture.asTenant(TENANT_A, work)
          : fixture.onSecondConnection(TENANT_A, work);
      };

      expect(
        await Promise.all([add(SECOND_APPROVER, 'first'), add(DEPUTY, 'second')]),
      ).toStrictEqual(['accepted', 'accepted']);
    });
  });

  describe('several steps awaiting at once', () => {
    it('permits every step of a branch to await a decision together', async () => {
      const awaiting = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedBranchInstance(client, TENANT_A, [
          APPROVER,
          SECOND_APPROVER,
          DEPUTY,
        ]);
        const { rows } = await client.query<{ total: string }>(
          `select count(*)::text as total from workflow_step
            where instance_id = $1 and status = 'awaiting'`,
          [seeded.instanceId],
        );

        return rows[0]?.total;
      });

      // Under `workflow_step_awaiting_idx` as 16A shipped it, this was `1` and could not be anything
      // else. The whole of parallel approval is the difference between that and this.
      expect(awaiting).toBe('3');
    });

    it('still finds the open branch through the index rather than by scanning', async () => {
      // The index was widened, not abandoned: the read it serves — "the steps of this instance that
      // are waiting on somebody" — is the queue this phase is for. A fixture holds a handful of rows
      // so PostgreSQL would legitimately prefer a scan; `enable_seqscan = off` asks the narrower
      // question this checkpoint can honestly answer, which is whether the index is reachable at all.
      const plan = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedBranchInstance(client, TENANT_A);

        await client.query('set local enable_seqscan = off');

        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `explain select id from workflow_step
             where tenant_id = $1 and instance_id = $2 and status = 'awaiting'
               and deleted_at is null order by ordinal`,
          [TENANT_A, seeded.instanceId],
        );

        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });

      expect(plan).toContain('workflow_step_awaiting_idx');
    });
  });

  describe('one decision per step, which did not move', () => {
    it('still refuses a second decision on one step', async () => {
      const refusal = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedBranchInstance(client, TENANT_A);

        await decide(client, seeded, seeded.stepIds[0] ?? '', APPROVER);
        return decide(client, seeded, seeded.stepIds[0] ?? '', DEPUTY);
      });

      expect(refusal).toContain('workflow_decision_step_idx');
    });

    it('takes one decision on each step of one branch, written concurrently', async () => {
      const seeded = await fixture.asTenant(TENANT_A, (client) =>
        seedBranchInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER]),
      );
      const answer = (
        index: number,
        by: string,
        connection: 'first' | 'second',
      ): Promise<string> => {
        const work = (
          client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0],
        ): Promise<string> => decide(client, seeded, seeded.stepIds[index] ?? '', by);

        return connection === 'first'
          ? fixture.asTenant(TENANT_A, work)
          : fixture.onSecondConnection(TENANT_A, work);
      };

      // Two approvers of one branch answering at the same moment is the ordinary case of a parallel
      // approval, not a race to be arbitrated. Both must be recorded.
      expect(
        await Promise.all([answer(0, APPROVER, 'first'), answer(1, SECOND_APPROVER, 'second')]),
      ).toStrictEqual(['accepted', 'accepted']);
    });

    it('lets exactly one of two simultaneous decisions on one step of a branch win', async () => {
      const seeded = await fixture.asTenant(TENANT_A, (client) =>
        seedBranchInstance(client, TENANT_A, [APPROVER, SECOND_APPROVER]),
      );
      const race = (by: string, connection: 'first' | 'second'): Promise<string> => {
        const work = (
          client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0],
        ): Promise<string> => decide(client, seeded, seeded.stepIds[0] ?? '', by);

        return connection === 'first'
          ? fixture.asTenant(TENANT_A, work)
          : fixture.onSecondConnection(TENANT_A, work);
      };
      const outcomes = await Promise.all([race(APPROVER, 'first'), race(DEPUTY, 'second')]);

      expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome !== 'accepted')).toContain(
        'workflow_decision_step_idx',
      );
    });
  });

  describe('what the database does not arbitrate, said plainly', () => {
    /**
     * **The step's own status is a single value, so no row is both decided and awaiting.** That much
     * is structural and is asserted here.
     *
     * What is *not* enforced at the table is the ordering between two tables: nothing stops a
     * `skipped` step from receiving a decision row. It is stated rather than quietly left out,
     * because the alternative is worse than the gap. Expressing it needs a trigger on
     * `workflow_decision` that reads `workflow_step`, and under read-committed that trigger cannot
     * hold: a transaction skipping the step and a transaction deciding it each see the other's
     * pre-image, both commit, and the invariant is broken by the very mechanism meant to guarantee
     * it. A read-then-write check inside the database is still a read-then-write check — which is
     * what every unique index in this module exists to avoid.
     *
     * So the guarantee lives where it can actually be held: `decide` refuses a step that is not
     * awaiting, and the branch sweep in `decision.ts` excludes steps that already carry a decision.
     */
    it('keeps a step to one status, and leaves the skipped-then-decided ordering to the domain', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedBranchInstance(client, TENANT_A);
        const stepId = seeded.stepIds[0] ?? '';

        await client.query(`update workflow_step set status = 'skipped' where id = $1`, [stepId]);

        const { rows } = await client.query<{ status: string }>(
          `select status from workflow_step where id = $1`,
          [stepId],
        );

        return {
          status: rows[0]?.status,
          invented: await probe(client, `update workflow_step set status = 'both' where id = $1`, [
            stepId,
          ]),
          decided: await decide(client, seeded, stepId, APPROVER),
        };
      });

      expect(outcomes.status).toBe('skipped');
      expect(outcomes.invented).toContain('workflow_step_status_check');
      // Accepted at the table, and refused by `decide`. Asserted so the gap is a documented
      // boundary rather than a surprise for whoever writes the repository in Checkpoint 5.
      expect(outcomes.decided).toBe('accepted');
    });
  });
});
