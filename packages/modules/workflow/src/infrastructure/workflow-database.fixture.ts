import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresWorkflowStores } from './workflow-stores.js';

/**
 * The database fixture Workflow's schema suites share.
 *
 * **Two ways in, and both are needed.** `asTenant` issues raw SQL; `inTenant` runs the real
 * repositories inside a real `PostgresUnitOfWork` transaction. They check different things and
 * neither substitutes for the other.
 *
 * The raw probes assert what the *database* refuses on its own — a policy, a check constraint, a
 * partial unique index, a trigger. A probe issued through a repository would be proving that the
 * repository behaves as written; a probe that issues the `insert` itself proves that **no** path can
 * produce the state, including SQL nobody wrote in TypeScript. The repository path asserts the other
 * half: that what the application decides survives the round trip through real columns, real types
 * and real indexes.
 *
 * **Two connections, and the second is not a convenience.** `admin` seeds and inspects, as a
 * migration would. `application` connects as a role that owns nothing and cannot bypass row-level
 * security, which is the only configuration under which an isolation assertion means anything: a
 * superuser bypasses every policy silently, so a suite run as one would report that one tenant
 * cannot read another's approval queue without ever having checked. Phase 15 shipped a whole
 * cross-module suite with that defect before it was caught, and the role assertion below is the
 * thing that catches it.
 *
 * A third pool exists for the concurrency assertions. Two transactions on one pooled connection are
 * the same transaction, so a race written against a single connection proves only that a program
 * doing two things in order does them in order.
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

export const TENANT_A = '01930000-0000-7000-8000-0000000055ee';
export const TENANT_B = '01930000-0000-7000-8000-0000000066ff';

/** The seven tables this module owns, most dependent first, for truncation between tests. */
export const WORKFLOW_TABLES = [
  'workflow_history',
  'workflow_decision',
  'workflow_step',
  'workflow_instance',
  'workflow_step_template',
  'workflow_version',
  'workflow_definition',
];

/** The two whose rows are written once and never changed. */
export const APPEND_ONLY_TABLES = ['workflow_decision', 'workflow_history'];

const BOUNDS = {
  connectionTimeoutMillis: 15_000,
  statement_timeout: 30_000,
  max: 6,
} as const;

/** A membership identifier. Identity's, stored here as a value with no foreign key (ADR-0042). */
export const APPROVER = '01930000-0000-7000-8000-00000000b001';
export const SECOND_APPROVER = '01930000-0000-7000-8000-00000000b002';
export const DEPUTY = '01930000-0000-7000-8000-00000000b003';
export const REQUESTER = '01930000-0000-7000-8000-00000000b004';
export const CORRELATION = '01930000-0000-7000-8000-00000000c001';

export const SUBJECT_TYPE = 'recruitment.requisition';

/** The membership the repository suites act as, unless a test names another. */
export const TEST_MEMBER = APPROVER;

/** The audit columns every insert in these suites supplies. Stated once, not per statement. */
export const AUDIT_COLUMNS = 'created_at, created_by, updated_at, updated_by, version';
export const AUDIT_VALUES = `now(), 'user:test', now(), 'user:test', 1`;

/**
 * The message PostgreSQL raised, with the constraint or trigger that raised it.
 *
 * A probe that asserted on `instanceof Error` alone would pass for a typo in the SQL as readily as
 * for the constraint it meant to provoke, so every refusal in these suites names its origin.
 */
export const refusalOf = (error: unknown): string => {
  if (error instanceof Error) {
    const detail = (error as { constraint?: string }).constraint;

    return detail === undefined ? error.message : `${error.message} [${detail}]`;
  }
  return '';
};

/**
 * One statement that is expected to be refused, run so the refusal does not poison the transaction.
 *
 * PostgreSQL aborts a whole transaction on any error, and every statement afterwards fails with
 * `current transaction is aborted` — so a suite that provokes three constraints in one transaction
 * reads the first refusal and then three copies of that message, which is what the second and third
 * assertions would be checking. A savepoint per attempt is the fix: the rollback undoes exactly the
 * failed statement and the transaction carries on.
 *
 * Returns the refusal, or `'accepted'` when the database allowed what it should not have.
 */
export const probe = async (
  client: PoolLike,
  sql: string,
  values?: readonly unknown[],
): Promise<string> => {
  await client.query('savepoint probe');
  try {
    await client.query(sql, values);
    await client.query('release savepoint probe');
    return 'accepted';
  } catch (error: unknown) {
    await client.query('rollback to savepoint probe');
    return refusalOf(error);
  }
};

/**
 * A role that owns nothing and holds no `BYPASSRLS`.
 *
 * Asserted rather than assumed, immediately after creation: `nosuperuser` in a `create role` says
 * what was asked for, and `pg_roles` says what the database actually has.
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
    `grant select, insert, update, delete on ${WORKFLOW_TABLES.join(', ')} to ${role}`,
  );

  const { rows } = await admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    `select rolsuper, rolbypassrls from pg_roles where rolname = $1`,
    [role],
  );

  if (rows[0] === undefined || rows[0].rolsuper || rows[0].rolbypassrls) {
    throw new Error(
      `${role} can bypass row-level security, so every isolation assertion here would be hollow.`,
    );
  }

  const url = new URL(CONNECTION ?? '');

  url.username = role;
  url.password = 'fixture';
  return url.toString();
};

/**
 * Fails with the cause rather than a symptom.
 *
 * An unmigrated database otherwise produces `relation "..." does not exist` from whichever statement
 * touched it first, which sends the reader to the fixture rather than to the missing migration step.
 */
