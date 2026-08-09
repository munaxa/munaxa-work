import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresRecruitmentStores } from './recruitment-stores.js';

/**
 * The database fixture this module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: the row-level
 * security that isolates eleven tables of third-party personal data, the partial unique indexes that
 * keep one candidate per Person and one live offer per application, the check constraints that
 * refuse an unexplained rejection, and the counter two concurrent creates serialize on. A mock would
 * only prove the mock behaves as instructed.
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

export const TENANT_A = '01920000-0000-7000-8000-0000000c1111';
export const TENANT_B = '01920000-0000-7000-8000-0000000c2222';

/** The tables this module owns, most dependent first, for truncation between tests. */
export const RECRUITMENT_TABLES = [
  'recruitment_offer',
  'recruitment_interview_feedback',
  'recruitment_interview',
  'recruitment_application_event',
  'recruitment_application',
  'recruitment_candidate_profile_entry',
  'recruitment_candidate',
  'recruitment_vacancy',
  'recruitment_requisition_decision',
  'recruitment_requisition',
  'recruitment_number_sequence',
];

/**
 * A candidate may reference a Person by foreign key, so the fixture can seed one to point at.
 *
 * It is read and written but **never truncated**: `person` is People's table, and a fixture that
 * emptied another module's tables would be this suite deciding when another suite's data goes away.
 * Seeded people are left behind instead, with unique numbers so repeated runs do not collide.
 */
const PERSON_TABLE = 'person';

export interface RecruitmentFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresRecruitmentStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  seedPerson(tenantId: string): Promise<string>;
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
  const expected = [...RECRUITMENT_TABLES, PERSON_TABLE];
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [expected],
  );
  const missing = expected.filter((table) => !present.rows.some((row) => row.table_name === table));

  if (missing.length > 0) {
    throw new Error(
      `Recruitment's tables are not in this database: ${missing.join(', ')}. ` +
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
    `grant select, insert, update, delete on ${[...RECRUITMENT_TABLES, PERSON_TABLE].join(', ')} to ${role}`,
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
 * until the job's own timeout hours later.
 */
const BOUNDS = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
  max: 5,
} as const;

const AUDIT = `now(), 'test', now(), 'test', 1`;

const seedPersonWith = async (admin: Pool, tenantId: string): Promise<string> => {
  const id = uuidV7();

  await admin.query(
    `insert into person
       (id, tenant_id, person_number, status, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'active', '{}'::jsonb, ${AUDIT})`,
    // Suffixed with the identifier, because these rows outlive the test that made them: `person` is
    // not truncated here, and People's unique index would refuse a repeat.
    [id, tenantId, `REC-${id.slice(-12)}`],
  );
  return id;
};

/**
 * Opens the fixture, and closes what it opened if opening fails.
 *
 * Without the `catch`, a failure while checking the schema leaves the `admin` pool open and
 * unreferenced: `beforeAll` fails, `afterAll` has no fixture to close, and the socket keeps Node
 * alive forever. The suite would report a failure *and* hang, and the hang is what a reader sees.
 */
export const openRecruitmentFixture = async (role: string): Promise<RecruitmentFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });

  const application = await openApplicationPool(admin, role).catch(async (error: unknown) => {
    await admin.end();
    throw error;
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresRecruitmentStores();

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
    seedPerson: (tenantId) => seedPersonWith(admin, tenantId),
    // Only this module's tables. `person` is People's, and emptying it here would delete rows a
    // concurrently running People suite is asserting on.
    truncate: async () => {
      await admin.query(`truncate ${RECRUITMENT_TABLES.join(', ')} cascade`);
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
        await admin.query(`truncate ${RECRUITMENT_TABLES.join(', ')} cascade`);
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
