import 'reflect-metadata';

import { Pool } from 'pg';
import {
  Dispatcher,
  GrantAwarePermissionChecker,
  InProcessEventDispatcher,
  currentContext,
  runInContext,
  uuidV7,
  type Command,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type Result,
  type ServiceElevation,
} from '@work/kernel';
import {
  ConfiguredTenantSettings,
  identityModule,
  postgresIdentityStores,
  systemClock,
} from '@work/identity';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';
import { PostgresUnitOfWork } from '@work/persistence';

import { workflowModuleFor } from './workflow.composition.js';
import {
  ADMIN_ACTOR,
  APPROVER,
  TENANT_A,
  seedIdentityWorld,
} from './workflow-cross-module-world.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The wiring Phase 16A's cross-module suite runs against.
 *
 * **Nothing in the path is a fake.** Workflow is built by `workflowModuleFor` — the production
 * composition function the API's module provider calls — so the stores are the PostgreSQL
 * repositories and the delegation port is `WorkflowDelegations`, reached through a bounded service
 * grant. Identity is the **real module**, answering `identity.active-delegations-for` from its own
 * repository against the real `delegation` table under its own row-level security policy. Both sit
 * on **one real dispatcher**, which is how they reach each other in production and the only way
 * Workflow ever reaches Identity: there is no import between the two packages.
 *
 * **Only Identity's queries are registered**, not its commands. Workflow reads Identity and writes
 * nothing to it, and a harness that registered a write surface would be offering this suite a
 * capability the product does not give the module.
 *
 * The permission checker is wrapped exactly as the composition root wraps it. Without
 * `GrantAwarePermissionChecker` every service grant is inert and every cross-module read is refused,
 * so a plain checker here would produce a suite that passed for the wrong reason — refusing
 * delegated approvals because the grant never applied rather than because no delegation existed.
 *
 * **Nothing publishes an event and nothing subscribes to one**, which is not a simplification:
 * Workflow asks Identity at the instant of the decision, so there is no delivery to lose (D-9).
 *
 * **Nothing is scheduled.** No `JobPort` exists in this repository, so no delegation expires on a
 * timer here or in production — an expired arrangement simply is not in Identity's answer.
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
const TABLES = [
  'workflow_history',
  'workflow_decision',
  'workflow_step',
  'workflow_instance',
  'workflow_step_template',
  'workflow_version',
  'workflow_definition',
  'delegation',
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
const IDENTITY_TABLES = ['delegation', 'tenant_membership', 'workforce_user'];

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
    // Read-only on the two Identity tables the delegation query joins nothing to but reads through:
    // Workflow never writes to Identity, and the role it runs as could not if it tried.
    await admin.query(`grant select on tenant_membership, workforce_user to ${APPLICATION_ROLE}`);

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

export interface WorkflowCrossModuleHarness {
  readonly dispatcher: Dispatcher;
  readonly pool: Pool;
  /**
   * Every permission elevation a bounded service grant performed, in the order it happened.
   *
   * The full record, not just the permission name: an elevation carries the tenant, the actor and
   * the correlation identifier of the request that caused it, which is how this suite proves all
   * three survive the hop into another module rather than assuming they do.
   */
  readonly elevations: ServiceElevation[];
  rowsIn<TRow extends Record<string, unknown>>(
    tenantId: string,
    text: string,
    values?: readonly unknown[],
  ): Promise<TRow[]>;
  inTenant<TResult>(
    tenantId: string,
    membershipId: string | undefined,
    work: () => Promise<TResult>,
  ): Promise<TResult>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
  readonly connectionString?: string;
  /**
   * Leaves Identity off the dispatcher entirely — the dependency being unavailable, in the
   * production composition rather than behind a stub.
   *
   * Everything else is unchanged, so what the suite observes is what a deployment observes when the
   * module that answers `identity.active-delegations-for` is not there.
   */
  readonly withoutIdentity?: boolean;
}

/** Raw SQL on the harness's pool, inside one tenant's row-security context. */
const readerFor =
  (pool: Pool) =>
  async <TRow extends Record<string, unknown>>(
    tenantId: string,
    text: string,
    values?: readonly unknown[],
  ): Promise<TRow[]> => {
    const client = await pool.connect();

    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);

      const read = await client.query<TRow>(text, values === undefined ? undefined : [...values]);

      return read.rows;
    } finally {
      // Always, including after a failed statement: a client returned to the pool inside an aborted
      // transaction refuses everything the next caller sends.
      await client.query('rollback');
      client.release();
    }
  };

