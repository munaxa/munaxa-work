import { AsyncLocalStorage } from 'node:async_hooks';

import { TenantIsolationException } from '../errors/domain-exception.js';

import { currentContext, isSystemContext } from './tenant-context.js';

import type { PermissionChecker } from '../cqrs/pipeline.js';

/**
 * A bounded service grant: the narrow, named authority one module may exercise inside another
 * while acting on a user's behalf.
 *
 * **The problem it solves.** A module that reaches another through its published application
 * service inherits that service's permission check — correctly, for a read the *user* is really
 * making. It is wrong when the read is incidental. A recruiter creating a requisition must be
 * allowed to name a position without holding permission to browse the organization chart, and a
 * recruiter hiring somebody must not thereby hold permission to edit the master registry of human
 * identity.
 *
 * **What it is not.** It is not a bypass, and every property here exists to keep it from becoming
 * one:
 *
 * - **The user is still checked for their own operation.** A grant is entered *inside* a handler
 *   the pipeline has already authorized. It cannot be reached before that check.
 * - **It permits an explicit list**, never a wildcard and never a prefix. A permission not named is
 *   refused exactly as it would be without a grant.
 * - **It cannot nest.** Entering a grant inside a grant throws, so authority cannot be accumulated
 *   by composition — which is how a narrow capability becomes a wide one over a few releases.
 * - **It requires a tenant context**, so nothing can run untenanted under it.
 * - **It does not touch the execution context.** The tenant, the actor and the correlation
 *   identifier stay exactly as the request set them, so every audit column and every event still
 *   names the human being who asked. A grant changes what is permitted, never who is acting.
 * - **Every use is observable**, so "what did Recruitment do inside People, and for whom" is a
 *   question with an answer.
 */

export interface ServiceGrant {
  /** The module exercising the authority — `recruitment`. */
  readonly module: string;
  /** The user operation that authorized it — `employment.create-employment`. */
  readonly operation: string;
  /** The exact permissions this grant permits. Never a pattern, never a prefix. */
  readonly permits: readonly string[];
  /** Why the module needs them, in one phrase. Written to the elevation record. */
  readonly reason: string;
}

const storage = new AsyncLocalStorage<ServiceGrant>();

export const currentServiceGrant = (): ServiceGrant | undefined => storage.getStore();

/**
 * Runs `work` under a service grant.
 *
 * Refuses outside a tenant context, and refuses to nest. Both refusals are exceptions rather than
 * silent no-ops: a grant that quietly did nothing would fail *closed* in development and be removed
 * as dead code, and a grant that quietly nested would fail *open* in production.
 */
export const runWithServiceGrant = <TResult>(grant: ServiceGrant, work: () => TResult): TResult => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new TenantIsolationException(
      `a ${grant.module} service grant entered without a tenant context`,
    );
  }
  if (storage.getStore() !== undefined) {
    throw new Error(
      `A service grant for ${grant.module} was entered inside another. Authority is not composed.`,
    );
  }
  return storage.run(grant, work);
};

/** What an elevation observer is told. Never the data that was read — only that it was permitted. */
export interface ServiceElevation {
  readonly module: string;
  readonly operation: string;
  readonly permission: string;
  readonly reason: string;
  readonly tenantId: string;
  /** The human being on whose behalf the module acted. */
  readonly actor: string;
  readonly correlationId: string;
}

/**
 * The permission checker every deployment wires: Platform's decision, with a bounded service grant
 * consulted first.
 *
 * A decorator rather than a second implementation, because two checkers would eventually disagree
 * and the disagreement would be a caller permitted by one and refused by the other. Platform still
 * decides everything a *user* may do; this only adds the narrow authority a module holds while
 * acting inside another, and it adds nothing at all when no grant is open.
 */
export class GrantAwarePermissionChecker implements PermissionChecker {
  public constructor(
    private readonly delegate: PermissionChecker,
    private readonly observe: (elevation: ServiceElevation) => void = () => undefined,
  ) {}

  public async holds(permission: string): Promise<boolean> {
    // The user's own permission first: a caller who legitimately holds it is not an elevation, and
    // recording one would bury the real elevations in noise.
    if (await this.delegate.holds(permission)) return true;

    const grant = currentServiceGrant();

    if (grant === undefined || !grant.permits.includes(permission)) return false;

    this.observe({
      ...originOf(),
      module: grant.module,
      operation: grant.operation,
      permission,
      reason: grant.reason,
    });
    return true;
  }
}

const originOf = (): {
  readonly tenantId: string;
  readonly actor: string;
  readonly correlationId: string;
} => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    // Unreachable through `runWithServiceGrant`, which refuses both cases. Stated rather than
    // assumed, because an elevation that could not name its actor would be an elevation nobody
    // could audit.
    throw new TenantIsolationException('a service elevation outside a tenant context');
  }
  return {
    tenantId: context.tenantId,
    actor: context.actor,
    correlationId: context.correlationId,
  };
};
