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
import { ALL_LEARNING_PERMISSIONS, learningModule, postgresLearningStores } from '@work/learning';
import { PostgresUnitOfWork } from '@work/persistence';

import {
  LearningDocuments,
  LearningEmployment,
  LearningNotifications,
  LearningOrganization,
} from './learning-sources.js';
import { NOW, upstream, upstreamHandlers, type UpstreamFacts } from './phase-fourteen-upstream.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The wiring the Phase 14A cross-module suite runs against: Learning on **one real dispatcher**,
 * against **real PostgreSQL repositories**, connected to the rest of the product by the real
 * adapters the composition root builds.
 *
 * `LearningEmployment`, `LearningOrganization`, `LearningDocuments` and `LearningNotifications` are
 * the **production classes**, and every cross-module call goes through the real bounded service
 * grant. The permission checker is wrapped exactly as the composition root wraps it — without
 * `GrantAwarePermissionChecker` every grant is inert and every cross-module read is refused, which
 * is what a plain checker proved the first time Phase 12's equivalent suite ran.
 *
 * Employment, Organization and Documents are represented by **stub query handlers on the same
 * dispatcher**, so a change to any of those contracts' shapes breaks this suite.
 *
 * **Nothing publishes an event and nothing subscribes to one.** Not a simplification: this module
 * pulls every cross-module fact at the moment it needs it, so there is no delivery to lose.
 *
 * **Nothing is scheduled.** Every reconciliation in this suite is a command somebody sends.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT = '01930000-0000-7000-8000-00000000dd44';
export const OTHER_TENANT = '01930000-0000-7000-8000-00000000ee55';
export const HR = 'user:learning-hr';
export const MANAGER = 'user:learning-manager';

export {
  DOCUMENT_ID,
  EMPLOYEE_ID,
  ENDED_ID,
  MANAGER_ID,
  NOW,
  OTHER_UNIT_ID,
  PEER_ID,
  POSITION_ID,
  TODAY,
  UNIT_ID,
  upstream,
} from './phase-fourteen-upstream.js';
export type { UpstreamFacts } from './phase-fourteen-upstream.js';

/** The tables the suite truncates between tests, most dependent first. */
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

/**
 * The checker the composition root builds, not a simpler one.
 *
 * `GrantAwarePermissionChecker` consults the caller's own permissions first and adds only the
 * narrow, named authority a module holds while acting inside another under a bounded service grant
 * — and adds nothing at all when no grant is open. A plain checker here would refuse every
 * cross-module read, and the suite would be testing a configuration production does not have.
 */
const permitting = (granted: readonly string[]): PermissionChecker =>
  new GrantAwarePermissionChecker({
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  });

export interface CrossModuleHarness {
  readonly dispatcher: Dispatcher;
  /**
   * What the upstream modules currently say. A suite changes these between reads to prove that a
   * completed course does not, and `truncate` puts them back — a suite that inherited the previous
   * test's reporting line would be asserting against a world nobody set up.
   */
  readonly facts: UpstreamFacts;
  readonly notifications: RecordingNotificationPort;
  readonly pool: Pool;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
  inTenant<TResult>(
    tenantId: string,
    actor: string,
    work: () => Promise<TResult>,
  ): Promise<TResult>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
  /** A second harness shares the upstream facts so both see the same organization. */
  readonly facts?: UpstreamFacts;
}

export const harnessFor = (options: HarnessOptions = {}): CrossModuleHarness => {
  const permissions = permitting(options.permissions ?? ALL_LEARNING_PERMISSIONS);
  const dispatcher = new Dispatcher(permissions);
  const facts = options.facts ?? upstream();
  const pool = new Pool({ connectionString: CONNECTION, max: 4, connectionTimeoutMillis: 15_000 });
  const unitOfWork = new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
  const asking: Asking = { ask: (query) => dispatcher.ask(query) };
  const notifications = new RecordingNotificationPort();

  for (const handler of upstreamHandlers(facts)) dispatcher.registerQuery(handler);

  const module = learningModule({
    unitOfWork,
    // **Real repositories.** Not the in-memory stores: this suite exists to prove the production
    // path, and a fake store here would leave the SQL, the constraints and the triggers untested.
    stores: postgresLearningStores(),
    employment: new LearningEmployment(asking),
    organization: new LearningOrganization(asking),
    documents: new LearningDocuments(asking),
    notifications: new LearningNotifications(
      (request) => notifications.notify(request),
      () => currentContext()?.correlationId ?? 'unknown',
    ),
    permissions,
    clock: { now: () => NOW },
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    facts,
    notifications,
    pool,
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
    inTenant: (tenantId, actor, work) =>
      runInContext({ tenantId, correlationId: uuidV7(), actor }, work),
    truncate: async () => {
      const fresh = upstream();

      facts.employments = fresh.employments;
      facts.units = fresh.units;
      facts.documentPresent = fresh.documentPresent;
      facts.employmentReachable = fresh.employmentReachable;
      facts.organizationReachable = fresh.organizationReachable;
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
 * nobody can attribute.
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
export const send = <TResult>(
  harness: CrossModuleHarness,
  command: SentCommand,
): Promise<TResult> =>
  inContext(async () => {
    const result = await harness.dispatcher.send<TResult>(command);

    if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
    return result.value;
  });

export const attempt = (
  harness: CrossModuleHarness,
  command: SentCommand,
): Promise<Result<unknown, HandlerFailure>> => inContext(() => harness.dispatcher.send(command));

export const ask = <TResult>(harness: CrossModuleHarness, query: SentQuery): Promise<TResult> =>
  inContext(async () => {
    const result = await harness.dispatcher.ask<TResult>(query);

    if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
    return result.value;
  });

export const tryAsk = (
  harness: CrossModuleHarness,
  query: SentQuery,
): Promise<Result<unknown, HandlerFailure>> => inContext(() => harness.dispatcher.ask(query));

/** The reason a refusal gives, for assertions that care which rule refused. */
export const reasonOf = (result: Result<unknown, HandlerFailure>): string => {
  if (result.ok) return 'accepted';
  if (result.error.kind === 'rejected') return result.error.reason;
  if (result.error.kind === 'conflict') return result.error.reason;
  if (result.error.kind === 'not_found') return `not_found:${result.error.resource}`;
  if (result.error.kind === 'forbidden') return `forbidden:${result.error.permission}`;
  return 'validation';
};
