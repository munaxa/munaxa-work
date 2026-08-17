import { Pool } from 'pg';

/**
 * The database role the cross-module suites connect as, and the tables it may touch.
 *
 * In its own file because it is setup rather than composition: which tables exist, who may read
 * them, and how they are reset between tests has nothing to do with how Workflow, Identity and
 * Recruitment are wired to one another.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

// ------------------------------------------------------------------------------------------------
// The world both tenants are set up in
// ------------------------------------------------------------------------------------------------

export {
  ADMIN_ACTOR,
  APPROVER,
  AUDIT,
  AUDIT_COLUMNS,
  B_APPROVER,
  B_DEPUTY,
  B_REQUESTER,
  DECIDE_SCOPE,
  DEPUTY,
  MEMBERSHIPS,
  NOW,
  OUTSIDER,
  REQUESTER,
  SUBJECT_TYPE,
  TENANT_A,
  TENANT_B,
  seedIdentityWorld,
} from './workflow-cross-module-world.js';

/**
 * The tables the harness truncates between tests, most dependent first.
 *
 * `delegation` is Identity's and is on this list because the suite writes delegations into it: the
 * cross-module fact under test is a row in another module's table, read back through that module's
 * own published query.
 */
export const TABLES = [
  'workflow_history',
  'workflow_decision',
  'workflow_step',
  'workflow_instance',
  'workflow_step_template',
  'workflow_version',
  'workflow_definition',
  // The two Phase 16B added. A group is named by a step template, so it is the least dependent of
  // the nine and comes last — and the role needs both, because the API now creates and reads them.
  'workflow_approval_group_member',
  'workflow_approval_group',
];

/**
 * The adopting module's tables: written by the suites, but **reset by the owner**.
 *
 * `recruitment_requisition` is referenced by vacancies and applications, so clearing it needs a
 * cascade — and a cascade needs `truncate` on every table it reaches, which is authority this role
 * has no business holding. The application role keeps exactly what the seam needs: read, insert and
 * update on the two requisition tables, and nothing on the rest of Recruitment.
 */
export const RECRUITMENT_TABLES = [
  'recruitment_requisition_decision',
  'recruitment_requisition',
  'recruitment_number_sequence',
];

/**
 * Identity's own rows, seeded as the **owner** rather than as the application role.
 *
 * `workforce_user`'s policy admits a user only when a membership already points at it, and
 * `tenant_membership` is forced-RLS as well, so the unprivileged role cannot bootstrap the two of
 * them — correctly, because in production they are created by Identity's own commands.
 *
 * Setting up another module's world as the owner is fixture work; it is not where a security claim
 * is made. **Every assertion in the suites runs through the application role**, whose `rolsuper` and
 * `rolbypassrls` are checked before any isolation result is believed.
 */
export const IDENTITY_TABLES = [
  'delegation',
  // Phase 16C: the reporting-line adapter resolves a membership to its primary employment and an
  // employment back to its holder, both through Identity's own published queries.
  'employment_link',
  'tenant_membership',
  'workforce_user',
];

/**
 * Employment's tables, for the one query the manager chain asks: `employment.read-employment`.
 *
 * Read-only for the application role and seeded by the owner, on exactly the reasoning the Identity
 * grant above records — setting up another module's world is fixture work, and every assertion still
 * runs through the unprivileged role. Workflow never writes to Employment and the role it runs as
 * could not if it tried.
 *
 * `employment_status_record` is here because `read-employment` reconstructs the status in force on a
 * date from the history rather than reading the row, so its own handler touches a table the manager
 * chain never names.
 */
export const EMPLOYMENT_TABLES = [
  'employment_reporting_line',
  // An employment references a person by a real foreign key, so the fixture seeds one and the
  // owner clears it. Nothing on the manager path reads it.
  'person',
  'employment_status_record',
  'employment_assignment',
  'employment_contract',
  'employment',
];

