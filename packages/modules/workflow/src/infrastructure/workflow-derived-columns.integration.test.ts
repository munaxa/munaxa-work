import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  WORKFLOW_TABLES,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';

/**
 * The negative half of the service-level schema: **nothing derived is stored, anywhere in the
 * module**.
 *
 * Split from the round-trip suite at the file-size budget, and the seam is a real one: that file is
 * about values surviving columns, and this one is about columns that must not exist at all. It reads
 * `information_schema` for all nine tables rather than the migration text, because the catalogue is
 * what the application actually meets — a column added by hand, by a later migration, or by a Prisma
 * push would be invisible to a test that read the migration file.
 *
 * A column named for a due time, an expiry or an elapsed count would be one of two mistakes, and both
 * are worth refusing by name. Either it is a **second source of truth** that disagrees with its own
 * inputs the first time somebody corrects a target — which is why `due_at` was refused in Checkpoint
 * 3 rather than added. Or it is a **state that needs something to write it**, and the only candidates
 * are a scheduler this phase does not have (D-16C-01) or a synthetic actor ADR-0045 refuses
 * (D-16C-02).
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's derived-column suite");

suite('what the module stores about time it does not', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_derived_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  /**
   * Nothing derived is stored, and this is the assertion that keeps it that way.
   *
   * Over `information_schema` for all nine tables rather than over the migration file, because the
   * catalogue is what the application actually meets. A column named for any of these would be a
   * second source of truth that disagrees with its own inputs — or, worse, a state that needs
   * something to write it, which is a scheduler this phase does not have.
   */
  it('declares no column for anything derived, scheduled or expired', async () => {
    const { rows } = await fixture.admin.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])`,
      [WORKFLOW_TABLES],
    );

    const offending = rows
      .filter((row) =>
        [
          'due',
          'expire',
          'expired',
          'breach',
          'overdue',
          'remaining',
          'elapsed',
          'schedul',
          'job',
          // `escalat` gave way to the narrower pair when Phase 16D added `escalated_at`. That column
          // is **provenance, not a derived value**: it says an approver was added rather than
          // snapshotted, and its absence is what the branch tally counts. What stays forbidden is a
          // column that would have to be *maintained* — a scheduled escalation time, or an
          // escalation level nothing moves.
          'escalate_at',
          'escalation_level',
          'notif',
          'sla',
        ].some((word) => row.column_name.includes(word)),
      )
      .map((row) => `${row.table_name}.${row.column_name}`);

    expect(offending).toStrictEqual([]);
  });

  /** And the three that *are* there, by name, so the assertion above cannot pass by emptiness. */
  it('declares exactly the three columns Phase 16C added, and no more', async () => {
    const { rows } = await fixture.admin.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])
          and (column_name like 'service_level%' or column_name = 'awaiting_at')
        order by table_name, column_name`,
      [WORKFLOW_TABLES],
    );

    expect(rows.map((row) => `${row.table_name}.${row.column_name}`)).toStrictEqual([
      'workflow_step.awaiting_at',
      'workflow_step.service_level_count',
      'workflow_step.service_level_unit',
      'workflow_step_template.service_level_count',
      'workflow_step_template.service_level_unit',
    ]);
  });
});
