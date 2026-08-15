import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@work/kernel';

import {
  CAREER_TABLES,
  CONNECTION,
  TENANT_A,
  openCareerFixture,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import { EMPLOYMENT, POSITION } from './career-states.js';

/**
 * Query plans for the reads that will carry the volume.
 *
 * **This is not the benchmark.** No workload is timed and no budget is asserted; the 500 / 10,000 /
 * 100,000 measurement is a later checkpoint. What this checks is *shape*: that the tenant predicate
 * reaches the plan, that a bounded lookup by identifier or by a filtered index does not fall to a
 * sequential scan, that a `limit` is pushed into the statement rather than applied to a fetched
 * table, and that no read introduces a join per row.
 *
 * **A small table plans differently from a large one, and that is not a defect.** PostgreSQL will
 * choose a sequential scan over ten rows however good the index is, because reading ten rows is
 * cheaper than descending a tree — so a suite that demanded `Index Scan` at fixture scale would be
 * asserting a lie and would drive somebody to add indexes that answer nothing. The assertions below
 * are therefore about the *predicate* and the *bound*, which hold at every size, plus one
 * seed-and-force check where the index choice itself is what matters.
 *
 * Nothing here changes the schema. If a plan showed a genuinely missing index, the finding would be
 * reported before any migration was written.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career query-plan suite');

suite('career query plans', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_plans_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  const planFor = (sql: string, parameters: readonly unknown[]): Promise<string> =>
    inA(async (transaction) => {
      const rows = await transaction.execute<{ 'QUERY PLAN': string }>(
        `explain ${sql}`,
        parameters,
      );

      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });

  describe('the tenant predicate is visible in every plan', () => {
    /**
     * The predicate is in the SQL *and* in the policy, and this asserts the first.
     *
     * Row-level security makes tenant isolation true; the explicit `tenant_id = $1` makes it legible
     * — a plan that showed only the policy's own filter would give a reader no way to tell a query
     * that meant to be tenant-scoped from one that forgot and was rescued.
     */
    it('carries the tenant in the plan for every bounded collection read', async () => {
      const reads: readonly {
        readonly name: string;
        readonly sql: string;
        readonly parameters: readonly unknown[];
      }[] = [
        {
          name: 'career plan search',
          sql: `select p.id from career_plan p
                  where p.tenant_id = $1 and p.deleted_at is null and p.employment_id = $2
                  order by p.started_on desc, p.id limit 50`,
          parameters: [TENANT_A, EMPLOYMENT],
        },
        {
          name: 'succession plan search',
          sql: `select s.id from career_succession_plan s
                  where s.tenant_id = $1 and s.deleted_at is null and s.status = 'active'
                  order by s.review_on nulls last, s.id limit 50`,
          parameters: [TENANT_A],
        },
        {
          name: 'pool membership search',
          sql: `select m.id from career_pool_membership m
                  where m.tenant_id = $1 and m.deleted_at is null and m.talent_pool_id = $2
                  order by m.from_date desc, m.id limit 50`,
          parameters: [TENANT_A, POSITION],
        },
        {
          name: 'readiness history',
          sql: `select a.id from career_readiness_assessment a
                  where a.tenant_id = $1 and a.deleted_at is null and a.employment_id = $2
                  order by a.assessed_on desc, a.recorded_at desc`,
          parameters: [TENANT_A, EMPLOYMENT],
        },
        {
          name: 'development plan search',
          sql: `select d.id from career_development_plan d
                  where d.tenant_id = $1 and d.deleted_at is null and d.employment_id = $2
                  order by d.started_on desc, d.id limit 50`,
          parameters: [TENANT_A, EMPLOYMENT],
        },
        {
          name: 'mobility recommendation search',
          sql: `select r.id from career_mobility_recommendation r
                  where r.tenant_id = $1 and r.deleted_at is null and r.status = 'proposed'
                  order by r.recommended_on desc, r.id limit 50`,
          parameters: [TENANT_A],
        },
        {
          name: 'bench strength',
          sql: `select count(*) filter (where status = 'nominated') from career_successor
                  where succession_plan_id = $2 and tenant_id = $1 and deleted_at is null`,
          parameters: [TENANT_A, POSITION],
        },
      ];

      for (const read of reads) {
        const plan = await planFor(read.sql, read.parameters);

        expect(plan, read.name).toMatch(/tenant_id/i);
      }
    });
  });

  describe('bounded reads stay bounded', () => {
    it('pushes the limit into the plan for every paged read', async () => {
      const paged: readonly { readonly name: string; readonly sql: string }[] = [
        {
          name: 'career plan search',
          sql: `select p.id from career_plan p where p.tenant_id = $1 and p.deleted_at is null
                  order by p.started_on desc, p.id limit 50 offset 100`,
        },
        {
          name: 'succession plan search',
          sql: `select s.id from career_succession_plan s where s.tenant_id = $1 and s.deleted_at is null
                  order by s.review_on nulls last, s.id limit 50 offset 100`,
        },
        {
          name: 'development item search',
          sql: `select i.id from career_development_item i where i.tenant_id = $1 and i.deleted_at is null
                  order by i.target_date nulls last, i.id limit 50 offset 100`,
        },
      ];

      for (const read of paged) {
        expect(await planFor(read.sql, [TENANT_A]), read.name).toMatch(/Limit/);
      }
    });

    /**
     * A count is an aggregate, never a fetched page.
     *
     * `Aggregate` in the plan is the evidence that the database produced the number. A `total`
     * derived from returned rows would be the size of the page, and a bench of sixty successors
     * would report as fifty.
     */
    it('computes a bench count as an aggregate rather than by returning rows', async () => {
      const plan = await planFor(
        `select count(*) filter (where status = 'nominated')::text as nominated,
                count(*) filter (where status = 'confirmed')::text as confirmed
           from career_successor
          where succession_plan_id = $2 and tenant_id = $1 and deleted_at is null`,
        [TENANT_A, POSITION],
      );

      expect(plan).toMatch(/Aggregate/);
    });

    /**
     * The summary is six independent bounded reads, and none of them joins anything.
     *
     * An N+1 never appears in a single plan — it appears as *many* plans — so a plan assertion is
     * the wrong instrument. What can be asserted here is the boundary that makes the worst version
     * impossible: Career's foreign keys stay inside Career, so no query in this module could reach
     * Employment, Organization, Performance, Learning, People or Documents even by accident.
     * Cross-module facts are read through published contracts, one bounded call at a time.
     */
    it('has no foreign key through which a cross-module join could be written', async () => {
      const foreign = await fixture.admin.query<{ constraint_name: string; target: string }>(
        `select con.conname as constraint_name, con.confrelid::regclass::text as target
           from pg_constraint con
           join pg_class src on src.oid = con.conrelid
          where con.contype = 'f' and src.relname like 'career\\_%'
            and con.confrelid::regclass::text not like 'career\\_%'`,
      );

      expect(foreign.rows).toEqual([]);
    });
  });

  describe('a filtered index is chosen once there is enough data to choose it', () => {
    /**
     * Ten rows plan as a sequential scan whatever indexes exist, because reading ten rows is cheaper
     * than descending a tree — so a fixture-scale assertion of `Index Scan` would be asserting a lie.
     *
     * This seeds a few thousand rows and then asks whether the planner *can* use the partial index,
     * by disabling the sequential scan and reading what it falls back to. That answers the question
     * this checkpoint actually has — "is the index usable for this predicate" — without pretending
     * fixture scale is production scale, and without asserting a timing this checkpoint has not
     * measured.
     */
    it('can satisfy the active-plan lookup from `career_plan_active_idx`', async () => {
      await inA(async (transaction) => {
        await transaction.execute(
          `insert into career_plan
             (tenant_id, employment_id, status, started_on,
              created_at, created_by, updated_at, updated_by, version, metadata)
           select $1, gen_random_uuid(), 'active', date '2026-03-01',
                  now(), 'seed', now(), 'seed', 1, '{}'::jsonb
             from generate_series(1, 3000)`,
          [TENANT_A],
        );
      });

      await fixture.admin.query('vacuum analyze career_plan');

      const plan = await inA(async (transaction) => {
        await transaction.execute('set local enable_seqscan = off');

        const rows = await transaction.execute<{ 'QUERY PLAN': string }>(
          `explain select p.id from career_plan p
             where p.employment_id = $2 and p.tenant_id = $1
               and p.status = 'active' and p.deleted_at is null`,
          [TENANT_A, EMPLOYMENT],
        );

        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });

      // The partial index covers exactly this predicate. That it is *reachable* is the finding; which
      // plan the optimizer picks at production volume is what the benchmark checkpoint measures.
      expect(plan).toMatch(/Index (Only )?Scan|Bitmap/);
      expect(plan).toMatch(/career_plan_(active_idx|employment_idx)/);
    });

    /** And the employment-scoped read has an index of its own, for the same reason. */
    it('can satisfy a readiness history read from its employment index', async () => {
      await inA(async (transaction) => {
        const level = await transaction.execute<{ id: string }>(
          `insert into career_readiness_level
             (tenant_id, code, name, ordinal, active,
              created_at, created_by, updated_at, updated_by, version, metadata)
           values ($1, 'seeded', '{"en":"Seeded"}'::jsonb, 9, true,
                   now(), 'seed', now(), 'seed', 1, '{}'::jsonb)
           returning id`,
          [TENANT_A],
        );

        await transaction.execute(
          `insert into career_readiness_assessment
             (tenant_id, employment_id, readiness_level_id, position_id, assessed_on, assessed_by,
              recorded_at, created_at, created_by, updated_at, updated_by, version, metadata)
           select $1, gen_random_uuid(), $2, gen_random_uuid(), date '2026-03-01', 'user:seed',
                  now(), now(), 'seed', now(), 'seed', 1, '{}'::jsonb
             from generate_series(1, 3000)`,
          [TENANT_A, level[0]?.id],
        );
      });

      await fixture.admin.query('vacuum analyze career_readiness_assessment');

      const plan = await inA(async (transaction) => {
        await transaction.execute('set local enable_seqscan = off');

        const rows = await transaction.execute<{ 'QUERY PLAN': string }>(
          `explain select a.id from career_readiness_assessment a
             where a.employment_id = $2 and a.tenant_id = $1 and a.deleted_at is null
             order by a.assessed_on desc, a.recorded_at desc`,
          [TENANT_A, EMPLOYMENT],
        );

        return rows.map((row) => row['QUERY PLAN']).join('\n');
      });

      expect(plan).toMatch(/career_readiness_assessment_employment_idx/);
    });
  });

  describe('every Career table is reachable only through its own indexes', () => {
    /**
     * The index inventory, asserted as a whole.
     *
     * Not a plan check but the thing plans depend on: each of the twelve tables carries at least the
     * primary key plus a tenant-scoped index, so no bounded read is left to a sequential scan by
     * omission rather than by the planner's choice.
     */
    it('carries a tenant-leading index on every table a query filters', async () => {
      const indexes = await fixture.admin.query<{ tablename: string; indexdef: string }>(
        `select tablename, indexdef from pg_indexes
          where schemaname = 'public' and tablename = any($1::text[])`,
        [CAREER_TABLES],
      );
      const withTenantIndex = new Set(
        indexes.rows
          .filter((row) => row.indexdef.includes('(tenant_id'))
          .map((row) => row.tablename),
      );

      for (const table of CAREER_TABLES) {
        expect(withTenantIndex.has(table), table).toBe(true);
      }
    });
  });
});
