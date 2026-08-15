import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import {
  Dispatcher,
  GrantAwarePermissionChecker,
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type PermissionChecker,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import {
  ConfiguredTenantSettings,
  identityModule,
  postgresIdentityStores,
  systemClock,
} from '@work/identity';
import {
  WorkflowApprovalController,
  WorkflowDefinitionController,
  WorkflowDispatcher,
  WorkflowInstanceController,
  WorkflowVersionController,
} from '@work/workflow';

import { configureApplication } from '../application.setup.js';
import { CorrelationMiddleware } from '../observability/correlation.middleware.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';
import {
  DeferredRecruitmentSender,
  recruitmentModuleFor,
} from '../recruitment/recruitment.composition.js';
import { workflowModuleFor } from './workflow.composition.js';
import {
  APPLICATION_ROLE,
  CONNECTION,
  OWNER_TABLES,
  TABLES,
} from './workflow-cross-module-role.fixture.js';
import { seedIdentityWorld } from './workflow-cross-module-world.js';
import type { Asking } from '../payroll/asking.js';
import type { Sending } from './sending.js';

/**
 * The Workflow API over **real PostgreSQL**, as an unprivileged role, with row-level security on.
 *
 * Every layer below the HTTP request is the production one: the real controllers, the real global
 * filter and validation pipe, the real dispatcher, the real application handlers, the real
 * PostgreSQL repositories, the real Identity module answering the delegation question, and the real
 * Recruitment module receiving a terminal decision through the seam Checkpoint 7 built. **Nothing is
 * stubbed.** Workflow is assembled by `workflowModuleFor` — the production composition function —
 * so a substitution in the composition root would break these tests rather than hide behind them.
 *
 * There is no in-memory variant, and building one to make these tests easier would defeat them.
 * This module's most consequential properties — that an approver's queue is theirs and not
 * everybody's, that tenant A cannot decide tenant B's approval, that a concurrent decision is
 * refused rather than silently applied — are properties of the database, the middleware and the
 * wire, and a suite over a `Map` would report all three without having checked any.
 *
 * **Two headers stand in for the authenticated identity Platform will supply.** `x-test-actor` is
 * the workforce user, and `x-test-member` is the membership the request resolved — the seam
 * Checkpoint 4 added and the one an approval queue is keyed on. Both are established by middleware
 * *outside* the controller, exactly as production does: no controller in this module constructs an
 * identity, and a suite that let one would be testing a different product.
 */

export { CONNECTION } from './workflow-cross-module-role.fixture.js';
export {
  APPROVER,
  B_APPROVER,
  B_DEPUTY,
  DEPUTY,
  OUTSIDER,
  REQUESTER,
  SUBJECT_TYPE,
  TENANT_A,
  TENANT_B,
  UNADOPTED,
} from './workflow-cross-module-world.js';

/** A suite that quietly skips itself where merges are gated reports a property nobody checked. */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env['CI'] !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const ADMIN_ACTOR = 'user:workflow-admin';

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

const IDENTITY_DEFAULTS = {
  language: 'en',
  calendar: 'gregorian',
  timeZone: 'Asia/Riyadh',
  numerals: 'western',
  invitationValidityDays: 7,
  defaultPortals: [],
} as const;

/**
 * Wrapped exactly as the composition root wraps it.
 *
 * `GrantAwarePermissionChecker` is what makes a bounded service grant mean anything: without it the
 * delegation read and the Recruitment decision are both refused, and every delegated approval in
 * these suites would fail for the wrong reason.
 */
export const permitting = (...granted: readonly string[]): PermissionChecker =>
  new GrantAwarePermissionChecker({
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  });

const unprivileged = async (admin: Pool): Promise<string> => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${APPLICATION_ROLE}') then
         create role ${APPLICATION_ROLE} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );

  const url = new URL(CONNECTION ?? '');

  url.username = APPLICATION_ROLE;
  url.password = 'fixture';
  return url.toString();
};

