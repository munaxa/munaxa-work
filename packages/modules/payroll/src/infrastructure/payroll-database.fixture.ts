import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresPayrollStores } from './payroll-stores.js';

/**
 * The database fixture this module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: the row-level
 * security that isolates fourteen tables holding **net pay**, the GiST exclusion that settles a race
 * between two administrators creating June, the partial unique index that permits one non-terminal
 * run per period, the check constraint that refuses a self-approved run, the trigger that refuses
 * any mutation of a finalized row (ADR-0066), and the exactness of a `bigint` amount above 2^53
 * through a driver round trip. A mock would only prove the mock behaves as instructed.
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

export const TENANT_A = '01930000-0000-7000-8000-0000000d1111';
export const TENANT_B = '01930000-0000-7000-8000-0000000d2222';

/** The fourteen tables this module owns, most dependent first, for truncation between tests. */
export const PAYROLL_TABLES = [
  'payroll_payment_instruction',
  'payroll_accounting_line',
  'payroll_reconciliation',
  'payroll_approval_decision',
  'payroll_adjustment',
  'payroll_exception',
  'payroll_deduction_line',
  'payroll_earning_line',
  'payroll_result',
  'payroll_input_snapshot',
  'payroll_run',
  'payroll_period',
  'payroll_deduction_definition',
  'payroll_group',
];

/**
 * Payroll references an Employment by foreign key, so the fixture seeds one — and the Person the
 * employment itself requires.
 *
 * They are read and written but **never truncated**: `person` is People's table and `employment` is
 * Employment's, and a fixture that emptied another module's tables would be this suite deciding
 * when another suite's data goes away. Seeding them with SQL rather than through those modules'
 * commands is the honest shape of the dependency — Payroll creates neither, here or in production.
 */
const FOREIGN_TABLES = ['person', 'employment'];

export interface PayrollFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresPayrollStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /** Runs as a *named* actor, for the assertions about who decided what. */
  asActor<TResult>(
    tenantId: string,
    actor: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  seedEmployment(tenantId: string, startDate?: string): Promise<string>;
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
  const expected = [...PAYROLL_TABLES, ...FOREIGN_TABLES];
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [expected],
  );
  const missing = expected.filter((table) => !present.rows.some((row) => row.table_name === table));

  if (missing.length > 0) {
    throw new Error(
      `Payroll's tables are not in this database: ${missing.join(', ')}. ` +
        'These suites exercise the real schema — its policies, indexes, check constraints and the ' +
        'finalized-immutability trigger — so run `pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }
};

/**
 * Creates the unprivileged role the suite connects as, and grants it the tables it touches.
 *
 * It owns nothing and holds no `BYPASSRLS`, which is the only configuration under which an
 * isolation assertion means anything: a superuser bypasses every policy, so a suite run as one
 * would pass whether or not isolation worked — and in this module that would mean reporting that
 * one tenant cannot read another's net pay without having checked.
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
    `grant select, insert, update, delete on ${[...PAYROLL_TABLES, ...FOREIGN_TABLES].join(', ')} to ${role}`,
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
 * lock. Either turns a contended database into a run that produces no output and no failure until
 * the job's own timeout hours later. The concurrency assertions deliberately make two transactions
 * contend, so this is the difference between a failure and a hang.
 */
const BOUNDS = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
  max: 6,
} as const;

const AUDIT = `now(), 'test', now(), 'test', 1`;

/** A person and an employment, exactly as Employment would have left them. */
const seedEmploymentWith = async (
  admin: Pool,
  tenantId: string,
  startDate: string,
): Promise<string> => {
  const personId = uuidV7();
  const employmentId = uuidV7();

  await admin.query(
    `insert into person
       (id, tenant_id, person_number, status, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'active', '{}'::jsonb, ${AUDIT})`,
    [personId, tenantId, `PAY-${personId.slice(-12)}`],
  );
  await admin.query(
    `insert into employment
       (id, tenant_id, person_id, employment_number, status, employment_type_code,
        original_hire_date, start_date, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4, 'active', 'permanent', $5::date, $5::date, '{}'::jsonb, ${AUDIT})`,
    [employmentId, tenantId, personId, `PAY-${employmentId.slice(-12)}`, startDate],
  );
  return employmentId;
};

/**
 * Opens the fixture, and closes what it opened if opening fails.
 *
 * Without the `catch`, a failure while checking the schema leaves the `admin` pool open and
 * unreferenced: `beforeAll` fails, `afterAll` has no fixture to close, and the socket keeps Node
 * alive forever. The suite would report a failure *and* hang, and the hang is what a reader sees.
 */
export const openPayrollFixture = async (role: string): Promise<PayrollFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });

  const application = await openApplicationPool(admin, role).catch(async (error: unknown) => {
    await admin.end();
    throw error;
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresPayrollStores();
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
    // Through the real Unit of Work, so `app.tenant_id` is genuinely set on the transaction.
    asTenant: (tenantId, work) => inContext(tenantId, 'user:test', work),
    asActor: (tenantId, actor, work) => inContext(tenantId, actor, work),
    seedEmployment: (tenantId, startDate = '2020-01-01') =>
      seedEmploymentWith(admin, tenantId, startDate),
    truncate: async () => {
      await admin.query(`truncate ${PAYROLL_TABLES.join(', ')} cascade`);
    },
    close: async () => {
      try {
        await application.end();
        await admin.query(`truncate ${PAYROLL_TABLES.join(', ')} cascade`);
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
