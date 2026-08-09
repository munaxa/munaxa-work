import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresOnboardingStores } from './onboarding-stores.js';

/**
 * The database fixture this module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: the row-level
 * security that isolates six tables, the **partial unique index that makes the start command
 * idempotent**, the foreign keys that make it impossible for Onboarding to invent an employment, and
 * the check constraints that refuse an unexplained cancellation. A mock would only prove the mock
 * behaves as instructed — and the one property this module's reliability rests on is precisely the
 * one only a real index can demonstrate.
 *
 * Two connections, deliberately. `admin` seeds and inspects, as a migration would. `application`
 * connects as a role that owns nothing and cannot bypass row-level security — the only configuration
 * under which any isolation assertion means anything.
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

export const TENANT_A = '01920000-0000-7000-8000-0000000d1111';
export const TENANT_B = '01920000-0000-7000-8000-0000000d2222';

/** The tables this module owns, most dependent first, for truncation between tests. */
export const ONBOARDING_TABLES = [
  'onboarding_task_event',
  'onboarding_task',
  'onboarding_instance',
  'onboarding_task_template',
  'onboarding_plan_version',
  'onboarding_plan',
];

/**
 * An instance references a Person *and* an Employment by foreign key, so the fixture seeds both.
 *
 * They are read and written but **never truncated**: `person` is People's table and `employment` is
 * Employment's, and a fixture that emptied another module's tables would be this suite deciding when
 * another suite's data goes away. Seeded rows are left behind instead, with unique numbers so
 * repeated runs do not collide.
 *
 * Seeding them with SQL rather than through those modules' commands is deliberate and is the honest
 * shape of the dependency: Onboarding does not create either, in this fixture or in production.
 */
const FOREIGN_TABLES = ['person', 'employment'];

export interface SeededEmployment {
  readonly employmentId: string;
  readonly personId: string;
}

export interface OnboardingFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresOnboardingStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  seedEmployment(tenantId: string, startDate?: string): Promise<SeededEmployment>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Fails with the cause rather than a symptom.
 *
 * A database that has not been migrated otherwise produces `relation "..." does not exist` from
 * whichever statement touched it first, which sends the reader to the fixture rather than to the
 * missing migration step.
 */
const assertSchemaApplied = async (admin: Pool): Promise<void> => {
  const expected = [...ONBOARDING_TABLES, ...FOREIGN_TABLES];
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [expected],
  );
  const missing = expected.filter((table) => !present.rows.some((row) => row.table_name === table));

  if (missing.length > 0) {
    throw new Error(
      `Onboarding's tables are not in this database: ${missing.join(', ')}. ` +
        'These suites exercise the real schema — its policies, indexes and check constraints — ' +
        'so run `pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }
};

/**
 * Creates the unprivileged role the suite connects as, and grants it the tables it touches.
 *
 * It owns nothing and holds no `BYPASSRLS`, which is the only configuration under which an isolation
 * assertion means anything: a superuser bypasses every policy, so a suite run as one would pass
 * whether or not isolation worked.
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
    `grant select, insert, update, delete on ${[...ONBOARDING_TABLES, ...FOREIGN_TABLES].join(', ')} to ${role}`,
  );

  const url = new URL(CONNECTION ?? '');

  url.username = role;
  url.password = 'fixture';
  return url.toString();
};

/**
 * Every wait this fixture can make is bounded.
 *
 * A `pg.Pool` waits forever for a free connection by default, and a statement waits forever for a
 * lock. Either one turns a contended database into a test run that produces no output and no failure
 * until the job's own timeout hours later. The concurrency suite deliberately makes two transactions
 * contend on one index, so this is the difference between a failure and a hang.
 */
const BOUNDS = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
  max: 6,
} as const;

const AUDIT = `now(), 'test', now(), 'test', 1`;

/**
 * A person and an employment, exactly as Recruitment's hire would have left them.
 *
 * The employment is `active` and starts on the given date, which is all Onboarding ever reads of it.
 */
const seedEmploymentWith = async (
  admin: Pool,
  tenantId: string,
  startDate: string,
): Promise<SeededEmployment> => {
  const personId = uuidV7();
  const employmentId = uuidV7();

  await admin.query(
    `insert into person
       (id, tenant_id, person_number, status, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'active', '{}'::jsonb, ${AUDIT})`,
    [personId, tenantId, `ONB-${personId.slice(-12)}`],
  );
  await admin.query(
    `insert into employment
       (id, tenant_id, person_id, employment_number, status, employment_type_code,
        original_hire_date, start_date, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4, 'active', 'permanent', $5::date, $5::date, '{}'::jsonb, ${AUDIT})`,
    [employmentId, tenantId, personId, `ONB-${employmentId.slice(-12)}`, startDate],
  );
  return { employmentId, personId };
};

/**
 * Opens the fixture, and closes what it opened if opening fails.
 *
 * Without the `catch`, a failure while checking the schema leaves the `admin` pool open and
 * unreferenced: `beforeAll` fails, `afterAll` has no fixture to close, and the socket keeps Node
 * alive forever. The suite would report a failure *and* hang, and the hang is what a reader sees.
 */
export const openOnboardingFixture = async (role: string): Promise<OnboardingFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });

  const application = await openApplicationPool(admin, role).catch(async (error: unknown) => {
    await admin.end();
    throw error;
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresOnboardingStores();

  return {
    admin,
    application,
    unitOfWork,
    stores,
    // Through the real Unit of Work, so `app.tenant_id` is genuinely set on the transaction.
    asTenant: (tenantId, work) =>
      runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:test' }, () =>
        unitOfWork.execute(work),
      ),
    seedEmployment: (tenantId, startDate = '2026-09-01') =>
      seedEmploymentWith(admin, tenantId, startDate),
    // Only this module's tables. `person` and `employment` belong to People and Employment, and
    // emptying them here would delete rows a concurrently running suite is asserting on.
    truncate: async () => {
      await admin.query(`truncate ${ONBOARDING_TABLES.join(', ')} cascade`);
    },
    /**
     * Ends both pools, whatever else fails.
     *
     * A pg `Pool` holds an open socket, and an open socket keeps Node's event loop alive — so a pool
     * that is not ended does not fail a test, it hangs the process after the tests pass.
     */
    close: async () => {
      try {
        await application.end();
        await admin.query(`truncate ${ONBOARDING_TABLES.join(', ')} cascade`);
      } finally {
        await admin.end();
      }
    },
  };
};

const openApplicationPool = async (admin: Pool, role: string): Promise<Pool> => {
  await assertSchemaApplied(admin);
  return new Pool({ connectionString: await ensureApplicationRole(admin, role), ...BOUNDS });
};
