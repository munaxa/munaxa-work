import 'reflect-metadata';

import { Pool } from 'pg';
import {
  Dispatcher,
  GrantAwarePermissionChecker,
  InProcessEventDispatcher,
  RecordingNotificationPort,
  currentContext,
  runInContext,
  uuidV7,
  type Command,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type Result,
} from '@work/kernel';
import {
  ALL_PERFORMANCE_PERMISSIONS,
  performanceModule,
  postgresPerformanceStores,
} from '@work/performance';
import { PostgresUnitOfWork } from '@work/persistence';

import {
  PerformanceDocuments,
  PerformanceEmployment,
  PerformanceNotifications,
  PerformanceOrganization,
} from './performance-sources.js';
import { upstream, upstreamHandlers, type UpstreamFacts } from './phase-thirteen-upstream.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The wiring the Phase 13 cross-module suite runs against: Performance on **one real dispatcher**,
 * against **real PostgreSQL repositories**, connected to the rest of the product by the real
 * adapters the composition root builds.
 *
 * `PerformanceEmployment`, `PerformanceOrganization`, `PerformanceDocuments` and
 * `PerformanceNotifications` are the **production classes**, and every cross-module call goes
 * through the real bounded service grant. The permission checker is wrapped exactly as the
 * composition root wraps it — without `GrantAwarePermissionChecker` every grant is inert and every
 * cross-module read is refused, which is what a plain checker proved the first time Phase 12's
 * equivalent suite ran.
 *
 * Employment, Organization and Documents are represented by **stub query handlers on the same
 * dispatcher**, so a change to any of those contracts' shapes breaks this suite.
 *
 * **Nothing publishes an event and nothing subscribes to one.** Not a simplification: this module
 * pulls every cross-module fact at the moment it needs it, so there is no delivery to lose. The
 * suite asserts it.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT = '01930000-0000-7000-8000-00000000cc33';
export const HR = 'user:performance-hr';
export const MANAGER = 'user:performance-manager';

export {
  DOCUMENT_ID,
  EMPLOYEE_ID,
  LEGAL_ENTITY_ID,
  MANAGER_ID,
  NOW,
  OUTSIDER_ID,
  PEER_ID,
  UNIT_ID,
  upstream,
} from './phase-thirteen-upstream.js';
export type { UpstreamFacts } from './phase-thirteen-upstream.js';

/** The tables the suite truncates between tests, most dependent first. */
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
  // The OKR sub-structure has no application port yet, but the tables exist and reference the
  // goal — a truncate that omitted them would fail on the foreign key rather than on anything
  // this suite is about.
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

const permitting = (granted: readonly string[]): PermissionChecker =>
  new GrantAwarePermissionChecker({
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  });

export interface CrossModuleHarness {
  readonly dispatcher: Dispatcher;
  /**
   * What the upstream modules currently say. A suite changes these between reads to prove that a
   * completed review does not, and `truncate` puts them back — a suite that inherited the previous
   * test's reporting line would be asserting against a world nobody set up.
   */
  readonly facts: UpstreamFacts;
  readonly notifications: RecordingNotificationPort;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
}

export const harnessFor = (options: HarnessOptions = {}): CrossModuleHarness => {
  const permissions = permitting(options.permissions ?? ALL_PERFORMANCE_PERMISSIONS);
  const dispatcher = new Dispatcher(permissions);
  const facts = upstream();
  const pool = new Pool({ connectionString: CONNECTION, max: 4, connectionTimeoutMillis: 15_000 });
  const unitOfWork = new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
  const asking: Asking = { ask: (query) => dispatcher.ask(query) };
  const notifications = new RecordingNotificationPort();

  for (const handler of upstreamHandlers(facts)) dispatcher.registerQuery(handler);

  const module = performanceModule({
    unitOfWork,
    // **Real repositories.** Not the in-memory stores: this suite exists to prove the production
    // path, and a fake store here would leave the SQL, the constraints and the triggers untested.
    stores: postgresPerformanceStores(),
    employment: new PerformanceEmployment(asking),
    organization: new PerformanceOrganization(asking),
    documents: new PerformanceDocuments(asking),
    notifications: new PerformanceNotifications(
      (request) => notifications.notify(request),
      () => currentContext()?.correlationId ?? 'unknown',
    ),
    permissions,
    clock: { now: () => new Date('2027-01-10T09:00:00Z') },
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    facts,
    notifications,
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
    truncate: async () => {
      const fresh = upstream();

      facts.employments = fresh.employments;
      facts.documentPresent = fresh.documentPresent;
      notifications.sent.length = 0;
      await pool.query(`truncate ${TABLES.join(', ')}`);
    },
    close: async () => {
      await pool.query(`truncate ${TABLES.join(', ')}`);
      await pool.end();
    },
  };
};

/**
 * Every helper establishes a tenant context if one is not already open.
 *
 * The HTTP middleware does this in production, and a suite that dispatched without it would be
 * refused before reaching a handler — correctly, because a command with no tenant is a command
 * nobody can attribute. `harness.as` still wraps a block where the *actor* matters; these carry the
 * default one so a test reads as the sequence of commands somebody sends rather than as nested
 * context calls.
 */
const inContext = <TResult>(work: () => Promise<TResult>): Promise<TResult> =>
  currentContext() === undefined
    ? runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: HR }, work)
    : work();

/**
 * A message a suite sends, typed so the compiler still insists on the one field that names it.
 *
 * `Record<string, unknown>` alone would need a cast at the dispatcher, and `as unknown as Command`
 * would accept a literal that had misspelled `commandName` — the whole suite would then compile and
 * fail at run time with "no handler". The intersection keeps the payload open and the name checked.
 */
type SentCommand = Command & Record<string, unknown>;
type SentQuery = Query & Record<string, unknown>;

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(
  harness: CrossModuleHarness,
  command: SentCommand,
): Promise<TResult> => {
  const result = await inContext(() => harness.dispatcher.send<TResult>(command));

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const attempt = (
  harness: CrossModuleHarness,
  command: SentCommand,
): Promise<Result<unknown, HandlerFailure>> => inContext(() => harness.dispatcher.send(command));

export const ask = async <TResult>(
  harness: CrossModuleHarness,
  query: SentQuery,
): Promise<TResult> => {
  const result = await inContext(() => harness.dispatcher.ask<TResult>(query));

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const tryAsk = (
  harness: CrossModuleHarness,
  query: SentQuery,
): Promise<Result<unknown, HandlerFailure>> => inContext(() => harness.dispatcher.ask(query));
