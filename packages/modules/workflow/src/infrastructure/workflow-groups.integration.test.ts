import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  DEPUTY,
  SECOND_APPROVER,
  TENANT_A,
  TENANT_B,
  WORKFLOW_TABLES,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedApprovalGroup, seedDefinition } from './workflow-seed.js';

/**
 * Approval groups: the two tables Phase 16B adds, and the four things they refuse.
 *
 * A group is **a list somebody wrote down**, and every assertion here is about keeping it that. It
 * has no status and no lifecycle, so there is no transition to police; what it does have is a code
 * that must be unique to its tenant, a membership list that must not name the same person twice, and
 * a tenant boundary that must hold even though a foreign key is checked without consulting a policy.
 *
 * **That last one is the reason both keys here are composite.** PostgreSQL's referential check runs
 * outside row-level security, so a plain `references workflow_approval_group (id)` would let one
 * tenant attach a member — or point a step template — at a group they cannot read, see or count.
 * Naming `(id, tenant_id)` puts the tenant inside the key, and the two probes below are what prove
 * it rather than assume it.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's approval group suite");

suite('approval groups', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_group_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const addMember = (
    client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0],
    tenantId: string,
    approvalGroupId: string,
    membershipId: string,
  ): Promise<string> =>
    probe(
      client,
      `insert into workflow_approval_group_member
         (tenant_id, approval_group_id, membership_id, added_at, ${AUDIT_COLUMNS})
       values ($1, $2, $3, now(), ${AUDIT_VALUES})`,
      [tenantId, approvalGroupId, membershipId],
    );

  describe('what a group is', () => {
    it('is a code, a name and a list, with no status and no period', async () => {
      const { rows } = await fixture.admin.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'workflow_approval_group'
          order by column_name`,
      );
      const columns = rows.map((row) => row.column_name);

      // Asserted against the column list rather than against the migration's prose, because a
      // capability can only actually be half-built in a column.
      for (const absent of [
        'status',
        'archived_at',
        'closed_at',
        'effective_from',
        'effective_to',
        'owner',
        'role',
        'manager',
        'query',
        'external_id',
      ]) {
        expect([absent, columns.includes(absent)]).toStrictEqual([absent, false]);
      }
      expect(columns).toContain('code');
      expect(columns).toContain('name');
    });

    it('refuses a code that is not the shape every other code in the repository is', async () => {
      const refusal = await fixture.asTenant(TENANT_A, (client) =>
        probe(
          client,
          `insert into workflow_approval_group (tenant_id, code, name, ${AUDIT_COLUMNS})
           values ($1, 'Capital Approvers', '{"en":"x","ar":"x"}'::jsonb, ${AUDIT_VALUES})`,
          [TENANT_A],
        ),
      );

      expect(refusal).toContain('workflow_approval_group_code_shape_check');
    });

    it('accepts a group with nobody on it yet, because a list is named before it is filled', async () => {
      const seeded = await fixture.asTenant(TENANT_A, (client) =>
        seedApprovalGroup(client, TENANT_A, []),
      );

      expect(seeded.memberIds).toStrictEqual([]);
    });
  });

  describe('uniqueness', () => {
    it('refuses a duplicate code in one tenant and permits the same code in another', async () => {
      await fixture.asTenant(TENANT_A, (client) => seedApprovalGroup(client, TENANT_A, [APPROVER]));

      const duplicate = await fixture.asTenant(TENANT_A, (client) =>
        probe(
          client,
          `insert into workflow_approval_group (tenant_id, code, name, ${AUDIT_COLUMNS})
           values ($1, 'capital-approvers', '{"en":"x","ar":"x"}'::jsonb, ${AUDIT_VALUES})`,
          [TENANT_A],
        ),
      );
      const elsewhere = await fixture.asTenant(TENANT_B, (client) =>
        probe(
          client,
          `insert into workflow_approval_group (tenant_id, code, name, ${AUDIT_COLUMNS})
           values ($1, 'capital-approvers', '{"en":"x","ar":"x"}'::jsonb, ${AUDIT_VALUES})`,
          [TENANT_B],
        ),
      );

      expect(duplicate).toContain('workflow_approval_group_code_idx');
      expect(elsewhere).toBe('accepted');
    });

    it('refuses the same membership twice in one group', async () => {
      const refusal = await fixture.asTenant(TENANT_A, async (client) => {
        const group = await seedApprovalGroup(client, TENANT_A, [APPROVER]);

        return addMember(client, TENANT_A, group.approvalGroupId, APPROVER);
      });

      expect(refusal).toContain('workflow_approval_group_member_idx');
    });

    it('lets one membership belong to several groups, which is the ordinary case', async () => {
      // Uniqueness is on the *pair*. A person who approves capital expenditure and also sits on the
      // hiring panel is two rows, and a globally unique membership would have made the second one
      // impossible — which would be a directory's rule, not a list's.
      const outcome = await fixture.asTenant(TENANT_A, async (client) => {
        await seedApprovalGroup(client, TENANT_A, [APPROVER], 'capital-approvers');

        const second = await seedApprovalGroup(client, TENANT_A, [], 'hiring-panel');

        return addMember(client, TENANT_A, second.approvalGroupId, APPROVER);
      });

      expect(outcome).toBe('accepted');
    });

    it('lets exactly one of two simultaneous additions of one person win', async () => {
      const group = await fixture.asTenant(TENANT_A, (client) =>
        seedApprovalGroup(client, TENANT_A, []),
      );
      const outcomes = await Promise.all([
        fixture.asTenant(TENANT_A, (client) =>
          addMember(client, TENANT_A, group.approvalGroupId, DEPUTY),
        ),
        fixture.onSecondConnection(TENANT_A, (client) =>
          addMember(client, TENANT_A, group.approvalGroupId, DEPUTY),
        ),
      ]);

      expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome !== 'accepted')).toContain(
        'workflow_approval_group_member_idx',
      );
    });

    it('lets exactly one of two simultaneous creations of one code win', async () => {
      const create = (connection: 'first' | 'second'): Promise<string> => {
        const work = (
          client: Parameters<Parameters<WorkflowFixture['asTenant']>[1]>[0],
        ): Promise<string> =>
          probe(
            client,
            `insert into workflow_approval_group (tenant_id, code, name, ${AUDIT_COLUMNS})
             values ($1, 'finance-directors', '{"en":"x","ar":"x"}'::jsonb, ${AUDIT_VALUES})`,
            [TENANT_A],
          );

        return connection === 'first'
          ? fixture.asTenant(TENANT_A, work)
          : fixture.onSecondConnection(TENANT_A, work);
      };
      const outcomes = await Promise.all([create('first'), create('second')]);

      expect(outcomes.filter((outcome) => outcome === 'accepted')).toHaveLength(1);
      expect(outcomes.find((outcome) => outcome !== 'accepted')).toContain(
        'workflow_approval_group_code_idx',
      );
    });
  });

  describe('the tenant boundary, which a foreign key would otherwise walk straight through', () => {
    it('refuses a member row naming a group in another tenant', async () => {
      const group = await fixture.asTenant(TENANT_A, (client) =>
        seedApprovalGroup(client, TENANT_A, [APPROVER]),
      );
      const refusal = await fixture.asTenant(TENANT_B, (client) =>
        addMember(client, TENANT_B, group.approvalGroupId, SECOND_APPROVER),
      );

      // The composite key doing the work. With a single-column reference this would have been
      // accepted: the parent row exists, and the referential check never asks whose it is.
      expect(refusal).toContain('workflow_approval_group_member_group_fk');
    });

    it('refuses a step template naming a group in another tenant', async () => {
      const group = await fixture.asTenant(TENANT_A, (client) =>
        seedApprovalGroup(client, TENANT_A, [APPROVER]),
      );
      const refusal = await fixture.asTenant(TENANT_B, async (client) => {
        const seeded = await seedDefinition(client, TENANT_B);

        return probe(
          client,
          `insert into workflow_step_template
             (tenant_id, workflow_version_id, ordinal, name, approver_kind, approver_group_id,
              ${AUDIT_COLUMNS})
           values ($1, $2, 2, '{"en":"x","ar":"x"}'::jsonb, 'group', $3, ${AUDIT_VALUES})`,
          [TENANT_B, seeded.workflowVersionId, group.approvalGroupId],
        );
      });

      expect(refusal).toContain('workflow_step_template_group_fk');
    });

    it('confines an unqualified delete of a group list to the current tenant', async () => {
      for (const tenantId of [TENANT_A, TENANT_B]) {
        await fixture.asTenant(tenantId, (client) => seedApprovalGroup(client, tenantId));
      }
      await fixture.asTenant(TENANT_A, (client) =>
        client.query(`delete from workflow_approval_group_member`),
      );

      const counted = async (tenantId: string): Promise<number> => {
        const { rows } = await fixture.asTenant(tenantId, (client) =>
          client.query<{ total: string }>(
            `select count(*)::text as total from workflow_approval_group_member`,
          ),
        );

        return Number(rows[0]?.total ?? '-1');
      };

      expect([await counted(TENANT_A), await counted(TENANT_B)]).toStrictEqual([0, 2]);
    });
  });

  describe('what the schema says about a group, in the catalogue', () => {
    it('names a group through a key that carries the tenant, and a person through no key at all', async () => {
      // The two 16B references are deliberately different shapes. A group is Workflow's own row, so
      // the reference is real — and composite, for the reason the probes above prove. A membership is
      // Identity's, so there is no key at all (ADR-0042), and `source_group_id` on a running step has
      // none either: it is provenance, and a key there would tie a live approval to an editable list.
      const { rows } = await fixture.admin.query<{ name: string; definition: string }>(
        `select c.conname as name, pg_get_constraintdef(c.oid) as definition
           from pg_constraint c join pg_class t on t.oid = c.conrelid
          where t.relname like 'workflow%' and c.contype = 'f' order by c.conname`,
      );
      const named = Object.fromEntries(rows.map((row) => [row.name, row.definition]));

      for (const key of [
        'workflow_approval_group_member_group_fk',
        'workflow_step_template_group_fk',
      ]) {
        expect([key, named[key]]).toStrictEqual([
          key,
          expect.stringContaining('tenant_id) REFERENCES workflow_approval_group(id, tenant_id)'),
        ]);
      }
      expect(rows.filter((row) => row.definition.includes('membership_id'))).toStrictEqual([]);
      expect(rows.filter((row) => row.definition.includes('source_group_id'))).toStrictEqual([]);
    });

    it('types both quorums as integer, because a quorum is a count of people', async () => {
      // The positive half of "no numeric, real, double precision, bigint or money". A quorum is a
      // number of responses and a threshold is a number of approvals; neither is a proportion, and
      // there is no column in this module a percentage or a weight could live in.
      const { rows } = await fixture.admin.query<{ table_name: string; data_type: string }>(
        `select table_name, data_type from information_schema.columns
          where table_schema = 'public' and column_name = 'quorum'
            and table_name = any($1::text[]) order by table_name`,
        [WORKFLOW_TABLES],
      );

      expect(rows.map((row) => [row.table_name, row.data_type])).toStrictEqual([
        ['workflow_step', 'integer'],
        ['workflow_step_template', 'integer'],
      ]);
    });
  });
});
