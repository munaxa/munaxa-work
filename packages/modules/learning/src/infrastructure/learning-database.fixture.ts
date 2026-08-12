import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresLearningStores } from './learning-stores.js';

/**
 * The database fixture this module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: the row-level
 * security isolating twelve tables that hold what somebody was asked to learn and how they did, the
 * partial unique index that makes requirement reconciliation idempotent under concurrency rather
 * than under a read-then-write check, the constraints that refuse a certificate expiring before it
 * was issued, and the triggers that refuse any rewrite of a published course version, a recorded
 * assessment or a completed enrolment — from **any** path, including SQL nobody wrote in TypeScript.
 * A mock would only prove the mock behaves as instructed.
 *
 * Two connections, deliberately. `admin` seeds and inspects, as a migration would. `application`
 * connects as a role that owns nothing and cannot bypass row-level security, which is the only
 * configuration under which an isolation assertion means anything.
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

export const TENANT_A = '01930000-0000-7000-8000-0000000011aa';
export const TENANT_B = '01930000-0000-7000-8000-0000000022bb';

/** The twelve tables this module owns, most dependent first, for truncation between tests. */
export const LEARNING_TABLES = [
  'learning_certification',
  'learning_assessment_result',
  'learning_enrolment',
  'learning_assignment',
  'learning_mandatory_rule',
  'learning_path_step',
  'learning_path',
  'learning_assessment',
  'learning_course_version',
  'learning_course',
  'learning_course_category',
  'learning_instructor',
];

const BOUNDS = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
  max: 6,
} as const;

/**
 * A role that owns nothing and holds no `BYPASSRLS`.
 *
 * A superuser bypasses every policy, so a suite run as one would pass whether or not isolation
 * worked — which here would mean reporting that one tenant cannot read another's assessment results
 * without ever having checked.
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
    `grant select, insert, update, delete on ${LEARNING_TABLES.join(', ')} to ${role}`,
  );

  const url = new URL(CONNECTION ?? '');

  url.username = role;
  url.password = 'fixture';
  return url.toString();
};

/**
 * Fails with the cause rather than a symptom.
 *
 * An unmigrated database otherwise produces `relation "..." does not exist` from whichever
 * statement touched it first, which sends the reader to the fixture rather than to the missing
 * migration step.
 */
const assertSchemaApplied = async (admin: Pool): Promise<void> => {
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [LEARNING_TABLES],
  );
  const missing = LEARNING_TABLES.filter(
    (table) => !present.rows.some((row) => row.table_name === table),
  );

  if (missing.length > 0) {
    throw new Error(
      `Learning's tables are not in this database: ${missing.join(', ')}. These suites exercise ` +
        'the real schema — its policies, indexes, check constraints and immutability triggers — ' +
        'so run `pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }
};

export interface LearningFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresLearningStores>;
  /** Runs one statement batch as the unprivileged role, inside the tenant's row-security context. */
  asTenant<TResult>(
    tenantId: string,
    work: (client: PoolLike) => Promise<TResult>,
  ): Promise<TResult>;
  /** Runs repository work inside a real transaction, as the unprivileged role, for one tenant. */
  inTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /** Runs as a *named* actor, for the assertions about who completed and who waived what. */
  asActor<TResult>(
    tenantId: string,
    actor: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /**
   * A second unit of work on its **own** connection, for the concurrency assertions.
   *
   * Two transactions on one pooled connection are the same transaction, so a race written against a
   * single unit of work proves nothing at all — it proves that a program doing two things in order
   * does them in order.
   */
  onSecondConnection(): UnitOfWork;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/** The narrow slice of a `pg` client these suites use. */
export interface PoolLike {
  query<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: TRow[]; rowCount: number | null }>;
}

/**
 * Opens the fixture, and closes what it opened if opening fails.
 *
 * Without the `catch`, a failure while checking the schema leaves the `admin` pool open and
 * unreferenced: `beforeAll` fails, `afterAll` has no fixture to close, and the socket keeps Node
 * alive forever. The suite would report a failure *and* hang, and the hang is what a reader sees.
 */
export const openLearningFixture = async (role: string): Promise<LearningFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });
  const applicationUrl = await assertAndBuild(admin, role);
  const application = new Pool({ connectionString: applicationUrl, ...BOUNDS });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresLearningStores();
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
    inTenant: (tenantId, work) => inContext(tenantId, 'user:test', work),
    asActor: (tenantId, actor, work) => inContext(tenantId, actor, work),
    onSecondConnection: () => {
      const pool = new Pool({ connectionString: applicationUrl, ...BOUNDS });

      secondary.push(pool);
      return new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
    },
    asTenant: async (tenantId, work) => {
      const client = await application.connect();

      try {
        await client.query('begin');
        // The same mechanism `PostgresUnitOfWork` uses: transaction-local, so a pooled connection
        // cannot carry one tenant's setting into the next caller's work.
        await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);

        const outcome = await work(client);

        await client.query('commit');
        return outcome;
      } catch (error: unknown) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
    truncate: async () => {
      // `truncate` rather than `delete`: the immutability triggers refuse a delete of a published
      // course version, a recorded assessment result or an ended enrolment, and a table-level
      // truncate is not something a row trigger sees.
      //
      // **No `cascade`.** Nothing outside this module references a Learning table, and a cascade
      // that reached another module's rows is the defect Phase 12 found when Documents' fixture
      // wiped Letters' rows mid-test. The list is ordered most-dependent-first instead.
      await admin.query(`truncate ${LEARNING_TABLES.join(', ')}`);
    },
    close: async () => {
      try {
        await Promise.all(secondary.map((pool) => pool.end()));
        await application.end();
        await admin.query(`truncate ${LEARNING_TABLES.join(', ')}`);
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

/** The audit columns every insert in these suites has to supply. Stated once, not per statement. */
export const AUDIT_COLUMNS = 'created_at, created_by, updated_at, updated_by, version, metadata';
export const AUDIT_VALUES = `now(), 'user:test', now(), 'user:test', 1, '{}'::jsonb`;
