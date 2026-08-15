import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  SECOND_APPROVER,
  TENANT_A,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedApprovalGroup, seedDefinition, seedInstance } from './workflow-seed.js';

/**
 * The routing columns: an approver of two kinds, a branch rule, a quorum and a condition.
 *
 * **What is checked here is structure, and only structure.** A branch rule is one of three words; a
 * quorum is a whole number of one or more; a condition is an array of triples naming one of five
 * operators. Whether a *particular* quorum is larger than its branch, and whether a condition can be
 * evaluated against a *particular* request's context, are facts about sets of rows and about payloads
 * — `branchConfigurationIsUsable` and `evaluateCondition` own those, and re-expressing them in SQL
 * would be a second definition of the rule that drifts from the first.
 *
 * **The two approver-kind constraints stay different on purpose.** A template may name a person or a
 * group. A running step never names a group, because the group was resolved into its members before
 * the row existed — so at the moment somebody is actually asked there is only ever a person, and
 * `workflow_step_approver_kind_check` keeps the single value it has had since 16A.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's routing column suite");

suite('the columns a branch routes on', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_routing_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** One template, with whichever routing columns the case is about. */
  const template = (
    client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0],
    workflowVersionId: string,
    columns: string,
    values: string,
    parameters: readonly unknown[] = [],
  ): Promise<string> =>
    probe(
      client,
      `insert into workflow_step_template
         (tenant_id, workflow_version_id, ordinal, name, ${columns}, ${AUDIT_COLUMNS})
       values ($1, $2, 2, '{"en":"x","ar":"x"}'::jsonb, ${values}, ${AUDIT_VALUES})`,
      [TENANT_A, workflowVersionId, ...parameters],
    );

  describe('exactly one approver, and the right one for the kind', () => {
    it('takes a person for a membership template and a list for a group template', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const group = await seedApprovalGroup(client, TENANT_A, [APPROVER]);

        return {
          person: await template(
            client,
            seeded.workflowVersionId,
            'approver_kind, approver_membership_id',
            `'membership', $3`,
            [SECOND_APPROVER],
          ),
          list: await template(
            client,
            seeded.workflowVersionId,
            'approver_kind, approver_group_id',
            `'group', $3`,
            [group.approvalGroupId],
          ),
        };
      });

      expect(outcomes).toStrictEqual({ person: 'accepted', list: 'accepted' });
    });

    it('refuses a template naming both, and one naming neither', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const group = await seedApprovalGroup(client, TENANT_A, [APPROVER]);

        return {
          // Both present is the dangerous case rather than the untidy one: it has two readings, and
          // whichever an implementation picked would decide who approves.
          both: await template(
            client,
            seeded.workflowVersionId,
            'approver_kind, approver_membership_id, approver_group_id',
            `'membership', $3, $4`,
            [SECOND_APPROVER, group.approvalGroupId],
          ),
          neither: await template(client, seeded.workflowVersionId, 'approver_kind', `'group'`),
          mismatched: await template(
            client,
            seeded.workflowVersionId,
            'approver_kind, approver_membership_id',
            `'group', $3`,
            [SECOND_APPROVER],
          ),
        };
      });

      for (const outcome of Object.values(outcomes)) {
        expect(outcome).toContain('workflow_step_template_approver_check');
      }
    });

    it('refuses a kind neither the domain nor the database has heard of', async () => {
      // **Neither approver column is supplied, and that is what makes this test about the kind.**
      // A `role` row naming a membership violates the coherence constraint as well, and PostgreSQL
      // reports whichever it evaluates first — so the row is built to satisfy every other rule,
      // leaving exactly one thing for the database to object to.
      const refusal = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);

        return template(client, seeded.workflowVersionId, 'approver_kind', `'role'`);
      });

      // `role` in particular: it is the kind somebody would add first, and the one this product has
      // said it will never resolve.
      expect(refusal).toContain('workflow_step_template_approver_kind_check');
    });

    it('keeps a running step to a person, whatever its template named', async () => {
      const refusal = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);

        return probe(client, `update workflow_step set approver_kind = 'group' where id = $1`, [
          seeded.stepIds[0],
        ]);
      });

      expect(refusal).toContain('workflow_step_approver_kind_check');
    });

    it('records which list a person was snapshotted from, without referencing it', async () => {
      const stored = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);
        const group = await seedApprovalGroup(client, TENANT_A, [APPROVER]);

        await client.query(`update workflow_step set source_group_id = $1 where id = $2`, [
          group.approvalGroupId,
          seeded.stepIds[0],
        ]);
        // Deleting the list the person came from must not touch the approval they are part of: the
        // snapshot is the whole point, and a foreign key here would have refused this delete.
        await client.query(
          `delete from workflow_approval_group_member where approval_group_id = $1`,
          [group.approvalGroupId],
        );
        await client.query(`delete from workflow_approval_group where id = $1`, [
          group.approvalGroupId,
        ]);

        const { rows } = await client.query<{ source_group_id: string | null }>(
          `select source_group_id from workflow_step where id = $1`,
          [seeded.stepIds[0]],
        );

        return rows[0]?.source_group_id;
      });

      expect(stored).not.toBeNull();
    });
  });

  describe('the branch rule and the quorum', () => {
    it('takes the three rules the domain declares and refuses a fourth', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const withRule = (rule: string): Promise<string> =>
          template(
            client,
            seeded.workflowVersionId,
            'approver_kind, approver_membership_id, branch_rule',
            `'membership', $3, $4`,
            [SECOND_APPROVER, rule],
          );

        return {
          unanimous: await withRule('unanimous'),
          majority: await withRule('majority'),
          first: await withRule('first-response'),
          invented: await withRule('two-thirds'),
        };
      });

      expect([outcomes.unanimous, outcomes.majority, outcomes.first]).toStrictEqual([
        'accepted',
        'accepted',
        'accepted',
      ]);
      // `two-thirds` is the rule a proportion would arrive as, and there is no column for it to be
      // stored in even if the check had let it past.
      expect(outcomes.invented).toContain('workflow_step_template_branch_rule_check');
    });

    it('takes a quorum of one or more and refuses zero and a negative', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const withQuorum = (quorum: string): Promise<string> =>
          template(
            client,
            seeded.workflowVersionId,
            'approver_kind, approver_membership_id, quorum',
            `'membership', $3, ${quorum}`,
            [SECOND_APPROVER],
          );

        return {
          one: await withQuorum('1'),
          zero: await withQuorum('0'),
          negative: await withQuorum('-1'),
        };
      });

      expect(outcomes.one).toBe('accepted');
      for (const outcome of [outcomes.zero, outcomes.negative]) {
        expect(outcome).toContain('workflow_step_template_quorum_check');
      }
    });

    it('cannot store a fractional quorum at all, because the column is an integer', async () => {
      // Stated as what actually happens rather than as a refusal: PostgreSQL **rounds** a numeric
      // literal into an integer column, so `1.5` is stored as `2`. The guarantee is therefore that
      // no fraction can exist in the column, not that the database rejects one — and `isPositiveWhole`
      // refuses it outright in the domain, which is where a caller learns they wrote something odd.
      // Asserting a refusal here would have been asserting a behaviour PostgreSQL does not have.
      const stored = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);

        await template(
          client,
          seeded.workflowVersionId,
          'approver_kind, approver_membership_id, quorum',
          `'membership', $3, 1.5`,
          [SECOND_APPROVER],
        );

        const { rows } = await client.query<{ quorum: number }>(
          `select quorum from workflow_step_template where quorum is not null`,
        );

        return rows[0]?.quorum;
      });

      expect(stored).toBe(2);
      expect(Number.isInteger(stored)).toBe(true);
    });

    it('leaves the rule absent on a step written before this phase, meaning unanimous of one', async () => {
      const stored = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);
        const { rows } = await client.query<{ branch_rule: string | null; quorum: number | null }>(
          `select branch_rule, quorum from workflow_step where id = $1`,
          [seeded.stepIds[0]],
        );

        return rows[0];
      });

      // Null means `unanimous` with a quorum of one — exactly what every 16A step is — and it means
      // that in one place, `branchOf`, rather than once per call site. No backfill was needed, which
      // is what keeps the migration additive.
      expect(stored).toStrictEqual({ branch_rule: null, quorum: null });
    });
  });

  describe('the condition, whose shape is checkable and whose meaning is not', () => {
    const CONDITION = `'[{"key":"amount","operator":"greater-than","value":50000}]'::jsonb`;

    it('takes a well-formed list of triples', async () => {
      const outcome = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);

        return template(
          client,
          seeded.workflowVersionId,
          'approver_kind, approver_membership_id, condition',
          `'membership', $3, ${CONDITION}`,
          [SECOND_APPROVER],
        );
      });

      expect(outcome).toBe('accepted');
    });

    it('refuses arbitrary JSON, which is the whole reason the constraint exists', async () => {
      const outcomes = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const withCondition = (condition: string): Promise<string> =>
          template(
            client,
            seeded.workflowVersionId,
            'approver_kind, approver_membership_id, condition',
            `'membership', $3, '${condition}'::jsonb`,
            [SECOND_APPROVER],
          );

        return {
          object: await withCondition('{"amount":50000}'),
          untriple: await withCondition('[{"amount":50000}]'),
          unknownOperator: await withCondition('[{"key":"a","operator":"matches","value":1}]'),
          emptyKey: await withCondition('[{"key":"  ","operator":"equals","value":1}]'),
          missingValue: await withCondition('[{"key":"a","operator":"equals"}]'),
          // An empty list is legal: a branch with no condition always runs, which is what every 16A
          // step was.
          empty: await withCondition('[]'),
        };
      });

      expect(outcomes.empty).toBe('accepted');
      for (const [name, outcome] of Object.entries(outcomes)) {
        if (name === 'empty') continue;
        expect([name, outcome]).toStrictEqual([
          name,
          expect.stringContaining('workflow_step_template_condition_check'),
        ]);
      }
    });

    it('does not attempt the part that depends on a request', async () => {
      // `'50000'` against `greater-than` is a *type* mismatch the domain refuses with
      // `condition-comparison-requires-a-number`, and a key absent from an instance's context is a
      // refusal rather than a false. Neither is visible to a constraint: one needs the operator's
      // semantics, the other needs a payload that does not exist when the template is written. The
      // database takes the row, and `conditionIsWellFormed` and `evaluateCondition` refuse it — which
      // is the split this test exists to pin, so nobody later mistakes acceptance here for approval.
      const outcome = await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);

        return template(
          client,
          seeded.workflowVersionId,
          'approver_kind, approver_membership_id, condition',
          `'membership', $3, '[{"key":"amount","operator":"greater-than","value":"50000"}]'::jsonb`,
          [SECOND_APPROVER],
        );
      });

      expect(outcome).toBe('accepted');
    });
  });
});
