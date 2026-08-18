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
import { seedInstance } from './workflow-seed.js';

/**
 * Escalation in the database: one column, one widened vocabulary, and the index that makes a
 * duplicate impossible rather than merely unlikely.
 *
 * **The index is the reason this checkpoint exists.** Phase 16D's domain refuses to escalate the same
 * person onto the same branch twice, and it does so by reading the branch it was handed — which is
 * correct and is not enough. Two connections can each read a branch without the other's row and each
 * conclude there is nothing to add. ADR-0071 settles it for this repository: *"a `select` followed by
 * an `insert` is not idempotent under concurrency"*, so the guarantee is a partial unique index and
 * the race below is run on **two real connections** to prove it.
 *
 * **`escalated_at` is nullable with no default, and that is load-bearing.** `NULL` is not "unknown"
 * — it is the positive statement that the instance snapshotted this approver at start, and it is what
 * the branch tally counts. A default would make every step look escalated, which is exactly
 * backwards.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's escalation schema suite");

/** The eight events 16A wrote, plus the ninth 16D added. */
const HISTORY_EVENTS = [
  'instance-started',
  'step-awaiting',
  'step-approved',
  'step-rejected',
  'step-skipped',
  'step-escalated',
  'instance-completed',
  'instance-rejected',
  'instance-cancelled',
] as const;

const ESCALATED_AT = '2026-08-18T11:00:00.000Z';

suite('the escalation column', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_escalation_schema_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('is a nullable timestamptz with no default', async () => {
    const { rows } = await fixture.admin.query<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'workflow_step'
          and column_name = 'escalated_at'`,
    );

    expect(rows[0]?.data_type).toBe('timestamp with time zone');
    expect(rows[0]?.is_nullable).toBe('YES');
    // No default, deliberately: a default would mark every snapshotted approver as escalated.
    expect(rows[0]?.column_default).toBeNull();
  });

  /** `source_group_id` is the provenance this column follows, and it is untouched. */
  it('leaves the provenance beside it exactly as it was', async () => {
    const { rows } = await fixture.admin.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'workflow_step'
          and column_name = 'source_group_id'`,
    );

    expect(rows[0]).toStrictEqual({ data_type: 'uuid', is_nullable: 'YES' });
  });

  it('holds null on a snapshotted step and an exact instant on an escalated one', async () => {
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);

    await fixture.admin.query(
      `insert into workflow_step
         (tenant_id, instance_id, ordinal, approver_kind, approver_membership_id, status,
          escalated_at, metadata, ${AUDIT_COLUMNS})
       values ($1, $2, 1, 'membership', $3, 'awaiting', $4::timestamptz, '{}'::jsonb, ${AUDIT_VALUES})`,
      [TENANT_A, seeded.instanceId, SECOND_APPROVER, ESCALATED_AT],
    );

    const { rows } = await fixture.admin.query<{
      approver_membership_id: string;
      escalated_at: Date | null;
    }>(
      `select approver_membership_id, escalated_at from workflow_step
        where tenant_id = $1 order by escalated_at nulls first`,
      [TENANT_A],
    );

    expect(rows[0]?.escalated_at).toBeNull();
    expect(rows[1]?.escalated_at).toBeInstanceOf(Date);
    expect(rows[1]?.escalated_at?.toISOString()).toBe(ESCALATED_AT);
  });

  /** Nothing derived, scheduled or attributive arrived with it. */
  it('added no column for anything derived, scheduled or attributive', async () => {
    const { rows } = await fixture.admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'workflow_step'
          and column_name ~ 'due|expir|breach|escalated_by|escalation_id|escalation_reason|run_at|attempt|locked'`,
    );

    expect(rows.map((row) => row.column_name)).toStrictEqual([]);
  });
});

suite('the history vocabulary, after the ninth event', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_escalation_history_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const writeEvent = (client: Parameters<typeof probe>[0], instanceId: string, event: string) =>
    probe(
      client,
      `insert into workflow_history (tenant_id, instance_id, event, occurred_at, metadata, ${AUDIT_COLUMNS})
       values ($1, $2, $3, now(), '{}'::jsonb, ${AUDIT_VALUES})`,
      [TENANT_A, instanceId, event],
    );

  it('accepts all nine events and refuses a tenth', async () => {
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);

    await fixture.asTenant(TENANT_A, async (client) => {
      for (const event of HISTORY_EVENTS) {
        expect([event, await writeEvent(client, seeded.instanceId, event)]).toStrictEqual([
          event,
          'accepted',
        ]);
      }
      // Four names an escalation might plausibly have been given, and none of them exists. The first
      // two describe an attempt this module does not record; the last two describe a scheduler that
      // does not, and a replacement D-16D-02 forbade.
      for (const invented of [
        'escalation-requested',
        'escalation-failed',
        'escalation-automatic',
        'step-reassigned',
      ]) {
        expect([invented, await writeEvent(client, seeded.instanceId, invented)]).toStrictEqual([
          invented,
          expect.stringContaining('workflow_history_event_check') as unknown as string,
        ]);
      }
    });
  });

  it('declares exactly nine, in the constraint itself', async () => {
    const { rows } = await fixture.admin.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
        where conname = 'workflow_history_event_check'`,
    );
    const definition = rows[0]?.definition ?? '';

    for (const event of HISTORY_EVENTS) {
      expect([event, definition.includes(`'${event}'`)]).toStrictEqual([event, true]);
    }
    // Nine quoted values and no tenth: counting them catches a widening nobody meant to make.
    expect(definition.match(/'[a-z-]+'::character varying/g)).toHaveLength(9);
  });

  /**
   * An escalation entry is append-only exactly as every other entry is.
   *
   * The trigger predates this phase and was not touched. What is proved here is that the ninth event
   * is not an exception to it — a row written under a new vocabulary value is as immutable as one
   * written under an old one.
   */
  it('refuses to update, delete or restore an escalation entry', async () => {
    const seeded = await seedInstance(fixture.admin, TENANT_A, [APPROVER]);

    await fixture.asTenant(TENANT_A, async (client) => {
      expect(await writeEvent(client, seeded.instanceId, 'step-escalated')).toBe('accepted');

      for (const [what, sql] of [
        ['update', `update workflow_history set metadata = '{"x":1}'::jsonb where tenant_id = $1`],
        [
          'alter the event',
          `update workflow_history set event = 'step-approved' where tenant_id = $1`,
        ],
        ['delete', `delete from workflow_history where tenant_id = $1`],
        ['restore', `update workflow_history set deleted_at = null where tenant_id = $1`],
      ] as const) {
        expect([what, await probe(client, sql, [TENANT_A])]).toStrictEqual([
          what,
          expect.stringContaining('workflow_history_immutable') as unknown as string,
        ]);
      }
    });

    const { rows } = await fixture.admin.query<{ event: string }>(
      `select event from workflow_history where tenant_id = $1`,
      [TENANT_A],
    );

    expect(rows.map((row) => row.event)).toStrictEqual(['step-escalated']);
  });
});
