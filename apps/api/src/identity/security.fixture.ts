import type { Server } from 'node:http';

import { unsafeId, type TenantId, type UserId } from '@munaxa/types';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  ConfiguredTenantSettings,
  identityModule,
  PostgresMembershipDirectory,
  postgresIdentityStores,
  systemClock,
} from '@work/identity';
import {
  Dispatcher,
  GrantAwarePermissionChecker,
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type PermissionChecker,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import { WorkflowApprovalController, WorkflowDispatcher } from '@work/workflow';
import { Pool } from 'pg';
import request from 'supertest';

import { configureApplication } from '../application.setup.js';
import { CorrelationMiddleware } from '../observability/correlation.middleware.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';
import { TenantMiddleware } from '../tenancy/tenant.middleware.js';
import type { Asking } from '../payroll/asking.js';
import type { Sending } from '../workflow/sending.js';
import { workflowModuleFor } from '../workflow/workflow.composition.js';
import { WorkAuthorization } from './authorization.js';
import { authenticationFor } from './platform-authentication.js';
import { PlatformPermissionChecker } from './permission-checker.js';
import { securityEnvironment } from './security-issuer.js';
import { seedSecurityWorld } from './security-world.js';

export {
  AUDIENCE,
  CURRENT_KID,
  FOREIGN_KID,
  ISSUER,
  PREVIOUS_KID,
  securityEnvironment,
  tokenFor,
  type TokenOptions,
} from './security-issuer.js';
export {
  B_MEMBER,
  DUAL_IN_A,
  DUAL_IN_B,
  MEMBER,
  OTHER_MEMBER,
  TENANT_A,
  TENANT_B,
  WORKFORCE_USERS,
  personBehind,
  platformUserFor,
} from './security-world.js';

/**
 * The security boundary, end to end, with nothing between the wire and the database stubbed.
 *
 * Every layer a request crosses in production is the production one: the real relying-party
 * adapter verifying a real asymmetric signature, the real tenant middleware resolving a real
 * membership from PostgreSQL, the real guard, the real permission checker asking the platform's
 * real resolver over the tenant's real assignment rows, and the real Approvals controller behind
 * all of it. **No boolean is mocked anywhere in this fixture**, which is the only way a suite can
 * claim that unauthenticated is 401 and unauthorized is 403 rather than that two stubs returned
 * two different constants.
 *
 * The one thing that is not production is the *issuer*, and it cannot be: Munaxa Work holds no
 * signing key by design. So the fixture mints tokens with a key pair it generates in memory and
 * configures Work with the **public** half — which is exactly the relationship Work has with the
 * real issuer, and means the verification path under test is the deployed one rather than a
 * test-only branch. Nothing in `src/` knows this fixture exists.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
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

/** The tables the security role may touch, most dependent first. */
const AUTHORIZATION_TABLES = ['tenant_role_assignment', 'tenant_role'];
const WORKFLOW_TABLES = [
  'workflow_history',
  'workflow_decision',
  'workflow_step',
  'workflow_instance',
  'workflow_step_template',
  'workflow_version',
  'workflow_definition',
  'workflow_approval_group_member',
  'workflow_approval_group',
];
const IDENTITY_TABLES = ['delegation', 'employment_link', 'tenant_membership', 'workforce_user'];

/**
 * A role that owns nothing, holds no `BYPASSRLS` and is not a superuser.
 *
 * Its own role rather than a shared one: these suites assert that one tenant's grants are
 * unreachable from another, and a role whose privileges another fixture also edits is a role
 * whose refusals prove less than they appear to.
 */
const APPLICATION_ROLE = 'security_foundation';

const applicationConnection = async (): Promise<string> => {
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
      `grant select, insert, update, delete, truncate on ${[...AUTHORIZATION_TABLES, ...WORKFLOW_TABLES].join(', ')} to ${APPLICATION_ROLE}`,
    );
    await admin.query(`grant select on ${IDENTITY_TABLES.join(', ')} to ${APPLICATION_ROLE}`);

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

export interface SecurityFixture {
  /** The application, assembled exactly as the composition root assembles it. */
  readonly application: INestApplication;
  readonly authorization: WorkAuthorization;
  readonly pool: Pool;
  readonly owner: Pool;
  /** The dispatcher behind the controller, for seeding through the product's own commands. */
  readonly dispatcher: Dispatcher;
  /** Defines a role conferring platform grants, and gives it to one membership. */
  grant(
    tenantId: string,
    membershipId: string,
    permissions: readonly string[],
    roleId?: string,
  ): Promise<void>;
  revoke(tenantId: string, membershipId: string, roleId?: string): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const ROLE_ID = 'security-fixture-role';

/** The real modules on one dispatcher, with the real checker in front of them. */
const dispatcherFor = (pool: Pool, checker: PermissionChecker): Dispatcher => {
  const dispatcher = new Dispatcher(checker);
  const unitOfWork = new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
  const identity = identityModule({
    unitOfWork,
    stores: postgresIdentityStores(),
    settings: new ConfiguredTenantSettings(IDENTITY_DEFAULTS),
    clock: systemClock,
  });
  const asking: Asking = { ask: (query) => dispatcher.ask(query) };
  const sending: Sending = {
    ask: (query) => dispatcher.ask(query),
    send: (command) => dispatcher.send(command),
  };
  const workflow = workflowModuleFor(unitOfWork, asking, sending, checker);

  for (const handler of identity.queries ?? []) dispatcher.registerQuery(handler);
  for (const handler of workflow.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of workflow.queries ?? []) dispatcher.registerQuery(handler);
  return dispatcher;
};

/**
 * Opens the boundary: one application, one database, and the two seams wired for real.
 *
 * `GrantAwarePermissionChecker` wraps the platform checker exactly as the composition root wraps
 * it, so a bounded service grant behaves here as it does in production and a suite cannot pass by
 * accident because the wrapper was left out.
 */
const applicationFor = async (pool: Pool, dispatcher: Dispatcher): Promise<INestApplication> => {
  const environment = securityEnvironment();
  const authentication = authenticationFor(environment);

  if (authentication === undefined) throw new Error('The fixture configured no issuer.');

  const testing = await Test.createTestingModule({
    controllers: [WorkflowApprovalController],
    providers: [
      { provide: WorkflowDispatcher, useValue: new WorkflowDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();
  const application = testing.createNestApplication();
  const correlation = new CorrelationMiddleware();
  const tenancy = new TenantMiddleware(authentication, new PostgresMembershipDirectory(pool));

  // The production order, and it is the order that matters: correlation first so a refusal is
  // traceable, then authentication and tenant resolution, then the guard the controller runs
  // behind. Nothing downstream can establish an identity, because nothing downstream is given one
  // to establish.
  application.use((incoming: never, outgoing: never, next: () => void) =>
    correlation.use(incoming, outgoing, next),
  );
  application.use((incoming: never, outgoing: never, next: () => void) => {
    void tenancy.use(incoming, outgoing, next);
  });
  configureApplication(application, environment);
  await application.init();
  return application;
};

export const openSecurityBoundary = async (): Promise<SecurityFixture> => {
  const owner = new Pool({ connectionString: CONNECTION, max: 4 });
  const pool = new Pool({
    connectionString: await applicationConnection(),
    max: 8,
    connectionTimeoutMillis: 15_000,
  });
  const authorization = new WorkAuthorization(pool, () => undefined);
  const checker = new GrantAwarePermissionChecker(new PlatformPermissionChecker(authorization));
  const dispatcher = dispatcherFor(pool, checker);
  const application = await applicationFor(pool, dispatcher);

  const reset = async (): Promise<void> => {
    await pool.query(`truncate ${[...AUTHORIZATION_TABLES, ...WORKFLOW_TABLES].join(', ')}`);
    await owner.query(`truncate ${IDENTITY_TABLES.join(', ')} cascade`);
    await seedSecurityWorld(owner);
  };

  await reset();

  return {
    application,
    authorization,
    dispatcher,
    pool,
    owner,

    grant: async (tenantId, membershipId, permissions, roleId = ROLE_ID) => {
      const tenant = unsafeId<TenantId>(tenantId);

      await authorization.defineRole({
        id: roleId,
        tenantId: tenant,
        name: `Security fixture ${roleId}`,
        permissions,
      });
      await authorization.assign({
        tenantId: tenant,
        userId: unsafeId<UserId>(membershipId),
        roleId,
        assignedAt: Date.now(),
      });
    },

    revoke: async (tenantId, membershipId, roleId = ROLE_ID) => {
      await authorization.revoke(
        unsafeId<TenantId>(tenantId),
        unsafeId<UserId>(membershipId),
        roleId,
      );
    },

    reset,

    close: async () => {
      await application.close();
      await reset();
      await pool.end();
      await owner.end();
    },
  };
};

export const http = (application: INestApplication): request.Agent =>
  request(application.getHttpServer() as Server);

/** Seeds a membership that is active in `tenant_membership` but whose person is not. */
export const deactivateMembership = async (owner: Pool, membershipId: string): Promise<void> => {
  await owner.query(`update tenant_membership set status = 'suspended' where id = $1`, [
    membershipId,
  ]);
};

/**
 * One published workflow and one instance of it, so an authorized queue has something in it.
 *
 * Raised through **Workflow's own commands, behind the real permission checker**, which is why the
 * seeding membership is granted a wildcard role for the duration and stripped of it afterwards.
 * Seeding by SQL would produce rows the product cannot reach; seeding with the checker disabled
 * would leave a path through this fixture that production does not have.
 */
export const seedPendingApproval = async (
  fixture: SecurityFixture,
  tenantId: string,
  seeder: string,
  approver: string,
): Promise<void> => {
  const SEEDER_ROLE = 'security-fixture-seeder';

  await fixture.grant(tenantId, seeder, ['workflow:*'], SEEDER_ROLE);

  const send = async <TResult>(command: Record<string, unknown>): Promise<TResult> => {
    const result = await fixture.dispatcher.send<TResult>(command as never);

    if (!result.ok) throw new Error(`Seeding refused: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  await runInContext(
    { tenantId, correlationId: uuidV7(), actor: `user:${seeder}`, membershipId: seeder },
    async () => {
      const definition = await send<{ definitionId: string }>({
        commandName: 'workflow.create-definition',
        code: 'security-proof',
        name: { en: 'Security proof', ar: 'إثبات أمني' },
        description: { en: 'Raised by the security fixture', ar: 'يرفعه اختبار الأمن' },
        subjectType: 'leave.request',
      });
      const version = await send<{ workflowVersionId: string }>({
        commandName: 'workflow.draft-version',
        definitionId: definition.definitionId,
      });

      await send({
        commandName: 'workflow.add-step',
        workflowVersionId: version.workflowVersionId,
        ordinal: 1,
        name: { en: 'Approve', ar: 'اعتماد' },
        approverMembershipId: approver,
      });
      await send({
        commandName: 'workflow.publish-version',
        workflowVersionId: version.workflowVersionId,
        expectedVersion: 1,
      });
      await send({
        commandName: 'workflow.start-instance',
        definitionId: definition.definitionId,
        subjectType: 'leave.request',
        subjectId: 'leave-1',
        context: {},
      });
    },
  );

  await fixture.revoke(tenantId, seeder, SEEDER_ROLE);
};
