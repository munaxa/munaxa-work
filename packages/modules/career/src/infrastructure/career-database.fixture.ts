import { Pool } from 'pg';

/**
 * The database fixture Career's schema suites share.
 *
 * **Raw SQL, deliberately, and no repositories.** There are none yet: this checkpoint delivers the
 * schema and nothing above it. That makes these suites *stronger* rather than weaker for what they
 * check, because every assertion here is about what the database refuses on its own — a policy, a
 * check constraint, a partial unique index, a trigger. A probe that went through a repository would
 * be proving the repository behaves as written; a probe that issues the `insert` itself is proving
 * that no path, including SQL nobody wrote in TypeScript, can produce the state.
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

export const TENANT_A = '01930000-0000-7000-8000-0000000033cc';
export const TENANT_B = '01930000-0000-7000-8000-0000000044dd';

/** The twelve tables this module owns, most dependent first, for truncation between tests. */
export const CAREER_TABLES = [
  'career_development_item',
  'career_development_plan',
  'career_mobility_recommendation',
  'career_readiness_assessment',
  'career_successor',
  'career_succession_plan',
  'career_readiness_level',
  'career_pool_membership',
  'career_talent_pool',
  'career_plan',
  'career_stage',
  'career_path',
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
 * worked — which here would mean reporting that one tenant cannot read another's succession bench
 * or readiness assessments without ever having checked.
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
    `grant select, insert, update, delete on ${CAREER_TABLES.join(', ')} to ${role}`,
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
    [CAREER_TABLES],
  );
  const missing = CAREER_TABLES.filter(
    (table) => !present.rows.some((row) => row.table_name === table),
  );

  if (missing.length > 0) {
    throw new Error(
      `Career's tables are not in this database: ${missing.join(', ')}. These suites exercise the ` +
        'real schema — its policies, indexes, check constraints and immutability trigger — so run ' +
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

/** One statement batch, run as the unprivileged role inside a tenant's row-security context. */
export type TenantWork<TResult> = (client: PoolLike) => Promise<TResult>;

export interface CareerFixture {
  readonly admin: Pool;
  readonly application: Pool;
  /** Runs one statement batch as the unprivileged role, inside the tenant's row-security context. */
  asTenant<TResult>(tenantId: string, work: TenantWork<TResult>): Promise<TResult>;
  /**
   * The same, on a **second** connection, for the concurrency assertions.
   *
   * Two transactions on one pooled connection are the same transaction, so a race written against a
   * single connection proves nothing at all — it proves that a program doing two things in order
   * does them in order. This opens a separate pool, so the two are genuinely concurrent and the
   * arbiter is PostgreSQL rather than JavaScript's ordering.
   */
  onSecondConnection<TResult>(tenantId: string, work: TenantWork<TResult>): Promise<TResult>;
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
export const openCareerFixture = async (role: string): Promise<CareerFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, ...BOUNDS });
  const applicationUrl = await assertAndBuild(admin, role);
  const application = new Pool({ connectionString: applicationUrl, ...BOUNDS });
  const second = new Pool({ connectionString: applicationUrl, ...BOUNDS });

  return {
    admin,
    application,
    asTenant: (tenantId, work) => inTenantOn(application, tenantId, work),
    onSecondConnection: (tenantId, work) => inTenantOn(second, tenantId, work),
    truncate: async () => {
      // `truncate` rather than `delete`: the readiness-assessment trigger refuses a delete from any
      // path, and a table-level truncate is not something a row trigger sees.
      //
      // **No `cascade`.** Nothing outside this module references a Career table, and a cascade that
      // reached another module's rows is the defect Phase 12 found when Documents' fixture wiped
      // Letters' rows mid-test. The list is ordered most-dependent-first instead.
      await admin.query(`truncate ${CAREER_TABLES.join(', ')}`);
    },
    close: async () => {
      try {
        await second.end();
        await application.end();
        await admin.query(`truncate ${CAREER_TABLES.join(', ')}`);
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
 */
const inTenantOn = async <TResult>(
  pool: Pool,
  tenantId: string,
  work: TenantWork<TResult>,
): Promise<TResult> => {
  const client = await pool.connect();

  try {
    await client.query('begin');
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

/** A cross-module identifier. Career stores these as plain `uuid` with no foreign key (ADR-0042). */
export const EMPLOYMENT = '01930000-0000-7000-8000-00000000e001';
export const OTHER_EMPLOYMENT = '01930000-0000-7000-8000-00000000e002';
export const POSITION = '01930000-0000-7000-8000-00000000f001';
export const OTHER_POSITION = '01930000-0000-7000-8000-00000000f002';
export const LEARNING_ASSIGNMENT = '01930000-0000-7000-8000-00000000a001';

/**
 * The message PostgreSQL raised, or the empty string.
 *
 * A probe that asserted on `instanceof Error` alone would pass for a typo in the SQL as readily as
 * for the constraint it meant to provoke, so every refusal in these suites names the constraint,
 * index or trigger that produced it.
 */
export const refusalOf = (error: unknown): string => {
  if (error instanceof Error) {
    const detail = (error as { constraint?: string }).constraint;

    return detail === undefined ? error.message : `${error.message} [${detail}]`;
  }
  return '';
};
