import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  CONNECTION,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  TENANT_A,
  WORKFLOW_TABLES,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { seedInstance } from './workflow-seed.js';

/**
 * The negative space of the schema, and whether the indexes that matter are reachable.
 *
 * **What is absent is asserted against the column list, not against the migration's prose.** The
 * migration has to name `role`, `sla` and `escalation` in order to explain why none of them exists,
 * so a text search over the file would fail against its own documentation. Columns cannot be
 * documented into existence: `information_schema.columns` is the only place a deferred capability
 * could actually be half-built, and that is what is searched.
 *
 * The plan probes are not a benchmark — that is Checkpoint 10. They establish something narrower and
 * worth knowing now: that the tenant predicate reaches the index, and that the reads this phase was
 * designed around are not sequential scans by construction. A fixture holds a handful of rows, so
 * PostgreSQL will legitimately prefer a scan; `enable_seqscan = off` asks the different question —
 * *is the index reachable at all* — which is the one a schema checkpoint can honestly answer.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's schema boundary suite");

const migrationAt = (directory: string): string =>
  join(process.cwd(), '..', '..', '..', 'prisma', 'migrations', directory, 'migration.sql');

/** Phase 16A's, and the routing migration Phase 16B Checkpoint 3 adds beside it. */
const ROUTING_MIGRATION = migrationAt('20260815100000_workflow_routing');
const MIGRATIONS = [migrationAt('20260814100000_workflow'), ROUTING_MIGRATION];

