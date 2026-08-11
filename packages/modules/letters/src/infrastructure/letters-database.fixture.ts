import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresLettersStores } from './letters-stores.js';

/**
 * The database fixture this module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: the row-level
 * security isolating six tables, the check constraint refusing a self-approved letter, the unique
 * index on the verification token, the gapless tenant-scoped counter behind a reference number, and
 * the two triggers that freeze a template version the moment it issues something and refuse any
 * rewrite of an issued letter. A mock would only prove the mock behaves as instructed.
 *
 * Two connections, deliberately. `admin` seeds and inspects, as a migration would. `application`
 * connects as a role that owns nothing and cannot bypass row-level security — the only
 * configuration under which any isolation assertion means anything.
 *
 * Unlike Documents' fixture, this one seeds **no other module's rows**. `letter_request` holds an
 * `employment_id` and a `person_id` and carries no foreign key to either: a polymorphic-free
 * cross-module reference cannot enforce tenant isolation anyway (ADR-0042), so the identifiers are
 * confirmed through published contracts at the application layer rather than by the database.
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

export const TENANT_A = '01930000-0000-7000-8000-00000001e111';
export const TENANT_B = '01930000-0000-7000-8000-00000001e222';

/** The six tables this module owns, most dependent first, for truncation between tests. */
export const LETTERS_TABLES = [
  'letter_approval_decision',
  'letter_issued',
  'letter_request',
  'letter_template_version',
  'letter_template',
  'letter_number_sequence',
];

export interface LettersFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresLettersStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /** Runs as a *named* actor, for the assertions about who requested and who approved. */
  asActor<TResult>(
    tenantId: string,
    actor: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
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
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [LETTERS_TABLES],
  );
  const missing = LETTERS_TABLES.filter(
    (table) => !present.rows.some((row) => row.table_name === table),
  );

  if (missing.length > 0) {
    throw new Error(
      `Letters' tables are not in this database: ${missing.join(', ')}. ` +
        'These suites exercise the real schema — its policies, indexes, check constraints and the ' +
        'issuance triggers — so run `pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }
};

/**
 * Creates the unprivileged role the suite connects as, and grants it the tables it touches.
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
    `grant select, insert, update, delete on ${LETTERS_TABLES.join(', ')} to ${role}`,
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

/**
 * Opens the fixture, and closes what it opened if opening fails.
 *
 * Without the `catch`, a failure while checking the schema leaves the `admin` pool open and
 * unreferenced: `beforeAll` fails, `afterAll` has no fixture to close, and the socket keeps Node
 * alive forever. The suite would report a failure *and* hang, and the hang is what a reader sees.
 */
export const openLettersFixture = async (role: string): Promise<LettersFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });

  const application = await openApplicationPool(admin, role).catch(async (error: unknown) => {
    await admin.end();
    throw error;
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresLettersStores();
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
    // Through the real Unit of Work, so `app.tenant_id` is genuinely set on the transaction.
    asTenant: (tenantId, work) => inContext(tenantId, 'user:test', work),
    asActor: (tenantId, actor, work) => inContext(tenantId, actor, work),
    stores,
    truncate: async () => {
      // `truncate` rather than `delete`: the issuance triggers refuse a delete of an issued letter,
      // and a table-level truncate is not something a row trigger sees.
      await admin.query(`truncate ${LETTERS_TABLES.join(', ')} cascade`);
    },
    close: async () => {
      try {
        await application.end();
        await admin.query(`truncate ${LETTERS_TABLES.join(', ')} cascade`);
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