const IDENTITY_DEFAULTS = {
  language: 'en',
  calendar: 'gregorian',
  timeZone: 'Asia/Riyadh',
  numerals: 'western',
  invitationValidityDays: 7,
  defaultPortals: [],
} as const;

/**
 * Both modules, on one dispatcher: Identity's queries and the whole of Workflow.
 *
 * **Identity's queries only, and no commands.** Workflow reads Identity and writes nothing to it, so
 * a harness that registered a write surface would be offering these suites a capability the product
 * does not give the module. `withIdentity` false leaves Identity off the dispatcher entirely — the
 * dependency being unavailable, in the shape the dispatcher actually produces it.
 *
 * **Workflow comes from `workflowModuleFor`**, the production composition function, rather than
 * being assembled here: the point of these suites is that the wiring under test is the wiring that
 * ships.
 */
const register = (
  dispatcher: Dispatcher,
  unitOfWork: PostgresUnitOfWork,
  permissions: PermissionChecker,
  withIdentity: boolean,
): void => {
  const identity = identityModule({
    unitOfWork,
    stores: postgresIdentityStores(),
    settings: new ConfiguredTenantSettings(IDENTITY_DEFAULTS),
    clock: systemClock,
  });

  if (withIdentity) {
    for (const handler of identity.queries ?? []) dispatcher.registerQuery(handler);
  }

  const asking: Asking = { ask: (query) => dispatcher.ask(query) };
  const workflow = workflowModuleFor(unitOfWork, asking, permissions);

  for (const handler of workflow.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of workflow.queries ?? []) dispatcher.registerQuery(handler);
};

export const harnessFor = (options: HarnessOptions = {}): WorkflowCrossModuleHarness => {
  const granted = options.permissions ?? ALL_WORKFLOW_PERMISSIONS;
  const elevations: ServiceElevation[] = [];
  const permissions = new GrantAwarePermissionChecker(
    { holds: (permission) => Promise.resolve(granted.includes(permission)) },
    (elevation) => elevations.push(elevation),
  );
  const dispatcher = new Dispatcher(permissions);
  const pool = new Pool({
    connectionString: options.connectionString ?? CONNECTION,
    max: 4,
    connectionTimeoutMillis: 15_000,
  });
  const unitOfWork = new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
  // The owner connection, for setting up Identity's world only. No assertion is made through it.
  const admin = new Pool({ connectionString: CONNECTION, max: 2, connectionTimeoutMillis: 15_000 });

  register(dispatcher, unitOfWork, permissions, options.withoutIdentity !== true);

  return {
    dispatcher,
    pool,
    elevations,
    rowsIn: readerFor(pool),
    inTenant: (tenantId, membershipId, work) =>
      runInContext(
        {
          tenantId,
          correlationId: uuidV7(),
          actor: ADMIN_ACTOR,
          ...(membershipId === undefined ? {} : { membershipId }),
        },
        work,
      ),
    truncate: async () => {
      await pool.query(`truncate ${TABLES.join(', ')}`);
      await admin.query(`truncate ${IDENTITY_TABLES.join(', ')} cascade`);
      await seedIdentityWorld(admin);
    },
    close: async () => {
      await pool.query(`truncate ${TABLES.join(', ')}`);
      await admin.query(`truncate ${IDENTITY_TABLES.join(', ')} cascade`);
      await admin.end();
      await pool.end();
    },
  };
};

/** Establishes a context if none is open, exactly as the HTTP middleware does in production. */
const inContext = <TResult>(work: () => Promise<TResult>): Promise<TResult> =>
  currentContext() === undefined
    ? runInContext(
        { tenantId: TENANT_A, correlationId: uuidV7(), actor: ADMIN_ACTOR, membershipId: APPROVER },
        work,
      )
    : work();

type SentCommand = Command & Record<string, unknown>;
type SentQuery = Query & Record<string, unknown>;

export const send = async <TResult>(
  harness: WorkflowCrossModuleHarness,
  command: SentCommand,
): Promise<TResult> => {
  const result = await inContext(() => harness.dispatcher.send<TResult>(command));

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const attempt = (
  harness: WorkflowCrossModuleHarness,
  command: SentCommand,
): Promise<Result<unknown, HandlerFailure>> => inContext(() => harness.dispatcher.send(command));

export const ask = async <TResult>(
  harness: WorkflowCrossModuleHarness,
  query: SentQuery,
): Promise<TResult> => {
  const result = await inContext(() => harness.dispatcher.ask<TResult>(query));

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};
