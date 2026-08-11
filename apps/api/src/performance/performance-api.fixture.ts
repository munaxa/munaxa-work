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
  RecordingNotificationPort,
  currentContext,
  runInContext,
  uuidV7,
  type PermissionChecker,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import {
  PerformanceAssessmentController,
  PerformanceAssessmentItemController,
  PerformanceCalibrationController,
  PerformanceCycleController,
  PerformanceDispatcher,
  PerformanceEnrolmentController,
  PerformanceFeedbackController,
  PerformanceFrameworkController,
  PerformanceGoalCategoryController,
  PerformanceGoalController,
  PerformanceGoalProgressController,
  PerformanceRatingScaleController,
  PerformanceReconciliationController,
  PerformanceReviewController,
  PerformanceReviewLifecycleController,
  PerformanceReviewerAssignmentController,
  PerformanceTalentController,
  PerformanceTemplateController,
  performanceModule,
  postgresPerformanceStores,
} from '@work/performance';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';
import {
  PerformanceDocuments,
  PerformanceEmployment,
  PerformanceNotifications,
  PerformanceOrganization,
} from './performance-sources.js';
import { upstream, upstreamHandlers, type UpstreamFacts } from './phase-thirteen-upstream.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The Performance API over **real PostgreSQL**, as an unprivileged role, with row-level security on.
 *
 * Every layer below the HTTP request is the production one: the real controllers, the real global
 * filter and validation pipe, the real dispatcher, the real application handlers, the real
 * PostgreSQL repositories, and the real cross-module adapters under real bounded service grants. The
 * only substitutions are the three upstream modules, answered by **stub query handlers on the same
 * dispatcher** so a change to any of their published contracts breaks this suite.
 *
 * There is no in-memory variant. This module's two most consequential properties — that tenant A
 * cannot reach tenant B, and that a completed review cannot be edited — are both properties of the
 * database, and a suite over a `Map` would report them without having checked either.
 *
 * The role matters as much as the database. It owns nothing and holds no `BYPASSRLS`: a superuser
 * bypasses every policy, so a suite run as one would report that tenant B cannot read tenant A's
 * ratings without having looked.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** A suite that quietly skips itself where merges are gated reports a property nobody checked. */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT_A = '01930000-0000-7000-8000-0000000ac111';
export const TENANT_B = '01930000-0000-7000-8000-0000000ac222';

export const HR = 'user:performance-hr';
export const MANAGER = 'user:performance-manager';
export const PEER = 'user:performance-peer';

const ROLE = 'performance_api_fixture';

