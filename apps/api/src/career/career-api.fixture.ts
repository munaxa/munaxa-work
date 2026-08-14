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
  CareerDevelopmentController,
  CareerDevelopmentItemController,
  CareerDispatcher,
  CareerMembershipController,
  CareerMobilityController,
  CareerPathController,
  CareerPlanController,
  CareerPoolController,
  CareerReadinessController,
  CareerSuccessionController,
  CareerSuccessionLifecycleController,
  CareerSuccessorController,
  CareerSummaryController,
  careerModule,
  postgresCareerStores,
} from '@work/career';

import { configureApplication } from '../application.setup.js';
import { CorrelationMiddleware } from '../observability/correlation.middleware.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';
import { CareerEmployment, CareerLearning, CareerOrganization } from './career-sources.js';
import {
  NOW,
  tenantOfContext,
  upstream,
  upstreamHandlers,
  type UpstreamFacts,
} from './phase-fifteen-upstream.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The Career API over **real PostgreSQL**, as an unprivileged role, with row-level security on.
 *
 * Every layer below the HTTP request is the production one: the real controllers, the real global
 * filter and validation pipe, the real dispatcher, the real application handlers, the real
 * PostgreSQL repositories, and the real cross-module adapters under real bounded service grants. The
 * only substitutions are the three upstream modules, answered by **stub query handlers on the same
 * dispatcher** so a change to any of their published contracts breaks this suite.
 *
 * There is no in-memory variant, and building one to make these tests easier would defeat them.
 * This module's most consequential properties — that tenant A cannot reach tenant B's succession
 * bench, that a concurrent edit is refused rather than silently applied, and that an impossible date
 * is refused rather than rolled into the next month — are properties of the database and the wire,
 * and a suite over a `Map` would report all three without having checked any.
 *
 * The role matters as much as the database. It owns nothing, is not a superuser and holds no
 * `BYPASSRLS`: a superuser bypasses every policy, so a suite run as one would report that tenant B
 * cannot read tenant A's readiness assessments without ever having looked. A test in the security
 * suite asserts those two flags before anything is built on them.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** A suite that quietly skips itself where merges are gated reports a property nobody checked. */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

/**
 * Two tenants that hold **the same upstream identifiers**.
 *
 * Both have an employment called `EMPLOYEE_ID`, a position called `POSITION_ID` and an assignment
 * called `ASSIGNMENT_ID`. A suite whose tenants held different values would pass whether or not the
 * boundary worked, because every read would be scoped by the value rather than by the tenant.
 */
export {
  ASSIGNMENT_ID,
  EMPLOYEE_ID,
  ENDED_ID,
  OTHER_POSITION_ID,
  PEER_ASSIGNMENT_ID,
  PEER_ID,
  POSITION_ID,
  TODAY,
  UNIT_ID,
  OTHER_TENANT as TENANT_B,
  TENANT as TENANT_A,
} from './phase-fifteen-upstream.js';

export const HR = 'user:career-hr';
export const ASSESSOR = 'user:career-assessor';

const ROLE = 'career_api_fixture';

/** Most dependent first: a truncate in the wrong order fails on a foreign key. */
const TABLES = [
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

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

/**
 * Wrapped exactly as the composition root wraps it.
 *
 * `GrantAwarePermissionChecker` is what makes a bounded service grant mean anything: without it an
 * adapter's grant is inert and every cross-module read is refused.
 */
export const permitting = (...granted: readonly string[]): PermissionChecker =>
  new GrantAwarePermissionChecker({
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  });

const unprivileged = async (admin: Pool): Promise<string> => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );
  await admin.query(`grant select, insert, update, delete on ${TABLES.join(', ')} to ${ROLE}`);

  const url = new URL(CONNECTION ?? '');

  url.username = ROLE;
  url.password = 'fixture';
  return url.toString();
};

