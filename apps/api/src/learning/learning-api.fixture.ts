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
  LearningAssessmentController,
  LearningAssignmentController,
  LearningCertificationController,
  LearningCourseCategoryController,
  LearningCourseController,
  LearningCourseVersionController,
  LearningDispatcher,
  LearningEnrolmentController,
  LearningEnrolmentLifecycleController,
  LearningHistoryController,
  LearningInstructorController,
  LearningMandatoryRuleController,
  LearningPathController,
  learningModule,
  postgresLearningStores,
} from '@work/learning';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';
import {
  LearningDocuments,
  LearningEmployment,
  LearningNotifications,
  LearningOrganization,
} from './learning-sources.js';
import { NOW, upstream, upstreamHandlers, type UpstreamFacts } from './phase-fourteen-upstream.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The Learning API over **real PostgreSQL**, as an unprivileged role, with row-level security on.
 *
 * Every layer below the HTTP request is the production one: the real controllers, the real global
 * filter and validation pipe, the real dispatcher, the real application handlers, the real
 * PostgreSQL repositories, and the real cross-module adapters under real bounded service grants. The
 * only substitutions are the three upstream modules, answered by **stub query handlers on the same
 * dispatcher** so a change to any of their published contracts breaks this suite.
 *
 * There is no in-memory variant, and building one to make these tests easier would defeat them.
 * This module's most consequential properties — that tenant A cannot reach tenant B, that a
 * concurrent edit is refused rather than silently applied, and that `18.50` survives the round trip
 * — are properties of the database and the wire, and a suite over a `Map` would report all three
 * without having checked any.
 *
 * The role matters as much as the database. It owns nothing and holds no `BYPASSRLS`: a superuser
 * bypasses every policy, so a suite run as one would report that tenant B cannot read tenant A's
 * training records without having looked.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** A suite that quietly skips itself where merges are gated reports a property nobody checked. */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT_A = '01930000-0000-7000-8000-0000000ae111';
export const TENANT_B = '01930000-0000-7000-8000-0000000ae222';

export const HR = 'user:learning-hr';
export const MANAGER = 'user:learning-manager';

const ROLE = 'learning_api_fixture';

/** Most dependent first: a truncate in the wrong order fails on a foreign key. */
const TABLES = [
  'learning_certification',
  'learning_assessment_result',
  'learning_enrolment',
  'learning_assignment',
  'learning_mandatory_rule',
  'learning_path_step',
  'learning_path',
  'learning_assessment',
  'learning_course_version',
  'learning_course',
  'learning_course_category',
  'learning_instructor',
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

export interface LearningApiFixture {
  /** An application bound to one tenant, one actor and one permission set. */
  applicationFor(
    tenantId: string,
    checker: PermissionChecker,
    actor?: string,
  ): Promise<INestApplication>;
  /** What the upstream modules currently say. A suite changes these to end somebody's employment. */
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

  const module = learningModule({
    unitOfWork: new PostgresUnitOfWork(application, new InProcessEventDispatcher()),
    stores: postgresLearningStores(),
    employment: new LearningEmployment(asking),
    organization: new LearningOrganization(asking),
    documents: new LearningDocuments(asking),
    notifications: new LearningNotifications(
      (intent) => notifications.notify(intent),
      () => currentContext()?.correlationId ?? 'unknown',
    ),
    permissions: checker,
    clock: { now: () => NOW },
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  return dispatcher;
};

/**
 * The real controllers, in the order `learning.module.ts` declares them.
 *
 * Repeated here rather than imported because the order **is** the thing under test: a suite that
 * asserted route resolution against a list it derived from the module would prove only that the
 * list equals itself.
 */
const nestFor = async (
  dispatcher: Dispatcher,
  tenantId: string,
  actor: string,
): Promise<INestApplication> => {
  const testing = await Test.createTestingModule({
    controllers: [
      LearningCourseCategoryController,
      LearningCourseController,
      LearningCourseVersionController,
      LearningAssessmentController,
      LearningPathController,
      LearningMandatoryRuleController,
      LearningAssignmentController,
      LearningEnrolmentController,
      LearningEnrolmentLifecycleController,
      LearningCertificationController,
      LearningInstructorController,
      LearningHistoryController,
    ],
    providers: [
      { provide: LearningDispatcher, useValue: new LearningDispatcher(dispatcher) },
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

export const openLearningApi = async (): Promise<LearningApiFixture> => {
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

      // The upstream world is reset too. A test that ended somebody's employment and did not put
      // them back would leave every later test asserting against a product nobody set up.
      facts.employments = fresh.employments;
      facts.units = fresh.units;
      facts.documentPresent = fresh.documentPresent;
      facts.employmentReachable = fresh.employmentReachable;
      facts.organizationReachable = fresh.organizationReachable;
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

export interface CourseDetailBody {
  readonly course: { readonly courseId: string; readonly status: string; readonly version: number };
  readonly versions: readonly {
    readonly courseVersionId: string;
    readonly versionNumber: number;
  }[];
  readonly assessments: readonly { readonly assessmentId: string; readonly kind: string }[];
}

export interface AssignmentBody {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly status: string;
  readonly version: number;
  readonly source: string;
  readonly dueOn?: string;
  readonly overdue: boolean;
  readonly occurrenceKey?: string;
}

export interface CertificationBody {
  readonly certificationId: string;
  readonly status: string;
  readonly version: number;
  readonly validity: string;
  readonly validUntil?: string;
}

export interface AssessmentResultBody {
  readonly resultId: string;
  readonly outcome: string;
  readonly rawMark?: string;
  readonly rawMarkScale?: string;
}
