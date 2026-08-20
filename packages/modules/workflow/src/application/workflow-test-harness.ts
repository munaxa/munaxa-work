import {
  Dispatcher,
  currentContext,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { inMemoryWorkflowStores } from './in-memory-stores.js';
import {
  FakeBusinessDecisions,
  FakeDelegation,
  FakeMembershipStanding,
  FakeReportingLine,
} from './workflow-module-fakes.js';
import { FakeNotifications, FakeReminderRecipient } from './workflow-reminder-fakes.js';

export {
  FakeBusinessDecisions,
  FakeDelegation,
  FakeMembershipStanding,
  FakeReportingLine,
} from './workflow-module-fakes.js';
export { FakeNotifications, FakeReminderRecipient } from './workflow-reminder-fakes.js';
import { workflowModule } from './workflow-module.js';
import { ALL_WORKFLOW_PERMISSIONS } from './workflow-permissions.js';
import type { Clock } from './workflow-ports.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers, the real permission checker — and controllable doubles for the one cross-module read and
 * for the database.
 *
 * **The membership is part of the context, not a parameter to a query.** `as(actor, membership, …)`
 * builds the execution context the middleware builds, and every suite that asks "what is waiting for
 * me" gets its answer from that and from nothing the command carried. A harness that let a test pass
 * a membership into a query would be testing a shape production does not have.
 *
 * **The delegation double is Identity's contract, not a shortcut around it.** It filters by period
 * and by scope exactly as Identity's aggregate does — half-open, revocation-aware — because a double
 * that returned every delegation regardless of when it was in force would make the expired and
 * out-of-period tests pass for the wrong reason.
 *
 * **There is no notification recorder, no job runner and no role directory here**, because there is
 * no port for any of them. Faking one would let the suites demonstrate a capability production does
 * not have, which is the most expensive kind of green.
 *
 * **The reporting-line double is the exception that proves the rule.** There *is* a port for it, with
 * a shape narrow enough to state in one line, and the double answers exactly what that port declares
 * — one manager or one of four named absences, never a chain, a team or a directory. What it stands
 * in for is the adapter, which is Checkpoint 7's and does not exist yet.
 */

export const TENANT = uuidV7();
export const OTHER_TENANT = uuidV7();
export const NOW = new Date('2026-08-14T09:00:00.000Z');

/** Memberships. A membership is *a person in a tenant*, which is what an approval is addressed to. */
export const APPROVER = uuidV7();
export const SECOND_APPROVER = uuidV7();
export const DEPUTY = uuidV7();
export const REQUESTER = uuidV7();
export const OUTSIDER = uuidV7();
/** Who configures. Configuration is not an approval, so this membership decides nothing. */
export const ADMINISTRATOR = uuidV7();

export const SUBJECT_TYPE = 'recruitment.requisition';

export class FixedClock implements Clock {
  public constructor(private moment: Date) {}

  public now(): Date {
    return this.moment;
  }

  public advanceTo(moment: Date): void {
    this.moment = moment;
  }
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly delegation: FakeDelegation;
  readonly membershipStanding: FakeMembershipStanding;
  readonly reminderRecipient: FakeReminderRecipient;
  readonly notifications: FakeNotifications;
  readonly reportingLine: FakeReportingLine;
  readonly business: FakeBusinessDecisions;
  readonly stores: ReturnType<typeof inMemoryWorkflowStores>;
  /** Runs work as a named membership, in this harness's tenant. */
  as<TResult>(membershipId: string, work: () => Promise<TResult>): Promise<TResult>;
  /** Runs work in a context that resolved **no** membership — a job, a migration, a fixture. */
  withoutMembership<TResult>(work: () => Promise<TResult>): Promise<TResult>;
  /**
   * Runs work as a **machine**: tenant-scoped, non-human, holding no membership.
   *
   * Deliberately not a variant of `as` with a funny membership identifier. The whole property under
   * test is that automatic execution is a *different kind of context*, so a helper that faked it with
   * a person's context would test nothing.
   */
  asMachine<TResult>(
    work: () => Promise<TResult>,
    execution?: { readonly jobId?: string; readonly attempt?: number },
  ): Promise<TResult>;
  inTenant<TResult>(
    tenantId: string,
    membershipId: string,
    work: () => Promise<TResult>,
  ): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
  readonly tenantId?: string;
}

export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const granted = options.permissions ?? ALL_WORKFLOW_PERMISSIONS;
  const permissions: PermissionChecker = {
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  };
  const dispatcher = new Dispatcher(permissions);
  const clock = new FixedClock(NOW);
  const delegation = new FakeDelegation();
  const membershipStanding = new FakeMembershipStanding();
  const reportingLine = new FakeReportingLine();
  const reminderRecipient = new FakeReminderRecipient();
  const notifications = new FakeNotifications();
  const business = new FakeBusinessDecisions();
  const stores = inMemoryWorkflowStores();
  const tenantId = options.tenantId ?? TENANT;
  const module = workflowModule({
    unitOfWork: new InMemoryUnitOfWork(tenantId),
    stores,
    delegation,
    membershipStanding,
    reminderRecipient,
    notifications,
    reportingLine,
    businessDecision: business,
    permissions,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  const run = <TResult>(
    tenant: string,
    membershipId: string | undefined,
    work: () => Promise<TResult>,
  ): Promise<TResult> =>
    runInContext(
      {
        tenantId: tenant,
        correlationId: uuidV7(),
        // The actor is the workforce user, as the middleware sets it. The membership is a separate
        // field, as the middleware now sets it. The suites keep them distinguishable on purpose.
        actor: `user:${membershipId ?? 'anonymous'}`,
        ...(membershipId === undefined ? {} : { membershipId }),
      },
      work,
    );

  return {
    dispatcher,
    clock,
    delegation,
    membershipStanding,
    reminderRecipient,
    notifications,
    reportingLine,
    business,
    stores,
    as: (membershipId, work) => run(tenantId, membershipId, work),
    asMachine: (work, execution = {}) =>
      runInContext(
        {
          machine: true,
          tenantId,
          executionIdentity: 'service:workflow-reminders',
          correlationId: uuidV7(),
          ...(execution.jobId === undefined ? {} : { jobId: execution.jobId }),
          ...(execution.attempt === undefined ? {} : { attempt: execution.attempt }),
        },
        work,
      ),
    withoutMembership: (work) => run(tenantId, undefined, work),
    inTenant: (tenant, membershipId, work) => run(tenant, membershipId, work),
  };
};

/**
 * Sending and asking, typed at the call site.
 *
 * `as never` is confined to these four helpers rather than sprinkled through the suites: the
 * dispatcher's registry is keyed by name at runtime, so a caller's object cannot be narrowed to the
 * handler's command type without repeating the type argument at every call. Career established the
 * same shape for the same reason.
 *
 * Each supplies an **administrator context when, and only when, the caller did not open one**. A
 * configuration command needs an actor and no particular membership, and requiring every scenario to
 * wrap itself would put a context around lines that are not about identity. A test that does care —
 * every decision and every queue read — opens its own with `as(...)`, and `runInContext` nests, so
 * the inner one wins. The check is on the ambient context rather than on a flag, so a helper can
 * never silently replace an identity a test deliberately set.
 */
const inSomeContext = <TResult>(
  harness: Harness,
  work: () => Promise<TResult>,
): Promise<TResult> => (currentContext() === undefined ? harness.as(ADMINISTRATOR, work) : work());

export const send = <TResult>(
  harness: Harness,
  command: Record<string, unknown>,
): Promise<TResult> =>
  inSomeContext(harness, async () => {
    const result = await harness.dispatcher.send<TResult>(command as never);

    if (!result.ok) throw new Error(`Refused: ${messageOf(result.error)}`);
    return result.value;
  });

export const ask = <TResult>(harness: Harness, query: Record<string, unknown>): Promise<TResult> =>
  inSomeContext(harness, async () => {
    const result = await harness.dispatcher.ask<TResult>(query as never);

    if (!result.ok) throw new Error(`Refused: ${messageOf(result.error)}`);
    return result.value;
  });

export const attempt = (
  harness: Harness,
  command: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> =>
  inSomeContext(harness, () => harness.dispatcher.send(command as never));

export const attemptAsk = (
  harness: Harness,
  query: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> =>
  inSomeContext(harness, () => harness.dispatcher.ask(query as never));

/** The failure a refused dispatch produced, or `undefined` where it succeeded. */
export const failureOf = <TValue>(result: Result<TValue, HandlerFailure>): string | undefined =>
  result.ok ? undefined : messageOf(result.error);

const messageOf = (failure: HandlerFailure): string => {
  switch (failure.kind) {
    case 'rejected':
      return failure.reason;
    case 'conflict':
      return failure.reason;
    case 'forbidden':
      return `forbidden:${failure.permission}`;
    case 'not_found':
      return `not_found:${failure.resource}`;
    default:
      return 'validation';
  }
};

/** Unwraps a result a suite requires to have succeeded, naming what did not. */
export const must = <TValue>(result: Result<TValue, HandlerFailure>, what: string): TValue => {
  if (!result.ok) throw new Error(`The harness could not ${what}: ${messageOf(result.error)}.`);
  return result.value;
};