export interface CareerApiFixture {
  /** An application bound to one tenant, one actor and one permission set. */
  applicationFor(
    tenantId: string,
    checker: PermissionChecker,
    actor?: string,
  ): Promise<INestApplication>;
  /** What the upstream modules currently say. A suite changes these to end somebody's employment. */
  readonly facts: UpstreamFacts;
  /** Raw SQL as the **admin** role, for the assertions about the database's own configuration. */
  inspect<TRow extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<TRow[]>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

const moduleFor = (
  application: Pool,
  checker: PermissionChecker,
  facts: UpstreamFacts,
): Dispatcher => {
  const dispatcher = new Dispatcher(checker);
  const asking: Asking = { ask: (query) => dispatcher.ask(query) };

  for (const handler of upstreamHandlers(facts, {
    // The stubs filter on the ambient tenant, which the request middleware establishes — as
    // row-level security does for the real modules.
    tenantOf: () => tenantOfContext(),
    readsAllLearners: () => true,
  })) {
    dispatcher.registerQuery(handler);
  }

  const module = careerModule({
    unitOfWork: new PostgresUnitOfWork(application, new InProcessEventDispatcher()),
    stores: postgresCareerStores(),
    employment: new CareerEmployment(asking),
    organization: new CareerOrganization(asking),
    learning: new CareerLearning(asking),
    permissions: checker,
    clock: { now: () => NOW },
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  return dispatcher;
};

/**
 * The real controllers, in the order `career.module.ts` declares them.
 *
 * Repeated here rather than imported because the order **is** the thing under test: a suite that
 * asserted route resolution against a list it derived from the module would prove only that the list
 * equals itself.
 */
export const CONTROLLERS = [
  CareerPathController,
  CareerPlanController,
  CareerPoolController,
  CareerMembershipController,
  CareerSuccessionController,
  CareerSuccessionLifecycleController,
  CareerSuccessorController,
  CareerReadinessController,
  CareerDevelopmentController,
  CareerDevelopmentItemController,
  CareerMobilityController,
  CareerSummaryController,
];

const nestFor = async (
  dispatcher: Dispatcher,
  tenantId: string,
  actor: string,
): Promise<INestApplication> => {
  const testing = await Test.createTestingModule({
    controllers: CONTROLLERS,
    providers: [
      { provide: CareerDispatcher, useValue: new CareerDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();
  const nest = testing.createNestApplication();
  const correlation = new CorrelationMiddleware();

  // The real correlation middleware, which `app.module.ts` applies to every route. Without it the
  // problem details a failing request produces would carry no correlation identifier — and a suite
  // that skipped the assertion because the fixture lacked the middleware would be reporting the
  // fixture's shape rather than the product's.
  nest.use((request: never, response: never, next: () => void) =>
    correlation.use(request, response, next),
  );

  // Stands in for the authenticated identity Platform will supply. `x-test-actor` lets one scenario
  // act as two people. An actor of `none` establishes nothing at all, which is what an
  // unauthenticated caller sees — and what the guard must answer 401 to rather than 500.
  nest.use(
    (
      incoming: { readonly headers: Record<string, string | undefined> },
      _response: unknown,
      next: () => void,
    ) => {
      const acting = incoming.headers['x-test-actor'] ?? actor;

      if (acting === 'none') {
        next();
        return;
      }
      runInContext({ tenantId, correlationId: uuidV7(), actor: acting }, next);
    },
  );
  configureApplication(nest, environment);
  await nest.init();
  return nest;
};

export const openCareerApi = async (): Promise<CareerApiFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, max: 4 });
  const application = new Pool({
    connectionString: await unprivileged(admin),
    max: 8,
    connectionTimeoutMillis: 15_000,
  });
  const facts = upstream();
  const opened: INestApplication[] = [];

  return {
    facts,

    applicationFor: async (tenantId, checker, actor = HR) => {
      const nest = await nestFor(moduleFor(application, checker, facts), tenantId, actor);

      opened.push(nest);
      return nest;
    },

    inspect: async (text, values) => {
      const read = await admin.query(text, values === undefined ? undefined : [...values]);

      return read.rows as Record<string, unknown>[] as never;
    },

    truncate: async () => {
      const fresh = upstream();

      // The upstream world is reset too. A test that ended somebody's employment and did not put
      // them back would leave every later test asserting against a product nobody set up.
      facts.employments = fresh.employments;
      facts.positions = fresh.positions;
      facts.units = fresh.units;
      facts.assignments = fresh.assignments;
      facts.employmentReachable = fresh.employmentReachable;
      facts.organizationReachable = fresh.organizationReachable;
      facts.learningReachable = fresh.learningReachable;
      await admin.query(`truncate ${TABLES.join(', ')}`);
    },

    close: async () => {
      await Promise.all(opened.map((nest) => nest.close()));
      await admin.query(`truncate ${TABLES.join(', ')}`);
      await application.end();
      await admin.end();
    },
  };
};

export const http = (application: INestApplication): request.Agent =>
  request(application.getHttpServer() as Server);

/** The published shapes the suites read. Re-exported so a suite imports one module, not two. */
export type {
  CreatedBody,
  DevelopmentPlanBody,
  PageBody,
  PathDetailBody,
  ProblemBody,
  ReadinessHistoryBody,
  SuccessionDetailBody,
} from './career-api-bodies.js';