export interface WorkflowApiFixture {
  /** An application bound to one tenant, one actor, one membership and one permission set. */
  applicationFor(
    tenantId: string,
    checker: PermissionChecker,
    membershipId?: string,
  ): Promise<INestApplication>;
  /** Raw SQL as the **admin** role, for assertions about the database's own configuration. */
  inspect<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<TRow[]>;
  /** Raw SQL as the **application** role, inside one tenant's row-security context. */
  rowsIn<TRow extends Record<string, unknown>>(
    tenantId: string,
    text: string,
    values?: readonly unknown[],
  ): Promise<TRow[]>;
  readonly pool: Pool;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/** The real modules, on one dispatcher, exactly as the composition root assembles them. */
const dispatcherFor = (application: Pool, checker: PermissionChecker): Dispatcher => {
  const dispatcher = new Dispatcher(checker);
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const asking: Asking = { ask: (query) => dispatcher.ask(query) };
  const sending: Sending = {
    ask: (query) => dispatcher.ask(query),
    send: (command) => dispatcher.send(command),
  };
  const identity = identityModule({
    unitOfWork,
    stores: postgresIdentityStores(),
    settings: new ConfiguredTenantSettings(IDENTITY_DEFAULTS),
    clock: systemClock,
  });
  const recruitmentSender = new DeferredRecruitmentSender();
  const recruitment = recruitmentModuleFor(unitOfWork, recruitmentSender);

  recruitmentSender.attach(dispatcher);

  for (const handler of identity.queries ?? []) dispatcher.registerQuery(handler);
  for (const module of [recruitment, workflowModuleFor(unitOfWork, asking, sending, checker)]) {
    for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
    for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  }
  return dispatcher;
};

/**
 * The real controllers, in the order `workflow.module.ts` declares them.
 *
 * Repeated here rather than imported because the order **is** the thing under test: a suite that
 * asserted route resolution against a list it derived from the module would prove only that the list
 * equals itself.
 */
export const CONTROLLERS = [
  WorkflowDefinitionController,
  WorkflowVersionController,
  WorkflowInstanceController,
  WorkflowApprovalController,
];

const nestFor = async (
  dispatcher: Dispatcher,
  tenantId: string,
  membershipId: string,
): Promise<INestApplication> => {
  const testing = await Test.createTestingModule({
    controllers: CONTROLLERS,
    providers: [
      { provide: WorkflowDispatcher, useValue: new WorkflowDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();
  const nest = testing.createNestApplication();
  const correlation = new CorrelationMiddleware();

  nest.use((request: never, response: never, next: () => void) =>
    correlation.use(request, response, next),
  );

  /**
   * The identity the tenant middleware establishes in production.
   *
   * `x-test-actor` is the workforce user and `x-test-member` the membership, so one scenario can act
   * as two people and, crucially, as somebody with **no** membership at all — the case a queue must
   * answer emptily rather than with everybody's. An actor of `none` establishes nothing, which is
   * what an unauthenticated caller sees and what the guard must answer 401 to rather than 500.
   */
  nest.use(
    (
      incoming: { readonly headers: Record<string, string | undefined> },
      _response: unknown,
      next: () => void,
    ) => {
      const acting = incoming.headers['x-test-actor'] ?? ADMIN_ACTOR;
      const member = incoming.headers['x-test-member'] ?? membershipId;

      if (acting === 'none') {
        next();
        return;
      }
      runInContext(
        {
          tenantId,
          correlationId: uuidV7(),
          actor: acting,
          ...(member === 'none' ? {} : { membershipId: member }),
        },
        next,
      );
    },
  );
  configureApplication(nest, environment);
  await nest.init();
  return nest;
};

export const openWorkflowApi = async (): Promise<WorkflowApiFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, max: 4 });
  const application = new Pool({
    connectionString: await unprivileged(admin),
    max: 8,
    connectionTimeoutMillis: 15_000,
  });
  const opened: INestApplication[] = [];
  const reset = async (): Promise<void> => {
    await application.query(`truncate ${TABLES.join(', ')}`);
    await admin.query(`truncate ${OWNER_TABLES.join(', ')} cascade`);
    await seedIdentityWorld(admin);
  };

  return {
    pool: application,

    applicationFor: async (tenantId, checker, membershipId = 'none') =>
      nestFor(dispatcherFor(application, checker), tenantId, membershipId).then((nest) => {
        opened.push(nest);
        return nest;
      }),

    inspect: async (text, values) => {
      const read = await admin.query(text, values === undefined ? undefined : [...values]);

      return read.rows as Record<string, unknown>[] as never;
    },

    rowsIn: async (tenantId, text, values) => {
      const client = await application.connect();

      try {
        await client.query('begin');
        await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);

        const read = await client.query(text, values === undefined ? undefined : [...values]);

        return read.rows as Record<string, unknown>[] as never;
      } finally {
        await client.query('rollback');
        client.release();
      }
    },

    truncate: reset,

    close: async () => {
      await Promise.all(opened.map((nest) => nest.close()));
      await reset();
      await application.end();
      await admin.end();
    },
  };
};

export const http = (application: INestApplication): request.Agent =>
  request(application.getHttpServer() as Server);
