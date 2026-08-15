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

export type ExecutionContext = TenantContext | SystemContext;

const storage = new AsyncLocalStorage<ExecutionContext>();

export const isSystemContext = (context: ExecutionContext): context is SystemContext =>
  'system' in context;

/** Runs `work` with the given context. Nested calls override for their own scope only. */
export const runInContext = <TResult>(context: ExecutionContext, work: () => TResult): TResult => {
  if (!isSystemContext(context) && !isUuidV7(context.tenantId)) {
    throw new TenantIsolationException(`tenant "${context.tenantId}" (not a valid identifier)`);
  }
  return storage.run(context, work);
};

/** The current context, or undefined outside one. */
export const currentContext = (): ExecutionContext | undefined => storage.getStore();

/**
 * The current tenant. Throws outside a tenant context — including inside a system context,
 * because tenant-scoped work must never silently run unscoped.
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

/** Asserts that a record belongs to the current tenant. The last line of defence in code. */
export const assertBelongsToCurrentTenant = (resource: string, tenantId: string): void => {
  if (tenantId !== currentTenantId()) {
    throw new TenantIsolationException(resource);
  }
};
