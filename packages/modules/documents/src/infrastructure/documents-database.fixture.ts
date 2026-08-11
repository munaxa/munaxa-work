import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresDocumentsStores } from './documents-stores.js';

/**
 * The database fixture this module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: the row-level
 * security isolating five tables that hold medical certificates and disciplinary records, the unique
 * index that settles two administrators replacing the same file at the same moment, the check
 * constraint carrying half of D-1a (a document evidencing a People identifier stores no expiry of
 * its own), and the triggers that refuse any rewrite of a version or an access event from **any**
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

export const TENANT_A = '01930000-0000-7000-8000-0000000dc111';
export const TENANT_B = '01930000-0000-7000-8000-0000000dc222';

/** The five tables this module owns, most dependent first, for truncation between tests. */
export const DOCUMENTS_TABLES = [
  'document_access_event',
  'document_verification',
  'document_version',
  'document',
  'document_type',
];

/**
 * The owner a document points at is another module's row, and this fixture seeds one.
 *
 * `person` is People's table. It is read and written here but **never truncated**: a fixture that
 * emptied another module's tables would be this suite deciding when another suite's data goes away.
 * Seeding it with SQL rather than through People's commands is the honest shape of the dependency —
 * Documents creates a person neither here nor in production.
 */
const FOREIGN_TABLES = ['person'];

export interface DocumentsFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresDocumentsStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /** Runs as a *named* actor, for the assertions about who verified and who read what. */
  asActor<TResult>(
    tenantId: string,
    actor: string,
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
  const expected = [...DOCUMENTS_TABLES, ...FOREIGN_TABLES];
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [expected],
  );
  const missing = expected.filter((table) => !present.rows.some((row) => row.table_name === table));

  if (missing.length > 0) {
    throw new Error(
      `Documents' tables are not in this database: ${missing.join(', ')}. ` +
        'These suites exercise the real schema — its policies, indexes, check constraints and the ' +
        'immutability triggers — so run `pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }
};

/**
 * Creates the unprivileged role the suite connects as, and grants it the tables it touches.
 *
 * It owns nothing and holds no `BYPASSRLS`, which is the only configuration under which an
 * isolation assertion means anything: a superuser bypasses every policy, so a suite run as one
 * would pass whether or not isolation worked — and in this module that would mean reporting that
 * one tenant cannot read another's medical certificates without having checked.
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
    `grant select, insert, update, delete on ${[...DOCUMENTS_TABLES, ...FOREIGN_TABLES].join(', ')} to ${role}`,
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

/** A person, exactly as People would have left one. */
const seedPersonWith = async (admin: Pool, tenantId: string): Promise<string> => {
  const personId = uuidV7();

  await admin.query(
    `insert into person
       (id, tenant_id, person_number, status, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'active', '{}'::jsonb, ${AUDIT})`,
    [personId, tenantId, `DOC-${personId.slice(-12)}`],
  );
  return personId;
};

/**
 * Opens the fixture, and closes what it opened if opening fails.
 *
 * Without the `catch`, a failure while checking the schema leaves the `admin` pool open and
 * unreferenced: `beforeAll` fails, `afterAll` has no fixture to close, and the socket keeps Node
 * alive forever. The suite would report a failure *and* hang, and the hang is what a reader sees.
 */
export const openDocumentsFixture = async (role: string): Promise<DocumentsFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });

  const application = await openApplicationPool(admin, role).catch(async (error: unknown) => {
    await admin.end();
    throw error;
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresDocumentsStores();
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
    seedPerson: (tenantId) => seedPersonWith(admin, tenantId),
    truncate: async () => {
      // `truncate` rather than `delete`: the immutability triggers refuse a delete of a version or
      // an access event, and a table-level truncate is not something a row trigger sees.
      await admin.query(`truncate ${DOCUMENTS_TABLES.join(', ')} cascade`);
    },
    close: async () => {
      try {
        await application.end();
        await admin.query(`truncate ${DOCUMENTS_TABLES.join(', ')} cascade`);
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
