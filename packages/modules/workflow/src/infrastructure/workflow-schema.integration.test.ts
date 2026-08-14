import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  AUDIT_COLUMNS,
  AUDIT_VALUES,
  CONNECTION,
  SECOND_APPROVER,
  TENANT_A,
  WORKFLOW_TABLES,
  openWorkflowFixture,
  probe,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedDefinition, seedInstance } from './workflow-seed.js';

/**
 * The shape of the schema, asserted against the database rather than against the migration file.
 *
 * Reading the migration proves what was written; querying `information_schema` and `pg_index` proves
 * what was *applied*. Those differ the day a migration is edited after being run somewhere, which is
 * exactly the day nobody notices.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's schema suite");

suite('the Workflow schema', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_schema_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('has exactly the seven tables this module owns', async () => {
    const { rows } = await fixture.admin.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'workflow%' order by table_name`,
    );

    expect(rows.map((row) => row.table_name).sort()).toStrictEqual([...WORKFLOW_TABLES].sort());
  });

  it('carries tenant_id, the audit columns, soft delete and a version on every table', async () => {
    const { rows } = await fixture.admin.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])`,
      [WORKFLOW_TABLES],
    );
    const required = [
      'tenant_id',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
      'deleted_at',
      'deleted_by',
      'version',
      'metadata',
    ];

    for (const table of WORKFLOW_TABLES) {
      const columns = rows.filter((row) => row.table_name === table).map((row) => row.column_name);

      expect([table, required.filter((column) => !columns.includes(column))]).toStrictEqual([
        table,
        [],
      ]);
    }
  });

  it('stores every instant as timestamptz and holds no date column at all', async () => {
    // Career's civil dates exist because a target date is the same day in every time zone. Nothing
    // in Workflow is a day: a request, a decision and a step becoming current are moments.
    const { rows } = await fixture.admin.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])
          and data_type in ('date', 'timestamp without time zone', 'timestamp with time zone')`,
      [WORKFLOW_TABLES],
    );

    expect(rows.filter((row) => row.data_type !== 'timestamp with time zone')).toStrictEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('holds no numeric, real, double precision, bigint or money column', async () => {
    const { rows } = await fixture.admin.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])
          and data_type in ('numeric', 'real', 'double precision', 'bigint', 'money')`,
      [WORKFLOW_TABLES],
    );

    expect(rows).toStrictEqual([]);
  });

  it('types both ordinals as integer rather than smallint, because AD-004 forbids a ceiling', async () => {
    const { rows } = await fixture.admin.query<{ table_name: string; data_type: string }>(
      `select table_name, data_type from information_schema.columns
        where table_schema = 'public' and column_name = 'ordinal'
          and table_name = any($1::text[]) order by table_name`,
      [WORKFLOW_TABLES],
    );

    expect(rows.map((row) => [row.table_name, row.data_type])).toStrictEqual([
      ['workflow_history', 'integer'],
      ['workflow_step', 'integer'],
      ['workflow_step_template', 'integer'],
    ]);
  });

  it('accepts an ordinal far beyond a smallint, which is the point of the type', async () => {
    await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedDefinition(client, TENANT_A);
      const written = await client.query<{ ordinal: number }>(
        `insert into workflow_step_template
           (tenant_id, workflow_version_id, ordinal, name, approver_kind, approver_membership_id,
            ${AUDIT_COLUMNS})
         values ($1, $2, 100000, '{"en":"x","ar":"x"}'::jsonb, 'membership', $3, ${AUDIT_VALUES})
         returning ordinal`,
        [TENANT_A, seeded.workflowVersionId, SECOND_APPROVER],
      );

      expect(written.rows[0]?.ordinal).toBe(100_000);
      expect(Number.isInteger(written.rows[0]?.ordinal)).toBe(true);
    });
  });

  it('has every index the module declares, and the partial ones are partial', async () => {
    const { rows } = await fixture.admin.query<{
      indexname: string;
      indexdef: string;
    }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and tablename = any($1::text[]) order by indexname`,
      [WORKFLOW_TABLES],
    );
    const named = Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));

    const expected = [
      'workflow_definition_code_idx',
      'workflow_definition_subject_idx',
      'workflow_version_number_idx',
      'workflow_version_published_idx',
      'workflow_step_template_ordinal_idx',
      'workflow_instance_open_subject_idx',
      'workflow_instance_subject_idx',
      'workflow_instance_status_idx',
      'workflow_step_ordinal_idx',
      'workflow_step_awaiting_idx',
      'workflow_step_queue_idx',
      'workflow_decision_step_idx',
      'workflow_decision_decider_idx',
      'workflow_decision_instance_idx',
      'workflow_history_instance_idx',
    ];

    expect(expected.filter((index) => named[index] === undefined)).toStrictEqual([]);

    // The seven that arbitrate an invariant are unique, and every one is partial: a unique index
    // over soft-deleted rows would refuse a code a tenant had already discarded.
    const unique = [
      'workflow_definition_code_idx',
      'workflow_version_number_idx',
      'workflow_step_template_ordinal_idx',
      'workflow_instance_open_subject_idx',
      'workflow_step_ordinal_idx',
      'workflow_step_awaiting_idx',
      'workflow_decision_step_idx',
    ];

    for (const index of unique) {
      expect([index, named[index]?.includes('UNIQUE')]).toStrictEqual([index, true]);
      expect([index, named[index]?.includes('WHERE')]).toStrictEqual([index, true]);
    }
    // The two queue-shaped reads are partial on the open state, so they stay the size of the work.
    // PostgreSQL renders the predicate with its own casts — `(status)::text = 'awaiting'::text` —
    // so the assertion is on the state named in the WHERE clause rather than on the exact spelling.
    const predicateOf = (index: string): string =>
      named[index]?.slice(named[index]?.indexOf('WHERE') ?? 0) ?? '';

    expect(predicateOf('workflow_step_awaiting_idx')).toContain("'awaiting'");
    expect(predicateOf('workflow_step_queue_idx')).toContain("'awaiting'");
    expect(predicateOf('workflow_instance_open_subject_idx')).toContain("'running'");
    for (const index of unique) {
      expect([index, predicateOf(index).includes('deleted_at IS NULL')]).toStrictEqual([
        index,
        true,
      ]);
    }
  });

  it('has no foreign key leaving the module', async () => {
    const { rows } = await fixture.admin.query<{
      child: string;
      parent: string;
      name: string;
    }>(
      `select tc.table_name as child, ccu.table_name as parent, tc.constraint_name as name
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
        where tc.constraint_type = 'FOREIGN KEY' and tc.table_name = any($1::text[])`,
      [WORKFLOW_TABLES],
    );

    expect(rows.filter((row) => !row.parent.startsWith('workflow_'))).toStrictEqual([]);
    // Nine, and every one of them inside Workflow. Delegation in particular is Identity's: a
    // decision stores the membership it acted for as a value, never as a reference (AD-010).
    expect(rows).toHaveLength(9);
  });

  it('refuses a subject type that names no module, in both places it appears', async () => {
    const refusal = await fixture.asTenant(TENANT_A, (client) =>
      probe(
        client,
        `insert into workflow_definition (tenant_id, code, name, subject_type, status,
           ${AUDIT_COLUMNS})
         values ($1, 'x', '{"en":"x","ar":"x"}'::jsonb, 'norealsubject', 'active',
                 ${AUDIT_VALUES})`,
        [TENANT_A],
      ),
    );

    expect(refusal).toContain('workflow_definition_subject_type_shape_check');
  });

  it('refuses a decision whose delegation and authority disagree', async () => {
    const refusals = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedInstance(client, TENANT_A);
      const attempt = (authority: string, onBehalfOf: string | null): Promise<string> =>
        probe(
          client,
          `insert into workflow_decision
             (tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority,
              on_behalf_of_membership_id, decided_at, ${AUDIT_COLUMNS})
           values ($1, $2, $3, 'approved', $4, $5, $6, now(), ${AUDIT_VALUES})`,
          [TENANT_A, seeded.instanceId, seeded.stepIds[0], SECOND_APPROVER, authority, onBehalfOf],
        );

      // Delegated, naming nobody. And assigned, naming somebody.
      return [await attempt('delegated', null), await attempt('assigned', APPROVER)];
    });

    expect(refusals).toHaveLength(2);
    for (const refusal of refusals) expect(refusal).toContain('workflow_decision_delegation_check');
  });

  it('refuses a delegation to the decider themselves', async () => {
    const refusal = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedInstance(client, TENANT_A);

      return probe(
        client,
        `insert into workflow_decision
           (tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority,
            on_behalf_of_membership_id, decided_at, ${AUDIT_COLUMNS})
         values ($1, $2, $3, 'approved', $4, 'delegated', $4, now(), ${AUDIT_VALUES})`,
        [TENANT_A, seeded.instanceId, seeded.stepIds[0], APPROVER],
      );
    });

    expect(refusal).toContain('workflow_decision_self_delegation_check');
  });

  it('refuses the auto-approving actor on a decision', async () => {
    const refusal = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedInstance(client, TENANT_A);

      return probe(
        client,
        `insert into workflow_decision
           (tenant_id, instance_id, step_id, decision, decided_by_membership_id, authority,
            decided_at, created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, 'approved', $4, 'assigned', now(), now(), 'system:auto-approval',
                 now(), 'user:test', 1)`,
        [TENANT_A, seeded.instanceId, seeded.stepIds[0], APPROVER],
      );
    });

    expect(refusal).toContain('workflow_decision_human_check');
  });

  it('requires a terminal instance to say when it ended, and a cancelled one to say who and why', async () => {
    const refusals = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedInstance(client, TENANT_A);
      const move = (assignments: string): Promise<string> =>
        probe(client, `update workflow_instance set ${assignments} where id = $1`, [
          seeded.instanceId,
        ]);

      return [
        await move(`status = 'completed'`),
        await move(`status = 'cancelled', completed_at = now()`),
        await move(`status = 'cancelled', completed_at = now(), cancelled_by = 'user:admin'`),
      ];
    });

    expect(refusals[0]).toContain('workflow_instance_completion_check');
    expect(refusals[1]).toContain('workflow_instance_cancellation_check');
    expect(refusals[2]).toContain('workflow_instance_cancellation_reason_check');
  });

  it('refuses a history entry that names an ordinal without a step, or acts for somebody without acting', async () => {
    const refusals = await fixture.asTenant(TENANT_A, async (client) => {
      const seeded = await seedInstance(client, TENANT_A);
      const attempt = (columns: string, values: string): Promise<string> =>
        probe(
          client,
          `insert into workflow_history (tenant_id, instance_id, event, occurred_at, ${columns},
             ${AUDIT_COLUMNS})
           values ($1, $2, 'step-approved', now(), ${values}, ${AUDIT_VALUES})`,
          [TENANT_A, seeded.instanceId],
        );

      return [
        await attempt('ordinal', '1'),
        await attempt('on_behalf_of_membership_id', `'${APPROVER}'::uuid`),
      ];
    });

    expect(refusals[0]).toContain('workflow_history_step_check');
    expect(refusals[1]).toContain('workflow_history_authority_check');
  });
});
