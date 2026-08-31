import type { RoleAssignment, RoleDefinition } from '@munaxa/interfaces';
import { PermissionResolver } from '@munaxa/rbac';
import type { TenantId, UserId } from '@munaxa/types';
import type { Pool } from 'pg';

import { PostgresRoleAssignments, PostgresRoleRepository } from './authorization-store.js';

/** What the permission checker needs, and the only thing it is given. */
export interface EffectiveGrants {
  forMembership(tenantId: TenantId, membershipId: UserId): Promise<readonly string[]>;
}

/** Reported when a grant could not be represented and was dropped during resolution. */
export interface UnrepresentableGrant {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly grants: readonly string[];
}

/**
 * Munaxa Work's authorization: its stores, the platform's resolver over them, and the four
 * mutations that change what anybody effectively holds.
 *
 * **The resolver is the decision engine and this is not.** `PermissionResolver` walks the role
 * graph, applies scoping, drops what it cannot represent and produces the effective set; what
 * this class contributes is the two ports it reads through and the discipline around invalidating
 * it. Nothing here evaluates a permission.
 *
 * **Resolution is live.** The resolver is constructed with no `CachePort`, so every call reads
 * the assignment rows as they are now. That is the approved revocation guarantee expressed as an
 * absence rather than as a number: there is no TTL to tune, no window to reason about, and a
 * withdrawn grant stops working on the next request rather than within some interval.
 *
 * **What is memoised, and why it still needs invalidating.** The resolver keeps each tenant's
 * *role graph* in process — roles change rarely and the walk is expensive — and that memo has no
 * expiry at all. So a change to a role *definition* must call `invalidateTenant`, or a role whose
 * grants were narrowed would keep conferring the old ones for the life of the process. Assignment
 * changes need no invalidation for correctness, and `invalidateUser` is called on them anyway,
 * exactly as approved: it is what a shared cache would need, and a mutation path that omits it
 * today is a mutation path that stays wrong when one is introduced.
 *
 * **The mutations that are not here.** A membership being suspended or ended changes what
 * somebody can do without touching a single row in these tables — the directory stops returning
 * it, no tenant context is established, and the request is refused before authorization is
 * consulted at all. Nothing to invalidate, because nothing was cached: the check that fails is
 * upstream of this class.
 */
export class WorkAuthorization implements EffectiveGrants {
  private readonly roles: PostgresRoleRepository;
  private readonly assignments: PostgresRoleAssignments;
  private readonly resolver: PermissionResolver;

  public constructor(pool: Pool, onUnrepresentableGrant: (detail: UnrepresentableGrant) => void) {
    this.roles = new PostgresRoleRepository(pool);
    this.assignments = new PostgresRoleAssignments(pool);
    this.resolver = new PermissionResolver({
      roles: this.roles,
      assignments: this.assignments,
      onUnrepresentableGrant,
    });
  }

  /** The effective grants this membership holds, resolved now from the stored assignments. */
  public async forMembership(tenantId: TenantId, membershipId: UserId): Promise<readonly string[]> {
    const resolved = await this.resolver.resolve(tenantId, membershipId);

    return resolved.permissions;
  }

  /** Defines or replaces a role. The tenant's memoised graph is dropped before this returns. */
  public async defineRole(role: RoleDefinition): Promise<void> {
    await this.roles.save(role);
    await this.resolver.invalidateTenant(role.tenantId);
  }

  public async removeRole(tenantId: TenantId, roleId: string): Promise<boolean> {
    const removed = await this.roles.remove(tenantId, roleId);

    await this.resolver.invalidateTenant(tenantId);
    return removed;
  }

  public async assign(assignment: RoleAssignment): Promise<void> {
    await this.assignments.assign(assignment);
    await this.resolver.invalidateUser(assignment.tenantId, assignment.userId);
  }

  public async revoke(
    tenantId: TenantId,
    membershipId: UserId,
    roleId: string,
    scope?: string,
  ): Promise<boolean> {
    const revoked = await this.assignments.revoke(tenantId, membershipId, roleId, scope);

    await this.resolver.invalidateUser(tenantId, membershipId);
    return revoked;
  }
}
