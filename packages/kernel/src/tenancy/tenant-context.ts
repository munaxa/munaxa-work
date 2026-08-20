import { AsyncLocalStorage } from 'node:async_hooks';

import { TenantIsolationException } from '../errors/domain-exception.js';
import { isUuidV7 } from '../identity/uuid-v7.js';

/**
 * The tenant a unit of work belongs to (ADR-0030).
 *
 * Held in async local storage rather than passed through every signature, because a parameter
 * that can be forgotten will be forgotten, and the consequence here is a cross-tenant read.
 * The storage is per async execution context, so concurrent requests cannot see each other's
 * tenant — the property that makes this safe under a connection pool.
 *
 * This is the application's half of the guarantee. The database's half is row-level security,
 * which refuses the query even when this is wrong.
 */

export interface TenantContext {
  readonly tenantId: string;
  /** Who is acting. Written to every audit column, so it is required rather than optional —
   *  an audit row whose actor is unknown answers none of the questions audit exists for. */
  readonly actor: string;
  readonly userId?: string;
  /**
   * The membership this request resolved to — *this person, in this tenant*.
   *
   * Distinct from `userId`, which is the workforce user: a person may hold memberships in several
   * tenants (AD-005), and the identifier other modules key an *arrangement* on is the membership.
   * Identity's delegation register is the case that forces the distinction —
   * `identity.active-delegations-for` takes a `delegateMembershipId` and nothing else answers it.
   *
   * Optional, because not every execution context comes from an HTTP request. A reconciliation
   * command, a migration and every test fixture construct a context directly and have no membership
   * to name; a required field would have made all of them assert one they do not have. A handler
   * that needs it therefore has to handle its absence, which is the correct shape — "we do not know
   * which member you are" is a real state, and the safe answer to it is nothing rather than
   * everything.
   *
   * **Never taken from a request body.** The middleware sets it from the membership it resolved
   * from stored facts about an authenticated principal; a client-supplied value would let anybody
   * read anybody's approval queue by changing a field.
   */
  readonly membershipId?: string;
  readonly correlationId: string;
}

/**
 * Work that is legitimately outside any tenant: a migration, a platform maintenance job. It is
 * a named, greppable state rather than an absent context, so "no tenant" can never be confused
 * with "forgot to set the tenant".
 */
export interface SystemContext {
  readonly system: true;
  readonly reason: string;
  readonly correlationId: string;
}

/**
 * A machine running tenant-scoped business work, on nobody's behalf.
 *
 * **Why this is a third member rather than either of the two above.** `SystemContext` carries no
 * tenant and is refused by `currentTenantId`, by the CQRS pipeline and by every service grant —
 * which is correct for a migration and useless for work that belongs to one tenant. `TenantContext`
 * is the shape a human request produces: its `actor` is a person and nothing in the type says
 * otherwise, so putting a machine there would make the two indistinguishable at exactly the point
 * an auditor needs them apart. Neither could be widened without making the other less honest.
 *
 * **It is not a membership and cannot become one.** There is no `membershipId` and no `userId` here,
 * and there is deliberately no way to add one: a machine is never an approver, is never asked to
 * decide, and must never appear where a person is expected. Every domain guard that requires a
 * membership therefore refuses machine execution *by construction* rather than by a check somebody
 * has to remember to write.
 *
 * **It is fed by the platform, never by a caller.** The platform authenticates a non-human principal
 * and resolves the tenant; the fields below restate that decision and nothing more. A value here
 * that arrived from a request body or a job payload would be a tenant somebody chose for themselves,
 * which is the one thing tenancy may never be (ADR-0030, ADR-0032).
 */
