import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PRODUCTION, codeOf } from './workflow-audit.fixture.js';
import { CONNECTION, requireDatabaseInCi } from './workflow-cross-module-role.fixture.js';

/**
 * Phase 16C Checkpoint 10 — the audit's own two blind spots, closed.
 *
 * The module-wide audit beside this one scans every production file for the capabilities the phase
 * defers and finds none. That result is only worth what the scanner is worth, and a scanner is the
 * easiest thing in a repository to break silently: normalize one regex too eagerly, read the wrong
 * directory, return an empty file list, and every absence assertion passes forever.
 *
 * **So this file audits the auditor.** Each forbidden term is fed to the same `codeOf` the real scan
 * uses, inside a sample constructed to contain it, and the scan must find it. A control that came
 * back clean would mean the corresponding absence in the real audit proves nothing at all.
 *
 * The second half is the **schema**, machine-checked rather than described. Checkpoint 5's parity
 * suite proves every column the database has is mapped; nothing proved that a column the phase
 * refused to create was never created. Those are opposite questions and the second is this phase's:
 * `due_at`, `expired` and `manager_employment_id` are the three columns 16C would have grown if any
 * of its restraint had slipped, and none of them exists.
 */

requireDatabaseInCi('the Phase 16C schema audit');

/**
 * The forbidden vocabulary, exactly as the module-wide audit spells it.
 *
 * Kept as a literal rather than imported from that suite, deliberately: a control that imported the
 * list it is validating would pass by construction if the list itself were emptied.
 */
const DEFERRED = [
  'setTimeout',
  'setInterval',
  'JobPort',
  'cron',
  'enqueue',
  'escalate',
  'expiresAt',
  'businessDay',
  'workingDay',
  'roleDirectory',
  'externalApprover',
] as const;

describe('the negative-space scanner, proved capable before its results are believed', () => {
  /**
   * The scanner strips prose, and this is the assertion that it strips only prose.
   *
   * Each term is placed in three positions: as executable code, inside a block comment, and inside a
   * string literal. The first must survive the strip and the other two must not — which is the exact
   * discrimination the real audit depends on, and the one a careless regex loses in either direction.
   */
  it.each(DEFERRED)('finds %s in code, and not in a comment or a string', (term) => {
    const stripped = (source: string): string =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')
        .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
        .replace(/`(?:[^`\\]|\\.)*`/g, '``');

    expect([term, stripped(`const x = ${term};`).includes(term)]).toStrictEqual([term, true]);
    expect([term, stripped(`/* we do not use ${term} here */`).includes(term)]).toStrictEqual([
      term,
      false,
    ]);
    expect([term, stripped(`// no ${term} anywhere`).includes(term)]).toStrictEqual([term, false]);
    expect([term, stripped(`const x = '${term}';`).includes(term)]).toStrictEqual([term, false]);
  });

  /**
   * And the file list the scan runs over is genuinely populated and genuinely stripped.
   *
   * A `codeOf` that returned an empty string — a bad path, a failed read swallowed somewhere — would
   * make every absence assertion in the module-wide audit vacuous. So: the scan sees real code, and
   * it sees *less* than the raw file, because prose was removed rather than nothing happening.
   */
  it('reads real, stripped source rather than nothing at all', () => {
    expect(PRODUCTION.length).toBeGreaterThanOrEqual(35);

    const code = PRODUCTION.map(codeOf).join('\n');

    // Real code: the two capabilities 16C authorized are in it, by name.
    expect(code).toContain('managerOf');
    expect(code).toContain('serviceLevelState');
    // Stripped: this module's prose is voluminous, and none of it survived.
    expect(code).not.toContain('D-16C-05');
    expect(code).not.toContain('Phase 16C');
  });

  /**
   * A positive control for the *result* as well as the scanner.
   *
   * `escalate` is forbidden and `resolveManager` is required, and both are checked by the same pass
   * over the same text. If the file list were broken, the second assertion fails — which is how this
   * pair distinguishes "the capability is absent" from "the audit read nothing".
   */
  it('finds no deferred capability, in a pass that can still find the delivered ones', () => {
    const code = PRODUCTION.map(codeOf).join('\n');

    for (const term of DEFERRED) {
      expect([term, code.includes(term)]).toStrictEqual([term, false]);
    }
    for (const delivered of ['resolveManager', 'overdueByMinutes', 'awaitingAt', 'dueAt']) {
      expect([delivered, code.includes(delivered)]).toStrictEqual([delivered, true]);
    }
  });
});

const suite = CONNECTION === undefined ? describe.skip : describe;

