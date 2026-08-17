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
  type WorkModule,
} from '@work/kernel';
import {
  ConfiguredTenantSettings,
  identityModule,
  postgresIdentityStores,
  systemClock,
} from '@work/identity';
import { employmentModule, postgresEmploymentStores } from '@work/employment';
import { ALL_WORKFLOW_PERMISSIONS } from '@work/workflow';
import { PostgresUnitOfWork } from '@work/persistence';

import {
  DeferredRecruitmentSender,
  recruitmentModuleFor,
} from '../recruitment/recruitment.composition.js';
import { workflowModuleFor } from './workflow.composition.js';
import {
  ADMIN_ACTOR,
  APPROVER,
  TENANT_A,
  seedIdentityWorld,
} from './workflow-cross-module-world.js';
import { CONNECTION, OWNER_TABLES, TABLES } from './workflow-cross-module-role.fixture.js';
import type { Asking } from '../payroll/asking.js';
import type { Sending } from './sending.js';

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

export {
  APPLICATION_ROLE,
  CONNECTION,
  applicationConnection,
  requireDatabaseInCi,
  roleIsUnprivileged,
} from './workflow-cross-module-role.fixture.js';
export {
  ADMIN_ACTOR,
  APPROVER,
  AUDIT,
  AUDIT_COLUMNS,
  B_APPROVER,
  B_REQUESTER_EMPLOYMENT,
  MANAGER,
  MANAGER_EMPLOYMENT,
  REQUESTER_EMPLOYMENT,
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
  UNADOPTED,
  seedIdentityWorld,
  seedReportingLine,
} from './workflow-cross-module-world.js';

export interface WorkflowCrossModuleHarness {
  readonly dispatcher: Dispatcher;
  readonly pool: Pool;
  /**
   * The owner connection, for seeding another module's world only.
   *
   * Identity's memberships already go in this way, and Phase 16C's employments and reporting lines
   * join them: `tenant_membership` and `employment` are written by their own modules' commands in
   * production, and the unprivileged role this suite asserts through cannot and should not
   * bootstrap them. **No assertion uses this pool** — every security claim still runs through the
   * application role, whose `rolsuper` and `rolbypassrls` are checked first.
   */
  readonly owner: Pool;
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
  /**
   * Leaves Recruitment off the dispatcher — the adopting module being unavailable, in the production
   * composition rather than behind a stub.
   */
  readonly withoutRecruitment?: boolean;
  /**
   * Leaves Employment off the dispatcher — the module that owns the reporting line being
   * unavailable, in the production composition rather than behind a stub.
   */
  readonly withoutEmployment?: boolean;
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
  present: {
    readonly identity: boolean;
    readonly recruitment: boolean;
    readonly employment: boolean;
  },
): void => {
  if (present.identity) attach(dispatcher, identityFor(unitOfWork));
  if (present.employment) attach(dispatcher, employmentFor(unitOfWork));

  // Recruitment's real module: `recruitment.decide-requisition` runs its own handler, its own
  // aggregate and its own repository against the real tables under its own policy. The seam under
  // test is a command going into a module, so a stub here would test nothing.
  const recruitmentSender = new DeferredRecruitmentSender();
  const recruitment = recruitmentModuleFor(unitOfWork, recruitmentSender);

  recruitmentSender.attach(dispatcher);

  if (present.recruitment) attach(dispatcher, recruitment);

  const asking: Asking = { ask: (query) => dispatcher.ask(query) };
  const sending: Sending = {
    ask: (query) => dispatcher.ask(query),
    send: (command) => dispatcher.send(command),
  };

  attach(dispatcher, workflowModuleFor(unitOfWork, asking, sending, permissions));
};

/** Identity's real module. Its queries answer the delegation and manager reads Workflow makes. */
const identityFor = (unitOfWork: PostgresUnitOfWork): WorkModule =>
  identityModule({
    unitOfWork,
    stores: postgresIdentityStores(),
    settings: new ConfiguredTenantSettings(IDENTITY_DEFAULTS),
    clock: systemClock,
  });

/**
 * Employment's real module, for the one query the reporting-line adapter asks it:
 * `employment.read-employment`, which resolves the primary line in force on a date.
 *
 * Its two outbound ports are stubbed because neither is on this path — a person's name is optional
 * on the view, and an organizational unit is only checked when an assignment is written, which these
 * suites never do. Everything the manager chain actually reads is the real module over real tables.
 */
const employmentFor = (unitOfWork: PostgresUnitOfWork): WorkModule =>
  employmentModule(
    {
      unitOfWork,
      stores: postgresEmploymentStores(),
      people: { find: () => Promise.resolve(undefined) },
      organization: { unitExists: () => Promise.resolve(true) },
      clock: systemClock,
    },
    // Employment sends no command on this path, and a harness that let it would be offering these
    // suites a capability Workflow's grants do not include.
    { send: () => Promise.reject(new Error('Employment sends no command in this suite.')) },
  );

/** Every handler a module declares, on the dispatcher. */
const attach = (dispatcher: Dispatcher, module: WorkModule): void => {
  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
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

  register(dispatcher, unitOfWork, permissions, {
    identity: options.withoutIdentity !== true,
    recruitment: options.withoutRecruitment !== true,
    employment: options.withoutEmployment !== true,
  });

  return {
    dispatcher,
    pool,
    owner: admin,
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
      await admin.query(`truncate ${OWNER_TABLES.join(', ')} cascade`);
      await seedIdentityWorld(admin);
    },
    close: async () => {
      await pool.query(`truncate ${TABLES.join(', ')}`);
      await admin.query(`truncate ${OWNER_TABLES.join(', ')} cascade`);
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