/** Everything the owner clears between tests, most dependent first. */
export const OWNER_TABLES = [...RECRUITMENT_TABLES, ...EMPLOYMENT_TABLES, ...IDENTITY_TABLES];

/**
 * A role that owns nothing, holds no `BYPASSRLS`, and is not a superuser.
 *
 * The database this suite runs against belongs to `work`, which **is** a superuser — and a superuser
 * bypasses every row-level security policy there is. Connecting as one would mean the tenant
 * assertions were proving only that the SQL filters on a tenant, and reporting that row-level
 * security holds without ever having given it the chance to refuse. The suite asserts `rolsuper` and
 * `rolbypassrls` are both false before relying on a single security result.
 */
export const APPLICATION_ROLE = 'workflow_cross_module';

export const applicationConnection = async (): Promise<string> => {
  if (CONNECTION === undefined) throw new Error('Set TEST_DATABASE_URL.');

  const admin = new Pool({ connectionString: CONNECTION, connectionTimeoutMillis: 15_000 });

  try {
    await admin.query(
      `do $$ begin
         if not exists (select 1 from pg_roles where rolname = '${APPLICATION_ROLE}') then
           create role ${APPLICATION_ROLE} login nosuperuser password 'fixture';
         end if;
       end $$`,
    );
    await admin.query(
      `grant select, insert, update, delete, truncate on ${TABLES.join(', ')} to ${APPLICATION_ROLE}`,
    );
    /*
     * Read-only on the three Identity tables the delegation path touches: `delegation` itself, and
     * the membership and user rows its own policies consult. Workflow never writes to Identity, and
     * the role it runs as could not if it tried.
     *
     * `delegation` was missing here until the Phase 16A audit, and the suites passed anyway —
     * against a database that had carried the grant since before the fixture was written. A fresh
     * database is what exposed it: every delegation suite failed with `permission denied for table
     * delegation`, which is a fixture that had stopped describing what it needs rather than a
     * product that had changed. Granted explicitly so the suites run from a migrated database and
     * nothing else.
     */
    await admin.query(`grant select on ${IDENTITY_TABLES.join(', ')} to ${APPLICATION_ROLE}`);
    // And read-only on Employment's, for the same reason and with the same limits: the manager
    // chain asks Employment one question and writes nothing anywhere.
    await admin.query(`grant select on ${EMPLOYMENT_TABLES.join(', ')} to ${APPLICATION_ROLE}`);
    // And `insert` on `delegation` alone, for the **fixture** rather than for the seam: the suites
    // write the arrangements they then test, under the tenant context and the table's own policy.
    // Production never writes here — Workflow reads Identity and writes nothing to it, which is why
    // no other Identity table is writable by this role and why `update` and `delete` are withheld
    // even on this one.
    await admin.query(`grant insert on delegation to ${APPLICATION_ROLE}`);
    // The seam's own reach into the adopting module: three tables, and no `truncate` on any.
    await admin.query(
      `grant select, insert, update, delete on ${RECRUITMENT_TABLES.join(', ')} to ${APPLICATION_ROLE}`,
    );
    // `recruitment.read-requisition` returns a requisition *with its vacancies*, so its own handler
    // reads a table the seam never names. A table privilege, granted read-only: in a deployment the
    // application role reaches every table its modules own, and withholding it here would be testing
    // a database grant rather than the permission model.
    await admin.query(`grant select on recruitment_vacancy to ${APPLICATION_ROLE}`);

    const url = new URL(CONNECTION);

    url.username = APPLICATION_ROLE;
    url.password = 'fixture';
    return url.toString();
  } finally {
    await admin.end();
  }
};

/** Whether the role the suite is connected as can actually be refused by a policy. */
export const roleIsUnprivileged = async (
  pool: Pool,
): Promise<{ readonly rolsuper: boolean; readonly rolbypassrls: boolean }> => {
  const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
  );
  const row = rows[0];

  if (row === undefined) throw new Error('The connected role has no row in pg_roles.');
  return row;
};
