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
} from '@work/kernel';
import { ALL_CAREER_PERMISSIONS, careerModule, postgresCareerStores } from '@work/career';
import { PostgresUnitOfWork } from '@work/persistence';

import { CareerEmployment, CareerLearning, CareerOrganization } from './career-sources.js';
import {
  NOW,
  TENANT,
  tenantOfContext,
  upstream,
  upstreamHandlers,
  type UpstreamFacts,
} from './phase-fifteen-upstream.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The wiring the Phase 15 cross-module suite runs against: Career on **one real dispatcher**,
 * against **real PostgreSQL repositories**, connected to the rest of the product by the real
 * adapters the composition root builds.
 *
 * `CareerEmployment`, `CareerOrganization` and `CareerLearning` are the **production classes** — the
 * same ones `careerModuleFor` constructs — and every cross-module call goes through the real bounded
 * service grant. The permission checker is wrapped exactly as the composition root wraps it: without
 * `GrantAwarePermissionChecker` every grant is inert and every cross-module read is refused, which
 * is what a plain checker proved the first time Phase 12's equivalent suite ran.
 *
 * Employment, Organization and Learning are represented by **stub query handlers on the same
 * dispatcher**, so a change to any of those contracts' shapes breaks this suite.
 *
 * **Nothing publishes an event and nothing subscribes to one.** Not a simplification: Career pulls
 * every cross-module fact at the moment it needs it, so there is no delivery to lose.
 *
 * **Nothing is scheduled and nothing is notified.** There is no `JobPort` and no notification port
 * to wire, and a suite cannot assert a capability that has no adapter.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const HR = 'user:career-hr';
export const ASSESSOR = 'user:career-assessor';

export {
  ASSIGNMENT_ID,
  EMPLOYEE_ID,
  ENDED_ID,
  NOW,
  OTHER_POSITION_ID,
  OTHER_TENANT,
  PEER_ASSIGNMENT_ID,
  PEER_ID,
  POSITION_ID,
  TENANT,
  TODAY,
  UNIT_ID,
  upstream,
} from './phase-fifteen-upstream.js';
export type { UpstreamFacts } from './phase-fifteen-upstream.js';

/** The tables the suite truncates between tests, most dependent first. */
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

/**
 * A role that owns nothing, holds no `BYPASSRLS`, and is not a superuser.
 *
 * The database this suite runs against belongs to `work`, which **is** a superuser — and a superuser
 * bypasses every row-level security policy there is. Connecting as one would mean the tenant
 * assertions below were proving only that Career's own SQL filters on a tenant, and reporting that
 * row-level security holds without ever having given it the chance to refuse. This role is the same
 * arrangement Career's schema suites use, for the same reason.
 *
 * `truncate` is granted because the harness resets between tests on this connection; it is a table
 * privilege, not a policy exemption, so it buys no visibility into another tenant's rows.
 */
const APPLICATION_ROLE = 'career_cross_module';

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

    const url = new URL(CONNECTION);

    url.username = APPLICATION_ROLE;
    url.password = 'fixture';
    return url.toString();
  } finally {
    await admin.end();
  }
};

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
   * What the upstream modules currently say. A suite changes these between reads to prove that an
   * employment ending does not rewrite a nomination already recorded, and `truncate` puts them back
   * — a suite that inherited the previous test's world would be asserting against a state nobody
   * set up.
   */
  readonly facts: UpstreamFacts;
  readonly pool: Pool;
  /**
   * Raw SQL, inside a tenant's row-security context, for the assertions about what is actually
   * *stored* rather than what a query returns.
   *
   * The context is not optional bookkeeping: the harness connects as a role that cannot bypass
   * row-level security, so a `select` issued without `app.tenant_id` set correctly returns nothing
   * at all — which is the policy working, and which a probe that read `rows[0]` would report as a
   * missing row.
   */
  rowsIn<TRow extends Record<string, unknown>>(
    tenantId: string,
    text: string,
    values?: readonly unknown[],
  ): Promise<TRow[]>;
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
  /** A second harness shares the upstream facts so both tenants see the same organization. */
  readonly facts?: UpstreamFacts;
  /** The unprivileged connection from `applicationConnection`, so policies can actually refuse. */
  readonly connectionString?: string;
}

