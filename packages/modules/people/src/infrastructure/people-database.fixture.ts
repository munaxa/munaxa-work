import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresPeopleStores } from './people-stores.js';

/**
 * The database fixture the module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: the
 * row-level security that isolates thirteen tables of personal data, the partial unique indexes
 * that keep one open period per slot, the check constraints that refuse a half-named person, and
 * the unique index on the identifier digest that AD-001 ultimately rests on. A mock would only
 * prove the mock behaves as instructed.
 *
 * Two connections, deliberately. `admin` seeds and inspects, as a migration would. `application`
 * connects as a role that owns nothing and cannot bypass row-level security — the only
 * configuration under which any isolation assertion means anything.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/**
 * A suite that quietly skips itself on the machine that gates merges reports success for a
 * property nobody checked. So it skips for a developer without a database, and never in CI.
 */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT_A = '01920000-0000-7000-8000-00000000eeee';
export const TENANT_B = '01920000-0000-7000-8000-00000000ffff';

/** The tables this module owns, most dependent first, for truncation between tests. */
export const PEOPLE_TABLES = [
  'person_duplicate_candidate',
  'person_note',
  'person_tag',
  'person_history',
  'person_capability',
  'person_preference',
  'person_emergency_contact',
  'person_address',
  'person_contact',
  'person_nationality',
  'person_identifier',
  'person_name',
  'person',
];

export interface PeopleFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresPeopleStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  seedPerson(tenantId: string, personNumber: string, dateOfBirth?: string): Promise<string>;
  seedName(tenantId: string, personId: string, en: string, ar: string): Promise<string>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Fails with the cause rather than a symptom.
 *
 * Phase 2 learned this the expensive way: a database that has not been migrated otherwise produces
 * `relation "..." does not exist` from whichever statement touched it first, which sends the
 * reader to the fixture rather than to the missing migration step.
 */
const assertSchemaApplied = async (admin: Pool): Promise<void> => {
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [PEOPLE_TABLES],
  );
  const missing = PEOPLE_TABLES.filter(
    (table) => !present.rows.some((row) => row.table_name === table),
  );

  if (missing.length > 0) {
    throw new Error(
      `People's tables are not in this database: ${missing.join(', ')}. ` +
        'These suites exercise the real schema — its policies, indexes and check constraints — ' +
        'so run `pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }
};

/**
 * Creates the unprivileged role the suite connects as, and grants it the module's tables.
 *
 * It owns nothing and holds no `BYPASSRLS`, which is the only configuration under which an
 * isolation assertion means anything: a superuser bypasses every policy, so a suite run as one
 * would pass whether or not isolation worked.
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
    `grant select, insert, update, delete on ${PEOPLE_TABLES.join(', ')} to ${role}`,
  );

  const url = new URL(CONNECTION ?? '');

  url.username = role;
  url.password = 'fixture';
  return url.toString();
};

/**
 * Every wait this fixture can make is bounded.
 *
 * A `pg.Pool` waits **forever** for a free connection by default, and a statement waits forever
 * for a lock. Either one turns a contended database — several modules' integration suites running
 * at once against one server, which is exactly what CI does — into a test run that produces no
 * output and no failure until the job's own timeout hours later. A bounded wait fails with a
 * message that names itself.
 *
 * The numbers are generous by design: nothing here legitimately waits seconds, so exceeding them
 * is a finding rather than a tuning problem.
 */
const BOUNDS = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
  max: 5,
} as const;

const openApplicationPool = async (admin: Pool, role: string): Promise<Pool> => {
  await assertSchemaApplied(admin);
  return new Pool({ connectionString: await ensureApplicationRole(admin, role), ...BOUNDS });
};

const AUDIT = `now(), 'test', now(), 'test', 1`;

const seedPersonWith = async (
  admin: Pool,
  tenantId: string,
  personNumber: string,
  dateOfBirth?: string,
): Promise<string> => {
  const id = uuidV7();

  await admin.query(
    `insert into person
       (id, tenant_id, person_number, date_of_birth, status, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4::date, 'active', '{}'::jsonb, ${AUDIT})`,
    [id, tenantId, personNumber, dateOfBirth ?? null],
  );
  return id;
};

const seedNameWith = async (
  admin: Pool,
  tenantId: string,
  personId: string,
  en: string,
  ar: string,
): Promise<string> => {
  const id = uuidV7();

  await admin.query(
    `insert into person_name
       (id, tenant_id, person_id, legal_name, effective_from,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4::jsonb, now(), ${AUDIT})`,
    [id, tenantId, personId, JSON.stringify({ en, ar })],
  );
  return id;
};

/**
 * Opens the fixture, and closes what it opened if opening fails.
 *
 * Without the `catch`, a failure in `assertSchemaApplied` or `ensureApplicationRole` leaves the
 * `admin` pool open and unreferenced: `beforeAll` fails, `afterAll` has no fixture to close, and
 * the socket keeps Node alive forever. The suite would report a failure *and* hang, and the hang
 * is what a reader sees first.
 */
export const openPeopleFixture = async (role: string): Promise<PeopleFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });

  const application = await openApplicationPool(admin, role).catch(async (error: unknown) => {
    await admin.end();
    throw error;
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresPeopleStores();

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
    seedPerson: (tenantId, personNumber, dateOfBirth) =>
      seedPersonWith(admin, tenantId, personNumber, dateOfBirth),
    seedName: (tenantId, personId, en, ar) => seedNameWith(admin, tenantId, personId, en, ar),
    truncate: async () => {
      await admin.query(`truncate ${PEOPLE_TABLES.join(', ')} cascade`);
    },
    /**
     * Ends both pools, whatever else fails.
     *
     * A pg `Pool` holds an open socket, and an open socket keeps Node's event loop alive — so a
     * pool that is not ended does not fail a test, it **hangs the process after the tests pass**,
     * which in CI is a job that runs until the six-hour timeout with no output to explain it.
     *
     * The tidy-up truncate is therefore inside a `finally` rather than in front of `admin.end()`.
     * It is a courtesy to the next suite; the pools closing is not.
     */
    close: async () => {
      try {
        await application.end();
        await admin.query(`truncate ${PEOPLE_TABLES.join(', ')} cascade`);
      } finally {
        await admin.end();
      }
    },
  };
};