suite('what the Workflow schema deliberately does not contain', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_boundaries_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('has no column for any capability Phase 16A defers', async () => {
    const { rows } = await fixture.admin.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1::text[])`,
      [WORKFLOW_TABLES],
    );
    const columns = rows.map((row) => `${row.table_name}.${row.column_name}`);
    /**
     * Each fragment is what the *column* would be called if the capability had been built. Narrow
     * on purpose: `sla` rather than `s`, `escalat` rather than `level`, so an ordinary column name
     * cannot trip one.
     */
    const deferred: readonly (readonly [string, readonly string[]])[] = [
      ['a role directory', ['role', 'directory']],
      [
        'SLA and business days',
        ['sla', 'due_at', 'due_on', 'business_day', 'working_day', 'breach'],
      ],
      ['escalation', ['escalat']],
      ['scheduling', ['cron', 'schedule', 'run_at', 'next_run', 'job_']],
      // A tally is **derived** from the decisions that exist. A stored count would be a second
      // source of truth that disagrees with `workflow_decision` the moment two approvers commit at
      // once, and the decision table is the one an auditor reads.
      ['a stored tally', ['threshold', 'tally', 'vote', 'approvals_count', 'weight', 'percent']],
      ['an approval pattern', ['pattern']],
      ['manager routing', ['manager', 'reports_to', 'employment_id']],
      ['notification', ['notif', 'notified', 'recipient', 'reminder', 'email', 'sent_at']],
      ['analytics', ['analytic', 'percentile', 'aggregate', 'histogram']],
      ['an external approver', ['external', 'webhook', 'endpoint', 'callback']],
      ['another module’s facts', ['criticality', 'nine_box', 'talent', 'potential', 'salary']],
    ];

    for (const [capability, fragments] of deferred) {
      const present = columns.filter((column) =>
        fragments.some((fragment) => column.toLowerCase().includes(fragment)),
      );

      expect([capability, present]).toStrictEqual([capability, []]);
    }
  });

  it('names those capabilities in the migrations’ prose, which is where they belong', () => {
    // The complement of the assertion above, and the reason it had to be written against columns.
    // If this ever fails, the migrations stopped explaining themselves.
    const sql = MIGRATIONS.map((path) => readFileSync(path, 'utf8')).join('\n');
    const explained = ['role', 'sla', 'escalation', 'pattern', 'tally'];

    for (const word of explained) {
      expect([word, new RegExp(`--[^\\n]*${word}`, 'i').test(sql)]).toStrictEqual([word, true]);
    }
  });

  it('destroys nothing, in either migration', () => {
    const sql = MIGRATIONS.map((path) => readFileSync(path, 'utf8'))
      .join('\n')
      .replace(/--[^\n]*/g, ' ')
      .toLowerCase();
    /**
     * **Destructive means "a row that existed can no longer be read", and nothing here is.**
     *
     * `drop constraint`, `drop index` and `drop not null` are not on this list, and that is a
     * deliberate distinction rather than an omission: Phase 16B replaces one check constraint and
     * two unique indexes with strictly **wider** ones, and widening is the single shape of change
     * that cannot invalidate a row that was legal before. The next test pins exactly which objects
     * are dropped, so a `drop` that was not one of those three fails rather than passing under this
     * looser rule.
     */
    const destructive = [
      'drop table',
      'drop column',
      'drop schema',
      'drop database',
      'truncate',
      'delete from',
      'rename',
    ];

    expect(destructive.filter((statement) => sql.includes(statement))).toStrictEqual([]);
    // A type change is the other way a column loses data. Matched as a phrase rather than by the
    // bare word `using`, which appears in every policy and in both immutability triggers.
    expect(/alter column \w+ (set data )?type/.test(sql)).toBe(false);
    // `drop policy if exists` inside `app_protect_table` is the foundation's, not a migration's.
    expect(sql.includes('drop policy')).toBe(false);
  });

  it('drops exactly the four objects Phase 16B replaces, and replaces every one of them', () => {
    const sql = readFileSync(ROUTING_MIGRATION, 'utf8').replace(/--[^\n]*/g, ' ');
    const dropped = [...sql.matchAll(/drop (constraint|index) (\w+)/g)].map(
      (match) => `${match[1] ?? ''}:${match[2] ?? ''}`,
    );

    expect(dropped.sort()).toStrictEqual([
      'constraint:workflow_step_template_approver_kind_check',
      'index:workflow_step_awaiting_idx',
      'index:workflow_step_ordinal_idx',
      'index:workflow_step_template_ordinal_idx',
    ]);
    // The only column ever altered, and it is a loosening: a `group` template names no person, so
    // `approver_membership_id` stops being mandatory — and the coherence constraint that replaces it
    // is stricter per row than `not null` was.
    expect(
      [...sql.matchAll(/alter column (\w+) ([a-z ]+)/g)].map((match) => match[0].trim()),
    ).toStrictEqual(['alter column approver_membership_id drop not null']);
    // Every dropped object is recreated in the same file, so nothing the schema had disappears.
    for (const name of [
      'workflow_step_template_approver_kind_check',
      'workflow_step_ordinal_idx',
      'workflow_step_template_ordinal_idx',
      'workflow_step_awaiting_idx',
    ]) {
      expect([
        name,
        sql.includes(`create index ${name}`) || sql.includes(`add constraint ${name}`),
      ]).toStrictEqual([name, true]);
    }
  });

  it('touches no table belonging to another module', () => {
    const sql = MIGRATIONS.map((path) => readFileSync(path, 'utf8'))
      .join('\n')
      .replace(/--[^\n]*/g, ' ');
    const created = [...sql.matchAll(/create table (\w+)/g)].map((match) => match[1] ?? '');
    const altered = [
      ...new Set([...sql.matchAll(/alter table (\w+)/g)].map((match) => match[1] ?? '')),
    ];

    expect(created.sort()).toStrictEqual([...WORKFLOW_TABLES].sort());
    // Phase 16B alters two of its own, and nothing else in the database.
    expect(altered.sort()).toStrictEqual(['workflow_step', 'workflow_step_template']);
  });

  it('adds exactly one migration directory, alongside the twenty-one that came before', () => {
    const directories = readdirSync(join(process.cwd(), '..', '..', '..', 'prisma', 'migrations'))
      .filter((entry) => /^\d{14}_/.test(entry))
      .sort();

    expect(directories.at(-1)).toBe('20260815100000_workflow_routing');
    expect(directories.filter((entry) => entry.includes('workflow'))).toHaveLength(2);
  });

  describe('the indexes the engine is designed around are reachable', () => {
    /**
     * The plan of one read, as the unprivileged role, inside a tenant's row-security context.
     *
     * Two things about the output are worth knowing before reading the assertions. **The policy is
     * inlined**: `app_current_tenant()` is `stable` and its body — `current_setting('app.tenant_id')`
     * — is what appears, hoisted into a `One-Time Filter` evaluated once per execution rather than
     * per row. And **which of two equally-costed indexes the planner picks is not a property worth
     * pinning at fixture size**: with a handful of rows several candidates cost the same, and
     * asserting a name would be asserting a tie-break. Index *choice* at real volume is Checkpoint
     * 10's benchmark. What is asserted here is what a schema checkpoint can honestly answer — that
     * an index is reachable at all, and that the tenant is part of its condition rather than a
     * filter applied afterwards.
     */
    // Each probe seeds its own subject: two calls in one test would otherwise derive the same
    // definition code and collide on `workflow_definition_code_idx`, which is the index doing its
    // job rather than anything to do with a plan.
    let probes = 0;
    const planFor = async (sql: string, values: readonly unknown[]): Promise<string> =>
      fixture.asTenant(TENANT_A, async (client) => {
        probes += 1;
        await seedInstance(
          client,
          TENANT_A,
          [APPROVER, SECOND_APPROVER],
          `requisition-${String(probes)}`,
        );
        // A handful of rows makes a sequential scan the honest choice, so the question asked is
        // "can the planner reach an index", not "does it prefer one at this size".
        await client.query('set local enable_seqscan = off');

        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `explain (format text) ${sql}`,
          values,
        );

        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });

    /** The tenant reached the index rather than being filtered after it, and nothing scanned. */
    const isBounded = (plan: string): boolean =>
      /Index (Only )?Scan/.test(plan) &&
      !plan.includes('Seq Scan') &&
      /Index Cond: \(\(?tenant_id =/.test(plan);

    it('serves the approval queue from its partial index, with the tenant inside the condition', async () => {
      const plan = await planFor(
        `select id from workflow_step
          where tenant_id = $1 and approver_membership_id = $2 and status = 'awaiting'
            and deleted_at is null order by id limit 50`,
        [TENANT_A, APPROVER],
      );

      // One candidate here, because the index is partial on exactly the state being asked for.
      expect(plan).toContain('workflow_step_queue_idx');
      expect(isBounded(plan)).toBe(true);
      // The policy, inlined to its body and evaluated once rather than per row.
      expect(plan).toContain("current_setting('app.tenant_id'");
      // Ordered by `id` in the index, so paging is a limit rather than a sort.
      expect(plan).not.toContain('Sort Key');
    });

    it('serves a business module’s lookup of its own subject from an index', async () => {
      const plan = await planFor(
        `select id from workflow_instance
          where tenant_id = $1 and subject_type = $2 and subject_id = $3 and deleted_at is null`,
        [TENANT_A, SUBJECT_TYPE, `requisition-${String(probes + 1)}`],
      );

      // Not pinned to `workflow_instance_subject_idx`: at fixture size it and
      // `workflow_instance_status_idx` cost the same, and the planner is entitled to either.
      expect(isBounded(plan)).toBe(true);
    });

    it('serves one instance’s chain and timeline from their own indexes', async () => {
      const chain = await planFor(
        `select id from workflow_decision
          where tenant_id = $1 and instance_id = $2 and deleted_at is null order by id`,
        [TENANT_A, '01930000-0000-7000-8000-0000000000ff'],
      );
      const timeline = await planFor(
        `select id from workflow_history
          where tenant_id = $1 and instance_id = $2 and deleted_at is null
          order by occurred_at, id`,
        [TENANT_A, '01930000-0000-7000-8000-0000000000ff'],
      );

      // These two have one candidate each, so the name is a property rather than a tie-break.
      expect(chain).toContain('workflow_decision_instance_idx');
      expect(timeline).toContain('workflow_history_instance_idx');
      expect([isBounded(chain), isBounded(timeline)]).toStrictEqual([true, true]);
    });

    it('serves “which version do I start” from the index ordered to answer it', async () => {
      const plan = await planFor(
        `select id from workflow_version
          where tenant_id = $1 and definition_id = $2 and status = 'published'
            and deleted_at is null order by version_number desc limit 1`,
        [TENANT_A, '01930000-0000-7000-8000-0000000000ee'],
      );

      expect(plan).toContain('workflow_version_published_idx');
      // `version_number desc` is in the index, so the newest published version is a read of one row
      // rather than a sort of all of them — which is what makes the selection cheap at any volume.
      expect(plan).not.toContain('Sort Key');
    });

    it('makes every unique index usable rather than merely present', async () => {
      const { rows } = await fixture.admin.query<{ indexname: string; valid: boolean }>(
        `select i.relname as indexname, x.indisvalid as valid
           from pg_index x join pg_class i on i.oid = x.indexrelid
           join pg_class t on t.oid = x.indrelid
          where t.relname = any($1::text[]) and x.indisunique order by i.relname`,
        [WORKFLOW_TABLES],
      );

      expect(rows.filter((row) => !row.valid)).toStrictEqual([]);
      // Nine primary keys, the six partial unique indexes the invariants rest on, and the group's
      // `(id, tenant_id)` key that lets a child reference carry a tenant. Two fewer partial ones than
      // 16A had: an ordinal and an awaiting step stopped being unique when a branch became several
      // steps, and `workflow-parallel.integration.test.ts` asserts what they permit instead.
      expect(rows).toHaveLength(16);
    });
  });
});