const assertSchemaApplied = async (admin: Pool): Promise<void> => {
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [WORKFLOW_TABLES],
  );
  const missing = WORKFLOW_TABLES.filter(
    (table) => !present.rows.some((row) => row.table_name === table),
  );

  if (missing.length > 0) {
    throw new Error(
      `Workflow's tables are not in this database: ${missing.join(', ')}. These suites exercise the ` +
        'real schema — its policies, indexes, check constraints and immutability triggers — so run ' +
        '`pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }
};

/** The narrow slice of a `pg` client these suites use. */
export interface PoolLike {
  query<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: TRow[]; rowCount: number | null }>;
}

export type TenantWork<TResult> = (client: PoolLike) => Promise<TResult>;

export interface WorkflowFixture {
  readonly admin: Pool;
  readonly roleName: string;
  /** The real PostgreSQL repositories, over the unprivileged connection. */
  readonly stores: ReturnType<typeof postgresWorkflowStores>;
  readonly unitOfWork: UnitOfWork;
  /**
   * Runs repository work inside a real transaction, as the unprivileged role, for one tenant.
   *
   * The transaction is the *application's* — `PostgresUnitOfWork` opens it, sets `app.tenant_id`
   * transaction-locally, and commits or rolls back. No repository below opens one of its own, which
   * is what makes a multi-write command atomic and what the rollback assertion checks.
   */
  inTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /** The same, as a *named* membership, for the assertions about who decided what. */
  asMember<TResult>(
    tenantId: string,
    actor: string,
    membershipId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  /** A second unit of work on its **own** connection, for the repository-level race assertions. */
  secondUnitOfWork(): UnitOfWork;
  /** One statement batch as the unprivileged role, inside the tenant's row-security context. */
  asTenant<TResult>(tenantId: string, work: TenantWork<TResult>): Promise<TResult>;
  /** The same, on a **second** connection, so a race is arbitrated by PostgreSQL and not by Node. */
  onSecondConnection<TResult>(tenantId: string, work: TenantWork<TResult>): Promise<TResult>;
  /** As the unprivileged role with **no** `app.tenant_id` set at all. */
  withoutTenant<TResult>(work: TenantWork<TResult>): Promise<TResult>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

export const openWorkflowFixture = async (role: string): Promise<WorkflowFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });
  const applicationUrl = await assertAndBuild(admin, role);
  const application = new Pool({ connectionString: applicationUrl, ...BOUNDS });
  const second = new Pool({ connectionString: applicationUrl, ...BOUNDS });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresWorkflowStores();
  const secondary: Pool[] = [];
  const inContext = <TResult>(
    tenantId: string,
    actor: string,
    membershipId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult> =>
    runInContext({ tenantId, correlationId: uuidV7(), actor, membershipId }, () =>
      unitOfWork.execute(work),
    );

  return {
    admin,
    roleName: role,
    stores,
    unitOfWork,
    inTenant: (tenantId, work) => inContext(tenantId, 'user:workflow-test', TEST_MEMBER, work),
    asMember: (tenantId, actor, membershipId, work) =>
      inContext(tenantId, actor, membershipId, work),
    secondUnitOfWork: () => {
      const pool = new Pool({ connectionString: applicationUrl, ...BOUNDS });

      secondary.push(pool);
      return new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
    },
    asTenant: (tenantId, work) => inTenantOn(application, tenantId, work),
    onSecondConnection: (tenantId, work) => inTenantOn(second, tenantId, work),
    withoutTenant: (work) => inTenantOn(application, undefined, work),
    truncate: async () => {
      // `truncate` rather than `delete`: the two immutability triggers refuse a delete from any
      // path, and a table-level truncate is not something a row trigger sees.
      //
      // **No `cascade`.** Nothing outside this module references a Workflow table, and a cascade
      // that reached another module's rows is the defect Phase 12 found when Documents' fixture
      // wiped Letters' rows mid-test. The list is ordered most-dependent-first instead.
      await admin.query(`truncate ${WORKFLOW_TABLES.join(', ')}`);
    },
    close: async () => {
      try {
        await Promise.all(secondary.map((pool) => pool.end()));
        await second.end();
        await application.end();
        await admin.query(`truncate ${WORKFLOW_TABLES.join(', ')}`);
      } finally {
        await admin.end();
      }
    },
  };
};

/**
 * One transaction, with the tenant set the way `PostgresUnitOfWork` sets it.
 *
 * `set_config(..., true)` is transaction-local, so a pooled connection cannot carry one tenant's
 * setting into the next caller's work — the property a fixture that set it session-wide would
 * quietly destroy, taking every isolation assertion with it.
 *
 * The rollback lives in `finally` rather than in the `catch`: a client returned to the pool inside
 * an aborted transaction fails the *next* test rather than this one, which is a defect Phase 15 paid
 * an afternoon for.
 */
const inTenantOn = async <TResult>(
  pool: Pool,
  tenantId: string | undefined,
  work: TenantWork<TResult>,
): Promise<TResult> => {
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('begin');
    if (tenantId !== undefined) {
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    }

    const outcome = await work(client);

    await client.query('commit');
    committed = true;
    return outcome;
  } finally {
    if (!committed) await client.query('rollback');
    client.release();
  }
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
