import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresPerformanceStores } from './performance-stores.js';

/**
 * The database fixture this module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: the row-level
 * security isolating twenty-three tables that hold what one named person thinks of another's work,
 * the unique indexes that settle two managers completing the same review at the same moment, the
 * check constraints that refuse a rating nobody signed, and the seven triggers that refuse any
 * rewrite of a submitted assessment, a calibration decision or a completion snapshot from **any**
 * path including SQL nobody wrote in TypeScript. A mock would only prove the mock behaves as
 * instructed.
 *
 * Two connections, deliberately. `admin` seeds and inspects, as a migration would. `application`
 * connects as a role that owns nothing and cannot bypass row-level security — the only
 * configuration under which any isolation assertion means anything.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/**
 * A suite that quietly skips itself on the machine that gates merges reports success for a property
 * nobody checked. So it skips for a developer without a database, and never in CI.
 */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT_A = '01930000-0000-7000-8000-00000000aa11';
export const TENANT_B = '01930000-0000-7000-8000-00000000bb22';

/** The twenty-three tables this module owns, most dependent first, for truncation between tests. */
export const PERFORMANCE_TABLES = [
  'performance_review_snapshot',
  'performance_talent_placement',
  'performance_calibration_decision',
  'performance_calibration_session',
  'performance_review_component_score',
  'performance_assessment_item',
  'performance_assessment',
  'performance_reviewer_assignment',
  'performance_feedback',
  'performance_review',
  'performance_goal_progress',
  'performance_key_result',
  'performance_objective',
  'performance_goal',
  'performance_cycle',
  'performance_review_template_component',
  'performance_review_template',
  'performance_goal_category',
  'performance_competency_level',
  'performance_competency',
  'performance_competency_framework',
  'performance_rating_level',
  'performance_rating_scale',
];

/**
 * A role that owns nothing and holds no `BYPASSRLS`.
 *
 * The only configuration under which an isolation assertion means anything: a superuser bypasses
 * every policy, so a suite run as one would pass whether or not isolation worked — and in this
 * module that would mean reporting that one tenant cannot read another's performance reviews
 * without having checked.
 */
const ensureApplicationRole = async (admin: Pool, role: string): Promise<string> => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${role}') then
         create role ${role} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );
  await admin.query(
    `grant select, insert, update, delete on ${PERFORMANCE_TABLES.join(', ')} to ${role}`,
  );

  const url = new URL(CONNECTION ?? '');

  url.username = role;
  url.password = 'fixture';
  return url.toString();
};

/**
 * Fails with the cause rather than a symptom.
 *
 * A database that has not been migrated otherwise produces `relation "..." does not exist` from
 * whichever statement touched it first, which sends the reader to the fixture rather than to the
 * missing migration step.
 */
const assertSchemaApplied = async (admin: Pool): Promise<void> => {
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [PERFORMANCE_TABLES],
  );
  const missing = PERFORMANCE_TABLES.filter(
    (table) => !present.rows.some((row) => row.table_name === table),
  );

  if (missing.length > 0) {
    throw new Error(
      `Performance's tables are not in this database: ${missing.join(', ')}. ` +
        'These suites exercise the real schema — its policies, indexes, check constraints and the ' +
        'immutability triggers — so run `pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }

  const exclusions = await admin.query<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_name = 'performance_review_component_score' and column_name = 'excluded_items'`,
  );

  if (exclusions.rows.length === 0) {
    throw new Error(
      'performance_review_component_score is missing `excluded_items`. Apply the ' +
        '20260811190000_component_score_exclusions migration.',
    );
  }
};

/**
 * Every wait this fixture can make is bounded.
 *
 * A `pg.Pool` waits forever for a free connection by default, and a statement waits forever for a
 * lock. Either turns a contended database into a run that produces no output and no failure until
 * the job's own timeout hours later. The concurrency assertions deliberately make two transactions
 * contend, so this is the difference between a failure and a hang.
 */
const BOUNDS = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
  max: 6,
} as const;

export interface PerformanceFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresPerformanceStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /** Runs as a *named* actor, for the assertions about who completed and who calibrated what. */
  asActor<TResult>(
    tenantId: string,
    actor: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /**
   * A second unit of work on its **own** connection, for the concurrency assertions.
   *
   * Two transactions on one pooled connection are the same transaction, so a race written against
   * a single unit of work proves nothing at all.
   */
  onSecondConnection(): UnitOfWork;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens the fixture, and closes what it opened if opening fails.
 *
 * Without the `catch`, a failure while checking the schema leaves the `admin` pool open and
 * unreferenced: `beforeAll` fails, `afterAll` has no fixture to close, and the socket keeps Node
 * alive forever. The suite would report a failure *and* hang, and the hang is what a reader sees.
 */
export const openPerformanceFixture = async (role: string): Promise<PerformanceFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });
  const applicationUrl = await assertAndBuild(admin, role);
  const application = new Pool({ connectionString: applicationUrl, ...BOUNDS });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresPerformanceStores();
  const secondary: Pool[] = [];
  const inContext = <TResult>(
    tenantId: string,
    actor: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult> =>
    runInContext({ tenantId, correlationId: uuidV7(), actor }, () => unitOfWork.execute(work));

  return {
    admin,
    application,
    unitOfWork,
    stores,
    asTenant: (tenantId, work) => inContext(tenantId, 'user:test', work),
    asActor: (tenantId, actor, work) => inContext(tenantId, actor, work),
    onSecondConnection: () => {
      const pool = new Pool({ connectionString: applicationUrl, ...BOUNDS });

      secondary.push(pool);
      return new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
    },
    truncate: async () => {
      // `truncate` rather than `delete`: the immutability triggers refuse a delete of a submitted
      // assessment, a calibration decision or a snapshot, and a table-level truncate is not
      // something a row trigger sees.
      //
      // **No `cascade`.** Nothing outside this module references a Performance table, and a cascade
      // that reached another module's rows is exactly the defect Phase 12 found when Documents'
      // fixture wiped Letters' rows mid-test. The list is ordered most-dependent-first instead.
      await admin.query(`truncate ${PERFORMANCE_TABLES.join(', ')}`);
    },
    close: async () => {
      try {
        await Promise.all(secondary.map((pool) => pool.end()));
        await application.end();
        await admin.query(`truncate ${PERFORMANCE_TABLES.join(', ')}`);
      } finally {
        await admin.end();
      }
    },
  };
};

const assertAndBuild = async (admin: Pool, role: string): Promise<string> => {
  try {
    await assertSchemaApplied(admin);
    return await ensureApplicationRole(admin, role);
  } catch (error: unknown) {
    await admin.end();
    throw error;
  }
};
