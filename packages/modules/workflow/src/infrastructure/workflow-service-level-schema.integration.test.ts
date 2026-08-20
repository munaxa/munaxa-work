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
import { seedDefinition, seedInstance } from './workflow-seed.js';

/**
 * The service-level target in the database, and the derived facts that are deliberately not there.
 *
 * Split from `workflow-resolution.integration.test.ts` at the file-size budget, along the seam Phase
 * 16C itself has: next door is about **who** a step asks, and this is about **how long** it is
 * expected to take.
 *
 * **What is stored is the configuration and one authoritative instant.** A whole count, a unit, and
 * the moment the step became awaiting. Due-ness is computed from those three plus an explicit
 * reading instant, every time it is asked — so there is no `due_at` to disagree with its own inputs
 * the first time somebody corrects a target, and no `expired` for a scheduler that does not exist to
 * write (D-16C-01, D-16C-06).
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's service-level schema suite");

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

suite('the service-level schema', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_service_level_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  describe('the target, and the instant it counts from', () => {
    it('carries a whole count and a unit on the template and on the step', async () => {
      const template = await columnsOf(fixture, 'workflow_step_template');
      const step = await columnsOf(fixture, 'workflow_step');

      for (const columns of [template, step]) {
        expect(columns.get('service_level_count')).toStrictEqual({
          type: 'integer',
          nullable: true,
        });
        expect(columns.get('service_level_unit')).toStrictEqual({
          type: 'character varying',
          nullable: true,
        });
      }
    });

    /**
     * An instant, and emphatically not a civil date.
     *
     * A `date` here would answer "which day did this become awaiting" — the wrong question for a
     * target measured in hours, and a value whose meaning would depend on a time zone nobody chose.
     */
    it('records when a step became awaiting as a timestamptz', async () => {
      const step = await columnsOf(fixture, 'workflow_step');

      expect(step.get('awaiting_at')).toStrictEqual({
        type: 'timestamp with time zone',
        nullable: true,
      });
    });

    /** Nullable and defaulted to nothing: a step nobody has reached has no clock. */
    it('leaves the instant and the target empty on a step that carries neither', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);
        const rows = await client.query<{
          awaiting_at: Date | null;
          service_level_count: number | null;
          service_level_unit: string | null;
        }>(
          `select awaiting_at, service_level_count, service_level_unit
             from workflow_step where tenant_id = $1 and instance_id = $2`,
          [TENANT_A, seeded.instanceId],
        );

        expect(rows.rows[0]).toStrictEqual({
          awaiting_at: null,
          service_level_count: null,
          service_level_unit: null,
        });
      });
    });

    it('takes a target and an instant when a step actually has them', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);

        await client.query(
          `insert into workflow_step
             (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
              service_level_count, service_level_unit, awaiting_at, ${AUDIT_COLUMNS})
           values ($1, $2, 4, 'membership', $3, 'awaiting', 2, 'days',
                   timestamptz '2026-08-16T09:00:00Z', ${AUDIT_VALUES})`,
          [TENANT_A, seeded.instanceId, SECOND_APPROVER],
        );

        const rows = await client.query<{
          service_level_count: number;
          service_level_unit: string;
          awaiting_at: Date;
        }>(
          `select service_level_count, service_level_unit, awaiting_at
             from workflow_step where tenant_id = $1 and ordinal = 4`,
          [TENANT_A],
        );

        // An integer, not a string and not a float: the mapper has nothing to round.
        expect(rows.rows[0]?.service_level_count).toBe(2);
        expect(Number.isInteger(rows.rows[0]?.service_level_count)).toBe(true);
        expect(rows.rows[0]?.service_level_unit).toBe('days');
        expect(rows.rows[0]?.awaiting_at).toBeInstanceOf(Date);
        expect(rows.rows[0]?.awaiting_at.toISOString()).toBe('2026-08-16T09:00:00.000Z');
      });
    });

    /** Both or neither: a count with no unit is a duration nobody can read. */
    it('refuses a count without a unit, and a unit without a count', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedInstance(client, TENANT_A);
        const write = (count: string, unit: string) =>
          probe(
            client,
            `insert into workflow_step
               (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
                service_level_count, service_level_unit, ${AUDIT_COLUMNS})
             values ($1, $2, 6, 'membership', $3, 'pending', ${count}, ${unit}, ${AUDIT_VALUES})`,
            [TENANT_A, seeded.instanceId, SECOND_APPROVER],
          );

        expect(await write('2', 'null')).toContain('[workflow_step_service_level_check]');
        expect(await write('null', `'days'`)).toContain('[workflow_step_service_level_check]');
      });
    });

    it('refuses a target of zero, a negative one, and a unit nobody declared', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);
        const write = (count: string, unit: string) =>
          probe(
            client,
            `insert into workflow_step_template
               (tenant_id, workflow_version_id, ordinal, name, approver_kind,
                approver_membership_id, service_level_count, service_level_unit, ${AUDIT_COLUMNS})
             values ($1, $2, 3, '{"en":"Step","ar":"خطوة"}'::jsonb, 'membership', $3,
                     ${count}, ${unit}, ${AUDIT_VALUES})`,
            [TENANT_A, seeded.workflowVersionId, APPROVER],
          );

        for (const [count, unit] of [
          ['0', `'hours'`],
          ['-1', `'hours'`],
          ['1', `'minutes'`],
        ] as const) {
          expect([count, unit, await write(count, unit)]).toStrictEqual([
            count,
            unit,
            expect.stringContaining('[workflow_step_template_service_level_check]') as unknown,
          ]);
        }

        // `business-days` is refused by the **column** rather than by the constraint: thirteen
        // characters into a `varchar(8)` that fits `hours` and `days` and nothing longer. Recorded
        // as what actually happens rather than as what was expected — it is the stronger refusal of
        // the two, because a type cannot be dropped by a later migration without the column going
        // with it.
        expect(await write('1', `'business-days'`)).toContain('value too long');
      });
    });

    /**
     * A fraction cannot reach the column, and the reason is the column's own type.
     *
     * PostgreSQL **rounds** a real into an integer rather than refusing it, so a check constraint
     * could never have caught `1.5`. What makes a fractional target impossible is that there is no
     * numeric column for one to live in — which is why this asserts the type rather than a refusal.
     */
    it('cannot hold a fractional target, because the column is an integer', async () => {
      await fixture.asTenant(TENANT_A, async (client) => {
        const seeded = await seedDefinition(client, TENANT_A);

        await client.query(
          `insert into workflow_step_template
             (tenant_id, workflow_version_id, ordinal, name, approver_kind,
              approver_membership_id, service_level_count, service_level_unit, ${AUDIT_COLUMNS})
           values ($1, $2, 2, '{"en":"Step","ar":"خطوة"}'::jsonb, 'membership', $3,
                   1.5, 'hours', ${AUDIT_VALUES})`,
          [TENANT_A, seeded.workflowVersionId, APPROVER],
        );

        const rows = await client.query<{ service_level_count: number }>(
          `select service_level_count from workflow_step_template
            where tenant_id = $1 and ordinal = 2`,
          [TENANT_A],
        );

        // Rounded to 2 by PostgreSQL, not stored as 1.5. The domain refuses the fraction before it
        // ever reaches here (`serviceLevelTarget`), and this records what the column alone can do.
        expect(rows.rows[0]?.service_level_count).toBe(2);
        expect(Number.isInteger(rows.rows[0]?.service_level_count)).toBe(true);
      });
    });
  });

  describe('what this migration did not add', () => {
    /**
     * The negative space, over the catalogue rather than over the migration's prose.
     *
     * Every name below would be a stored derived fact or a deferred capability: a due time that
     * disagrees with its inputs, an expiry nothing can write, an escalation level, a scheduler's
     * bookkeeping. None exists, and the migration's comments explaining why do not affect this
     * assertion because it reads `information_schema`.
     *
     * **`escalated_at` left this list in Phase 16D**, and it is the one name here that was ever going
     * to. It is not a derived fact and not a scheduler's bookkeeping: it records that an approver was
     * *added* rather than snapshotted, and its absence is what the branch tally counts as the
     * denominator. `escalation_level` stays, because a level is a chain nobody approved and nothing
     * would climb.
     */
    it('added no derived, expiry, escalation or scheduling column to any Workflow table', async () => {
      const { rows } = await fixture.admin.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and table_name like 'workflow%'`,
      );
      const names = rows.map((row) => `${row.table_name}.${row.column_name}`);

      for (const forbidden of [
        'due_at',
        'due_on',
        'expires_at',
        'expired_at',
        'overdue',
        'breached',
        'escalation_level',
        'sla_id',
        'role_id',
        'job_id',
        'scheduled_at',
        'notified_at',
        'reminder_at',
      ]) {
        const present = names.filter((name) => name.endsWith(`.${forbidden}`));

        expect([forbidden, present]).toStrictEqual([forbidden, []]);
      }
    });

    it('added no table at all', async () => {
      const { rows } = await fixture.admin.query<{ relname: string }>(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'workflow%'`,
      );

      expect(rows).toHaveLength(9);
    });

    /** And no inexact type arrived with the target. */
    it('introduced no numeric, real, double, bigint or money column', async () => {
      const { rows } = await fixture.admin.query<{ data_type: string }>(
        `select distinct data_type from information_schema.columns
          where table_schema = 'public' and table_name like 'workflow%'`,
      );
      const types = rows.map((row) => row.data_type).sort();

      expect(types).toStrictEqual([
        'character varying',
        'integer',
        'jsonb',
        'timestamp with time zone',
        'uuid',
      ]);
    });
  });
});