/**
 * Raw SQL on the harness's pool, inside one tenant's row-security context.
 *
 * Curried over the pool so the generic survives: the harness's `rowsIn` is a generic method, and a
 * plain helper returning `Record<string, unknown>[]` could not be assigned to it.
 */
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
      // **Always**, including after a failed statement. A client returned to the pool inside an
      // aborted transaction refuses everything the next caller sends, so a probe with a typo in it
      // would otherwise fail the *following* test — and that is the test a reader would go and debug.
      await client.query('rollback');
      client.release();
    }
  };

export const harnessFor = (options: HarnessOptions = {}): CrossModuleHarness => {
  const granted = options.permissions ?? ALL_CAREER_PERMISSIONS;
  const permissions = permitting(granted);
  const dispatcher = new Dispatcher(permissions);
  const facts = options.facts ?? upstream();
  const pool = new Pool({
    connectionString: options.connectionString ?? CONNECTION,
    max: 4,
    connectionTimeoutMillis: 15_000,
  });
  const unitOfWork = new PostgresUnitOfWork(pool, new InProcessEventDispatcher());
  const asking: Asking = { ask: (query) => dispatcher.ask(query) };

  for (const handler of upstreamHandlers(facts, {
    // The stubs filter on the ambient tenant, as row-level security does for the real modules.
    tenantOf: () => tenantOfContext(),
    // And reproduce Learning's scope resolver, which is why Career's grant names `read-all`.
    readsAllLearners: () => true,
  })) {
    dispatcher.registerQuery(handler);
  }

  const module = careerModule({
    unitOfWork,
    // **Real repositories.** Not the in-memory stores: this suite exists to prove the production
    // path, and a fake store here would leave the SQL, the constraints and the triggers untested.
    stores: postgresCareerStores(),
    employment: new CareerEmployment(asking),
    organization: new CareerOrganization(asking),
    learning: new CareerLearning(asking),
    permissions,
    clock: { now: () => NOW },
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    facts,
    pool,
    rowsIn: readerFor(pool),
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
    inTenant: (tenantId, actor, work) =>
      runInContext({ tenantId, correlationId: uuidV7(), actor }, work),
    truncate: async () => {
      const fresh = upstream();

      facts.employments = fresh.employments;
      facts.positions = fresh.positions;
      facts.units = fresh.units;
      facts.assignments = fresh.assignments;
      facts.employmentReachable = fresh.employmentReachable;
      facts.organizationReachable = fresh.organizationReachable;
      facts.learningReachable = fresh.learningReachable;
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

/** The reason a refusal gives, for assertions that care which rule refused. */
export const reasonOf = (result: Result<unknown, HandlerFailure>): string => {
  if (result.ok) return 'accepted';
  if (result.error.kind === 'rejected') return result.error.reason;
  if (result.error.kind === 'conflict') return result.error.reason;
  if (result.error.kind === 'not_found') return `not_found:${result.error.resource}`;
  if (result.error.kind === 'forbidden') return `forbidden:${result.error.permission}`;
  return 'validation';
};

/**
 * Career's own rows for one person, counted through the paged searches rather than the summary.
 *
 * The summary reports the *active* plan and the *active* development plan, so a draft written by a
 * refused command would not appear in it — and an assertion built on the summary would report
 * "nothing was written" for a row that was. These searches return every status, which is what "the
 * refusal left nothing behind" actually has to mean.
 */
export const careerRowsFor = async (
  harness: CrossModuleHarness,
  employmentId: string,
): Promise<number> => {
  const totalOf = async (queryName: string): Promise<number> => {
    const found = await ask<{ readonly total: number }>(harness, { queryName, employmentId });

    return found.total;
  };

  return (
    (await totalOf('career.search-plans')) +
    (await totalOf('career.search-pool-memberships')) +
    (await totalOf('career.search-recommendations'))
  );
};

/** English and Arabic, for every name a command takes. */
export const named = (en: string, ar: string): { readonly en: string; readonly ar: string } => ({
  en,
  ar,
});