export interface MachineContext {
  readonly machine: true;
  readonly tenantId: string;
  /**
   * Who the platform authenticated, as a stable non-human subject — `service:<clientId>`,
   * `apikey:<keyId>`, `system:<component>`.
   *
   * A string rather than a structured principal because the kernel must not learn the platform's
   * principal model to carry an audit subject, and because this is what lands in `created_by`
   * beside the `system:<reason>` a system context already writes there.
   */
  readonly executionIdentity: string;
  /** Which unit of scheduled work this is. Absent until something schedules work. */
  readonly jobId?: string;
  /** Which attempt at that work this is. Absent for the same reason. */
  readonly attempt?: number;
  readonly correlationId: string;
}

export type ExecutionContext = TenantContext | SystemContext | MachineContext;

const storage = new AsyncLocalStorage<ExecutionContext>();

export const isSystemContext = (context: ExecutionContext): context is SystemContext =>
  'system' in context;

/** Whether a machine is acting. The negation of "somebody is acting", and never a synonym for it. */
export const isMachineContext = (context: ExecutionContext): context is MachineContext =>
  'machine' in context;

/**
 * The contexts that belong to one tenant, which is both of them that are not the system context.
 *
 * Exported because three separate places need the same question answered — the CQRS pipeline, the
 * tenant reader below, and the audit columns — and three copies of `!isSystemContext(...)` would be
 * three places to forget when a fourth member is added.
 */
export const isTenantScoped = (
  context: ExecutionContext,
): context is TenantContext | MachineContext => !isSystemContext(context);

/** Runs `work` with the given context. Nested calls override for their own scope only. */
export const runInContext = <TResult>(context: ExecutionContext, work: () => TResult): TResult => {
  if (isTenantScoped(context) && !isUuidV7(context.tenantId)) {
    throw new TenantIsolationException(`tenant "${context.tenantId}" (not a valid identifier)`);
  }
  return storage.run(context, work);
};

/** The current context, or undefined outside one. */
export const currentContext = (): ExecutionContext | undefined => storage.getStore();

/**
 * The current tenant. Throws outside a tenant context — including inside a system context,
 * because tenant-scoped work must never silently run unscoped.
 *
 * A machine context answers, and that is the whole point of it being a separate member: the work is
 * one tenant's even though nobody is doing it.
 */
export const currentTenantId = (): string => {
  const context = storage.getStore();

  if (context === undefined) {
    throw new TenantIsolationException('a tenant-scoped operation that ran with no tenant context');
  }
  if (isSystemContext(context)) {
    throw new TenantIsolationException(
      `a tenant-scoped operation that ran under the system context (${context.reason})`,
    );
  }
  return context.tenantId;
};

/**
 * Who to name as the actor of an event or an audit trail, given a context that has a tenant.
 *
 * **One rule, in one place, because it was in sixteen.** Every module's context file wrote
 * `actor: context.actor`, which was right while there were only two kinds of caller and silently
 * wrong the moment a third arrived — sixteen files would each have had to grow the same branch, and
 * the one that was forgotten would have raised an event whose actor was `undefined`.
 *
 * A machine names the subject the platform authenticated. That is deliberately the same *shape* the
 * audit columns write and deliberately not the shape a person's actor has, so a reader can tell an
 * automatic event from a human one without joining anywhere to discover that the actor names nobody.
 */
export const actorSubjectOf = (context: TenantContext | MachineContext): string =>
  isMachineContext(context) ? context.executionIdentity : context.actor;

/**
 * The membership acting, when one is.
 *
 * `undefined` under a machine context, and that is not a gap to be filled later: a machine holds no
 * membership, so every caller that needs one refuses machine execution without writing a rule about
 * machines. That is how "a machine is never an approver" is enforced — by the type, in one place,
 * rather than by a guard in each of the places somebody might forget.
 */
export const currentMembershipId = (): string | undefined => {
  const context = storage.getStore();

  if (context === undefined || !isTenantScoped(context)) return undefined;
  return isMachineContext(context) ? undefined : context.membershipId;
};

/** Asserts that a record belongs to the current tenant. The last line of defence in code. */
export const assertBelongsToCurrentTenant = (resource: string, tenantId: string): void => {
  if (tenantId !== currentTenantId()) {
    throw new TenantIsolationException(resource);
  }
};
