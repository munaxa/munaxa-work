import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  SECOND_APPROVER,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedDefinition, seedInstance } from './workflow-seed.js';

/**
 * What Phase 16C added to the schema, asserted against the database rather than the migration file.
 *
 * Three things arrived: `manager` joined the template's approver vocabulary, a service-level target
 * landed on the template and on the step, and a step gained the instant it became awaiting. Nothing
 * else — and several of the assertions below exist to prove the *nothing else*.
 *
 * **The manager needed no column at all**, which is the finding worth reading twice. A `manager`
 * template names nobody, because whose manager it means is the requester and that is fixed rather
 * than configured (P-1); the resolved person lands in `workflow_step.approver_membership_id` exactly
 * as a group's members do. So a running approval still names a concrete membership and depends on no
 * live organizational lookup — the 16B invariant this had to preserve.
 *
 * **And the target needed no `due_at`.** Due-ness is derived from the target, the awaiting instant
 * and an explicit reading instant, every time it is asked. A stored due time would disagree with its
 * own inputs the first time a target was corrected.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's routing-resolution schema suite");

const columnsOf = async (
  fixture: WorkflowFixture,
  table: string,
): Promise<ReadonlyMap<string, { readonly type: string; readonly nullable: boolean }>> => {
  const { rows } = await fixture.admin.query<{
    column_name: string;
    data_type: string;
    is_nullable: string;
  }>(
    `select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [table],
  );

  return new Map(
    rows.map((row) => [
      row.column_name,
      { type: row.data_type, nullable: row.is_nullable === 'YES' },
    ]),
  );
};

suite('the routing-resolution schema', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_resolution_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  describe('the approver a template may name', () => {
    const template = (kind: string, membership: string | null, group: string | null) =>
      `insert into workflow_step_template
         (tenant_id, workflow_version_id, ordinal, name, approver_kind,
          approver_membership_id, approver_group_id, ${AUDIT_COLUMNS})
       values ($1, $2, 9, '{"en":"Step","ar":"خطوة"}'::jsonb, '${kind}',
               ${membership === null ? 'null' : `'${membership}'`},
               ${group === null ? 'null' : `'${group}'`}, ${AUDIT_VALUES})`;

    it('takes all three kinds and refuses a fourth', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);

        for (const [kind, membership] of [
          ['membership', APPROVER],
          ['manager', null],
        ] as const) {
          const taken = await probe(client, template(kind, membership, null), [
            TENANT_A,
            seeded.workflowVersionId,
          ]);

          expect([kind, taken]).toStrictEqual([kind, 'accepted']);
        }
        // `role` is the one somebody would try, and the vocabulary is where it stops.
        for (const invented of ['role', 'external', 'dynamic']) {
          const refused = await probe(client, template(invented, null, null), [
            TENANT_A,
            seeded.workflowVersionId,
          ]);

          expect([invented, refused]).toStrictEqual([
            invented,
            expect.stringContaining('[workflow_step_template_approver_kind_check]') as unknown,
          ]);
        }
      });
    });

    /**
     * The constraint that generalized for free.
     *
     * `workflow_step_template_approver_check` was written in 16B as two biconditionals rather than a
     * list of permitted shapes, so for `manager` both sides of both are false: neither identifier is
     * allowed, and that is exactly the approved rule. It was not edited by this migration, and these
     * two probes are why that is a fact rather than an oversight.
     */
    it('refuses a manager template carrying either identifier', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const withMembership = await probe(client, template('manager', APPROVER, null), [
          TENANT_A,
          seeded.workflowVersionId,
        ]);
        const withGroup = await probe(client, template('manager', null, seeded.workflowVersionId), [
          TENANT_A,
          seeded.workflowVersionId,
        ]);

        for (const refusal of [withMembership, withGroup]) {
          expect(refusal).toContain('[workflow_step_template_approver_check]');
        }
      });
    });

    /**
     * A running step still names a person, and the step's own vocabulary still says so.
     *
     * This is the invariant the manager work had to preserve: a group is resolved into its members
     * and a manager into one membership *before* a step row exists, so at the moment somebody is
     * actually asked there is only ever a person. A widened step constraint would have let a running
     * approval defer the question of who decides.
     */
    it('still allows only a membership on a running step', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);
        const refused = await probe(
          client,
          `insert into workflow_step
             (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
              ${AUDIT_COLUMNS})
           values ($1, $2, 5, 'manager', $3, 'pending', ${AUDIT_VALUES})`,
          [TENANT_A, seeded.instanceId, APPROVER],
        );

        expect(refused).toContain('[workflow_step_approver_kind_check]');
      });
    });
  });

  describe('the resolved manager, once an approval is running', () => {
    /**
     * The whole of the manager's persistence, and it is a column that already existed.
     *
     * No `manager_membership_id`, no `manager_employment_id`, no second target anywhere: the person
     * the application resolved is the step's approver, indistinguishable in shape from one a tenant
     * typed. That is what makes a running approval independent of the reporting line it came from.
     */
    it('stores the resolved person as the step’s own approver, with no second column', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);

        await client.query(
          `insert into workflow_step
             (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
              ${AUDIT_COLUMNS})
           values ($1, $2, 7, 'membership', $3, 'awaiting', ${AUDIT_VALUES})`,
          [TENANT_A, seeded.instanceId, SECOND_APPROVER],
        );

        const rows = await client.query<{ approver_membership_id: string; approver_kind: string }>(
          `select approver_membership_id, approver_kind from workflow_step
            where tenant_id = $1 and ordinal = 7`,
          [TENANT_A],
        );

        expect(rows.rows[0]).toStrictEqual({
          approver_membership_id: SECOND_APPROVER,
          approver_kind: 'membership',
        });
      });

      const step = await columnsOf(fixture, 'workflow_step');

      for (const absent of [
        'manager_membership_id',
        'manager_employment_id',
        'source_manager_id',
        'resolved_manager_id',
      ]) {
        expect([absent, step.has(absent)]).toStrictEqual([absent, false]);
      }
    });

    it('keeps a resolved manager inside its own tenant', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);

        await client.query(
          `insert into workflow_step
             (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
              ${AUDIT_COLUMNS})
           values ($1, $2, 8, 'membership', $3, 'awaiting', ${AUDIT_VALUES})`,
          [TENANT_A, seeded.instanceId, SECOND_APPROVER],
        );
      });

      const theirs = await fixture.asTenant(TENANT_B, async (client) =>
        client.query<{ total: string }>(
          `select count(*)::text as total from workflow_step where ordinal = 8`,
        ),
      );

      expect(theirs.rows[0]?.total).toBe('0');
    });
  });
});
