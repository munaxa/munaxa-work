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
import { workflowModule } from './workflow-module.js';
import { ALL_WORKFLOW_PERMISSIONS } from './workflow-permissions.js';
import type {
  ApprovalDelivery,
  BusinessDecisionPort,
  Clock,
  DelegationGrant,
  DelegationPort,
  TerminalApproval,
} from './workflow-ports.js';

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

interface Arrangement {
  readonly delegatorMembershipId: string;
  readonly delegateMembershipId: string;
  readonly scope: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date;
  revoked: boolean;
}

/**
 * Identity, answering who is currently acting for whom.
 *
 * The period test is Identity's own: **half-open**, inclusive at the start and exclusive at the end,
 * and a revoked arrangement is never in force whatever its dates say. Identity's aggregate computes
 * this from the period rather than from a stored status, because *"a status is only as fresh as the
 * last job that updated it"* — and there is no such job.
 */
export class FakeDelegation implements DelegationPort {
  private readonly arrangements: Arrangement[] = [];

  public grant(
    delegator: string,
    delegate: string,
    period: { readonly from: Date; readonly to: Date },
    scope = 'workflow.approval.decide',
  ): void {
    this.arrangements.push({
      delegatorMembershipId: delegator,
      delegateMembershipId: delegate,
      scope,
      effectiveFrom: period.from,
      effectiveTo: period.to,
      revoked: false,
    });
  }

  public revokeAll(): void {
    for (const arrangement of this.arrangements) arrangement.revoked = true;
  }

  public activeFor(
    delegateMembershipId: string,
    atInstant: Date,
  ): Promise<readonly DelegationGrant[]> {
    return Promise.resolve(
      this.arrangements
        .filter(
          (arrangement) =>
            arrangement.delegateMembershipId === delegateMembershipId &&
            !arrangement.revoked &&
            arrangement.effectiveFrom.getTime() <= atInstant.getTime() &&
            atInstant.getTime() < arrangement.effectiveTo.getTime(),
        )
        .map((arrangement) => ({
          delegatorMembershipId: arrangement.delegatorMembershipId,
          delegateMembershipId: arrangement.delegateMembershipId,
          scope: arrangement.scope,
        })),
    );
  }
}

/**
 * The adopting module, for the application suites.
 *
 * **It records and refuses, and it never pretends to be a database.** What the application layer has
 * to be right about is the *order*: the owning module is asked before Workflow writes anything, and a
 * refusal from it leaves no decision row. Whether a requisition may legally move is Recruitment's
 * question, proved against the real module in the cross-module suites.
 *
 * The default answer is `not-adopted`, which is the honest default: ten of the eleven modules that
 * could route approvals have not adopted Workflow, and their subjects reach this seam and go no
 * further.
 */
export class FakeBusinessDecisions implements BusinessDecisionPort {
  public readonly delivered: TerminalApproval[] = [];
  private answer: ApprovalDelivery = { kind: 'not-adopted' };

  public answers(delivery: ApprovalDelivery): void {
    this.answer = delivery;
  }

  public apply(approval: TerminalApproval): Promise<ApprovalDelivery> {
    this.delivered.push(approval);
    return Promise.resolve(this.answer);
  }
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly delegation: FakeDelegation;
  readonly business: FakeBusinessDecisions;
  readonly stores: ReturnType<typeof inMemoryWorkflowStores>;
  /** Runs work as a named membership, in this harness's tenant. */
  as<TResult>(membershipId: string, work: () => Promise<TResult>): Promise<TResult>;
  /** Runs work in a context that resolved **no** membership — a job, a migration, a fixture. */
  withoutMembership<TResult>(work: () => Promise<TResult>): Promise<TResult>;
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
  const business = new FakeBusinessDecisions();
  const stores = inMemoryWorkflowStores();
  const tenantId = options.tenantId ?? TENANT;
  const module = workflowModule({
    unitOfWork: new InMemoryUnitOfWork(tenantId),
    stores,
    delegation,
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
    business,
    stores,
    as: (membershipId, work) => run(tenantId, membershipId, work),
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