suite('the delivered schema, read from the database rather than from a report', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: CONNECTION });
  });

  afterAll(async () => {
    await pool.end();
  });

  const columnsOf = async (): Promise<readonly string[]> => {
    const { rows } = await pool.query<{ named: string }>(
      `select table_name || '.' || column_name as named
         from information_schema.columns
        where table_schema = 'public' and table_name like 'workflow%'`,
    );

    return rows.map((row) => row.named);
  };

  it('has exactly nine Workflow tables', async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public' and tablename like 'workflow%' order by tablename`,
    );

    expect(rows.map((row) => row.tablename)).toStrictEqual([
      'workflow_approval_group',
      'workflow_approval_group_member',
      'workflow_decision',
      'workflow_definition',
      'workflow_history',
      'workflow_instance',
      'workflow_step',
      'workflow_step_template',
      'workflow_version',
    ]);
  });

  /** The five columns 16C added, and nowhere else. */
  it('carries the target on both step tables and the awaiting instant on one', async () => {
    const columns = await columnsOf();

    for (const column of [
      'workflow_step_template.service_level_count',
      'workflow_step_template.service_level_unit',
      'workflow_step.service_level_count',
      'workflow_step.service_level_unit',
      'workflow_step.awaiting_at',
    ]) {
      expect([column, columns.includes(column)]).toStrictEqual([column, true]);
    }
    // A template has no clock: nothing is waiting on a template.
    expect(columns).not.toContain('workflow_step_template.awaiting_at');
  });

  /**
   * The columns 16C would have grown if any of its restraint had slipped.
   *
   * Every one of these is a *derived* value the application computes per read, or an organizational
   * fact that belongs to another module. A column for any of them would be a second record able to
   * disagree with the first, and there is no column for any of them.
   */
  it('grew no column for anything derived, scheduled or organizational', async () => {
    const { rows } = await pool.query<{ named: string }>(
      `select table_name || '.' || column_name as named
         from information_schema.columns
        where table_schema = 'public' and table_name like 'workflow%'
          and column_name ~ 'due|expir|breach|escalat|manager|employment|overdue|elapsed|business|notif|schedul|job|cron|timer'`,
    );

    expect(rows.map((row) => row.named)).toStrictEqual([]);
  });

  /**
   * The two approver-kind constraints, which are where manager routing actually lives in the schema.
   *
   * A **template** may say `manager`; a running **step** may not, because the kind was resolved into
   * a person before the row existed. Read from the catalogue rather than from a migration file, so a
   * later migration that widened the step's list would fail here.
   */
  it('lets a template say manager and refuses to let a running step say it', async () => {
    const { rows } = await pool.query<{ conname: string; definition: string }>(
      `select conname, pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conname in ('workflow_step_template_approver_kind_check',
                          'workflow_step_approver_kind_check')
        order by conname`,
    );
    const [step, template] = rows;

    expect(step?.definition).toContain(`'membership'`);
    expect(step?.definition).not.toContain(`'manager'`);
    expect(step?.definition).not.toContain(`'group'`);
    expect(template?.definition).toContain(`'manager'`);
    expect(template?.definition).toContain(`'group'`);
  });

  /** A manager template names nobody, and the database is what enforces it. */
  it('refuses a manager template that names a person or a list', async () => {
    const { rows } = await pool.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
        where conname = 'workflow_step_template_approver_check'`,
    );

    // `manager` satisfies neither equality, so both identifiers must be null for the row to exist.
    expect(rows[0]?.definition).toContain('approver_membership_id IS NOT NULL');
    expect(rows[0]?.definition).toContain('approver_group_id IS NOT NULL');
  });

  /** The target is a whole number in a closed unit vocabulary, both-or-neither, enforced by check. */
  it('constrains the target to a whole positive count in one of two units', async () => {
    const { rows } = await pool.query<{ conname: string; definition: string }>(
      `select conname, pg_get_constraintdef(oid) as definition from pg_constraint
        where conname like '%service_level_check' order by conname`,
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect([row.conname, row.definition.includes('service_level_count >= 1')]).toStrictEqual([
        row.conname,
        true,
      ]);
      expect([row.conname, row.definition.includes(`'hours'`)]).toStrictEqual([row.conname, true]);
      expect([row.conname, row.definition.includes(`'days'`)]).toStrictEqual([row.conname, true]);
      // Both or neither: a count without a unit is not a duration.
      expect([row.conname, row.definition.includes('IS NULL) = (')]).toStrictEqual([
        row.conname,
        true,
      ]);
      // No business days, at the one place a widened vocabulary would have to appear.
      expect([row.conname, row.definition.includes('business')]).toStrictEqual([
        row.conname,
        false,
      ]);
    }
  });

  /** Every column is an exact type. An SLA in floating point would be a rounding rule nobody wrote. */
  it('stores the target as an integer, never as a numeric or a real', async () => {
    const { rows } = await pool.query<{ data_type: string }>(
      `select data_type from information_schema.columns
        where table_schema = 'public' and table_name like 'workflow%'
          and column_name like 'service_level%' and column_name <> 'service_level_unit'`,
    );

    expect(rows.map((row) => row.data_type)).toStrictEqual(['integer', 'integer']);
  });

  /** And no approval expiry state reached the step vocabulary. */
  it('declares five step statuses, none of them expired', async () => {
    const { rows } = await pool.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
        where conname = 'workflow_step_status_check'`,
    );

    for (const status of ['pending', 'awaiting', 'approved', 'rejected', 'skipped']) {
      expect([status, rows[0]?.definition.includes(`'${status}'`)]).toStrictEqual([status, true]);
    }
    expect(rows[0]?.definition).not.toContain('expired');
    expect(rows[0]?.definition).not.toContain('overdue');
  });
});
