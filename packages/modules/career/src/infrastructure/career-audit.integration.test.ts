import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CAREER_TABLES,
  CONNECTION,
  openCareerFixture,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';

/**
 * The Checkpoint 9 audit: the security properties that are **configuration rather than behaviour**,
 * asserted against the database itself.
 *
 * The isolation suite next door proves that one tenant cannot read another's rows — it does it by
 * trying, which is the strongest evidence there is. This one asserts the shape of the configuration
 * that makes that true, because a policy can be correct today and be replaced tomorrow by one that
 * looks similar and is not. Between them: what the database *does*, and what it is *written to do*.
 *
 * Three properties, and each fails a different way when it is wrong:
 *
 * **Exactly one policy per table, and the same one.** Twelve tables carrying a `tenant_isolation`
 * policy over `ALL` commands, whose expression is `tenant_id = app_current_tenant()` and nothing
 * else. A second permissive policy on one table would widen it silently — PostgreSQL ORs permissive
 * policies together, so a well-meaning "allow the owner to read" policy added later grants
 * everything, and no isolation test that only reads would notice until the day somebody used the
 * owner role.
 *
 * **No column through which a capability this product refuses could be stored.** A `criticality`, a
 * `potential_band`, a `nine_box`, a score, a document reference or a notification state would each
 * be the first half of a capability the module states it does not have. The schema suites assert
 * this for individual tables; this asserts it across all twelve at once, so a column added to a new
 * table is caught by the same rule.
 *
 * **Every numeric column is a bounded integer.** Career holds no money, no rate and no percentage
 * (ADR-0074). A `numeric`, a `double precision`, a `real` or a `bigint` appearing anywhere would be
 * the point at which exactness stops being free — and the point at which the rest of the exactness
 * argument, which rests on there being nothing to round, stops holding.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career Checkpoint 9 audit');

suite('career audit', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_audit_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  describe('the tenant policy', () => {
    it('is exactly one policy per table, over every command, with the intended expression', async () => {
      const { rows } = await fixture.admin.query<{
        tablename: string;
        policyname: string;
        cmd: string;
        qual: string | null;
        permissive: string;
        roles: string;
      }>(
        `select tablename, policyname, cmd, qual, permissive, roles::text as roles
           from pg_policies where tablename = any($1::text[]) order by tablename`,
        [CAREER_TABLES],
      );

      // One per table, and twelve of them. A table with two permissive policies is a table with the
      // union of both, which is how an isolation boundary is widened without anybody editing it.
      expect(rows).toHaveLength(CAREER_TABLES.length);
      expect([...new Set(rows.map((row) => row.tablename))]).toHaveLength(CAREER_TABLES.length);

      for (const row of rows) {
        expect([row.tablename, row.policyname]).toEqual([row.tablename, 'tenant_isolation']);
        // `ALL`, not `SELECT`: a read-only policy would leave an insert, an update and a delete
        // unguarded, and the isolation suite's write assertions exist because that is a real way to
        // get this wrong.
        expect([row.tablename, row.cmd]).toEqual([row.tablename, 'ALL']);
        expect([row.tablename, row.qual]).toEqual([
          row.tablename,
          '(tenant_id = app_current_tenant())',
        ]);
        expect([row.tablename, row.permissive]).toEqual([row.tablename, 'PERMISSIVE']);
        // Applied to every role. A policy scoped to one role leaves every other role unrestricted.
        expect([row.tablename, row.roles]).toEqual([row.tablename, '{public}']);
      }
    });

    it('protects every table this module owns, and no table it does not', async () => {
      const { rows } = await fixture.admin.query<{ relname: string }>(
        `select relname from pg_class
          where relname like 'career\\_%' and relkind = 'r' order by relname`,
      );

      // The twelve the module declares, and nothing that merely starts with the word.
      expect(rows.map((row) => row.relname).sort()).toEqual([...CAREER_TABLES].sort());
    });
  });

  describe('the columns this module does not have', () => {
    /**
     * A capability has to be stored somewhere before it can be claimed.
     *
     * Each name below is the column a refused capability would need. Searching the whole schema at
     * once rather than table by table is what makes this survive a thirteenth table: a
     * `criticality` added to a new Career table is caught by the same assertion that catches one
     * added to an old one.
     */
    it('has no column through which a refused capability could be stored', async () => {
      const { rows } = await fixture.admin.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and table_name = any($1::text[])`,
        [CAREER_TABLES],
      );
      const columns = rows.map((row) => `${row.table_name}.${row.column_name}`);
      const names = rows.map((row) => row.column_name);

      for (const forbidden of [
        'criticality',
        'critical',
        'potential_band',
        'potential',
        'nine_box',
        'ninebox',
        'score',
        'rating',
        'percentage',
        'percent',
        'weight',
        'document_id',
        'evidence_document_id',
        'attachment_id',
        'file_id',
        'notified_at',
        'notification_id',
        'sent_at',
        'scheduled_at',
        'job_id',
        'salary',
        'amount',
        'delegate_id',
        'delegated_to',
        'principal_id',
        'user_id',
      ]) {
        expect([forbidden, names.includes(forbidden)]).toEqual([forbidden, false]);
      }

      // And the shape of the two that *are* present, so this cannot pass by the table being empty.
      expect(columns).toContain('career_successor.readiness_level_id');
      expect(columns).toContain('career_development_item.learning_assignment_id');
    });

    it('stores every number as a bounded integer, with no numeric, float or bigint anywhere', async () => {
      const { rows } = await fixture.admin.query<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>(
        `select table_name, column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = any($1::text[])
            and data_type in ('numeric','double precision','real','bigint','money')`,
        [CAREER_TABLES],
      );

      expect(rows.map((row) => `${row.table_name}.${row.column_name} ${row.data_type}`)).toEqual(
        [],
      );
    });

    /**
     * Every civil date is a `date`, and every instant is a `timestamptz`.
     *
     * The distinction is the whole of Career's temporal argument. A day somebody was nominated is a
     * `date` and is the same day in every time zone; the instant a row was written is a
     * `timestamptz` and is a point on a clock. A civil date stored as a timestamp is the Phase 8
     * defect, and it is invisible until somebody in another zone reads it.
     *
     * **The underscores are escaped.** `_` is a single-character wildcard in SQL `LIKE`, so `%_on`
     * matches every column ending in "on" — including `version`, which this first reported as a
     * civil date that was somehow an integer. The column was right and the pattern was wrong.
     */
    it('stores every civil date as a date and every instant as a timestamptz', async () => {
      const { rows } = await fixture.admin.query<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>(
        `select table_name, column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = any($1::text[])
            and (column_name like '%\\_on' or column_name like '%\\_date'
                 or column_name like '%\\_from' or column_name like '%\\_until'
                 or column_name like '%\\_at')`,
        [CAREER_TABLES],
      );

      for (const row of rows) {
        const expected = row.column_name.endsWith('_at') ? 'timestamp with time zone' : 'date';

        expect([`${row.table_name}.${row.column_name}`, row.data_type]).toEqual([
          `${row.table_name}.${row.column_name}`,
          expected,
        ]);
      }
      // Not vacuously true: the module has both kinds.
      expect(rows.filter((row) => row.data_type === 'date').length).toBeGreaterThan(10);
      expect(
        rows.filter((row) => row.data_type === 'timestamp with time zone').length,
      ).toBeGreaterThan(10);
    });
  });
});