/** Most dependent first: a truncate in the wrong order fails on a foreign key. */
const TABLES = [
  'performance_review_snapshot',
  'performance_talent_placement',
  'performance_calibration_decision',
  'performance_calibration_session',
  'performance_review_component_score',
  'performance_assessment_item',
  'performance_assessment',
  'performance_reviewer_assignment',
  'performance_feedback',
  'performance_review',
  'performance_goal_progress',
  // No application port and therefore no repository, but the tables exist and reference the goal.
  'performance_key_result',
  'performance_objective',
  'performance_goal',
  'performance_cycle',
  'performance_review_template_component',
  'performance_review_template',
  'performance_goal_category',
  'performance_competency_level',
  'performance_competency',
  'performance_competency_framework',
  'performance_rating_level',
  'performance_rating_scale',
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

export interface PerformanceApiFixture {
  /** An application bound to one tenant, one actor and one permission set. */
  applicationFor(
    tenantId: string,
    checker: PermissionChecker,
    actor?: string,
  ): Promise<INestApplication>;
  /** What the upstream modules currently say. A suite changes these to move somebody's manager. */
  readonly facts: UpstreamFacts;
  readonly notifications: RecordingNotificationPort;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

const moduleFor = (
  application: Pool,
  checker: PermissionChecker,
  facts: UpstreamFacts,
  notifications: RecordingNotificationPort,
): Dispatcher => {
  const dispatcher = new Dispatcher(checker);
  const asking: Asking = { ask: (query) => dispatcher.ask(query) };

  for (const handler of upstreamHandlers(facts)) dispatcher.registerQuery(handler);

  const module = performanceModule({
    unitOfWork: new PostgresUnitOfWork(application, new InProcessEventDispatcher()),
    stores: postgresPerformanceStores(),
    employment: new PerformanceEmployment(asking),
    organization: new PerformanceOrganization(asking),
    documents: new PerformanceDocuments(asking),
    notifications: new PerformanceNotifications(
      (intent) => notifications.notify(intent),
      () => currentContext()?.correlationId ?? 'unknown',
    ),
    permissions: checker,
    clock: { now: () => new Date('2027-01-10T09:00:00Z') },
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  return dispatcher;
};

/**
 * The real controllers, in the order `performance.module.ts` declares them.
 *
 * Repeated here rather than imported because the order **is** the thing under test: a suite that
 * asserted route resolution against a list it derived from the module would prove only that the list
 * equals itself.
 */
const nestFor = async (
  dispatcher: Dispatcher,
  tenantId: string,
  actor: string,
): Promise<INestApplication> => {
  const testing = await Test.createTestingModule({
    controllers: [
      PerformanceRatingScaleController,
      PerformanceFrameworkController,
      PerformanceTemplateController,
      PerformanceGoalCategoryController,
      PerformanceCycleController,
      PerformanceEnrolmentController,
      PerformanceGoalController,
      PerformanceGoalProgressController,
      PerformanceReviewController,
      PerformanceReviewLifecycleController,
      PerformanceAssessmentController,
      PerformanceAssessmentItemController,
      PerformanceReviewerAssignmentController,
      PerformanceCalibrationController,
      PerformanceTalentController,
      PerformanceFeedbackController,
      PerformanceReconciliationController,
    ],
    providers: [
      { provide: PerformanceDispatcher, useValue: new PerformanceDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();
  const nest = testing.createNestApplication();

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

export const openPerformanceApi = async (): Promise<PerformanceApiFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, max: 4 });
  const application = new Pool({
    connectionString: await unprivileged(admin),
    max: 8,
    connectionTimeoutMillis: 15_000,
  });
  const facts = upstream();
  const notifications = new RecordingNotificationPort();
  const opened: INestApplication[] = [];

  return {
    facts,
    notifications,

    applicationFor: async (tenantId, checker, actor = HR) => {
      const nest = await nestFor(
        moduleFor(application, checker, facts, notifications),
        tenantId,
        actor,
      );

      opened.push(nest);
      return nest;
    },

    truncate: async () => {
      const fresh = upstream();

      // The upstream world is reset too. A test that moved somebody's manager and did not put them
      // back would leave every later test asserting against a product nobody set up.
      facts.employments = fresh.employments;
      facts.documentPresent = fresh.documentPresent;
      notifications.sent.length = 0;
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

/**
 * The published shapes these suites read, and the one cast per read that produces them.
 *
 * `supertest` types a response body as `any`, and reaching into it directly would put an implicit
 * `any` on every assertion in the suite.
 */
export interface PageBody<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface ProblemBody {
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly correlationId?: string;
}

export interface ReviewDetailBody {
  readonly review: {
    readonly reviewId: string;
    readonly status: string;
    readonly version: number;
    readonly calculatedScore?: number;
    readonly finalScore?: number;
  };
  readonly assessments: readonly { readonly assessmentKind: string }[];
  readonly calibration?: { readonly originalScore?: number; readonly calibratedScore?: number };
  readonly componentScores: readonly { readonly component: string; readonly score?: number }[];
  readonly snapshot?: { readonly ratingScale: { readonly levels: readonly unknown[] } };
}

export interface GoalBody {
  readonly goalId: string;
  readonly title: string;
  readonly version: number;
  readonly dueDate: string;
  readonly startDate: string;
  readonly progress: readonly { readonly observedValue?: string }[];
}
